import secrets
import subprocess
from datetime import datetime, timezone
from mimetypes import guess_type
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from starlette.background import BackgroundTask

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.dependencies import CurrentUser, DatabaseSession
from app.input_processing import InputProcessingError, extract_text, normalize_text, safe_filename, validate_upload_bytes
from app.llm import LLMProviderError, create_provider, get_llm_status
from app.models import HistoryEntry, User
from app.schemas import (
    AuthResponse,
    HistoryCreate,
    HistoryResponse,
    TextTranslationRequest,
    TranslationResponse,
    UploadResponse,
    UserCreate,
    UserLogin,
    UserResponse,
)
from app.services import load_motion_manifest, resolve_gloss_sequence


router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, str]:
    settings = get_settings()
    return {"status": "ok", "service": "signstream-api", "llm_provider": get_llm_status(settings)["provider"]}


@router.get("/status")
def api_status() -> dict:
    settings = get_settings()
    llm = get_llm_status(settings)
    manifest = load_motion_manifest()
    clips = [clip for clip in manifest.get("clips", []) if isinstance(clip, dict)]
    ready = sum(1 for clip in clips if str(clip.get("status", "")).lower() == "ready")

    return {
        "status": "ok",
        "service": "signstream-api",
        "environment": settings.environment,
        "llm_provider": llm["provider"],
        "llm": llm,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "motion_library": {
            "clips": len(clips),
            "ready": ready,
            "pending": max(0, len(clips) - ready),
        },
    }


@router.post("/status/llm-check")
def llm_check() -> dict:
    settings = get_settings()
    manifest = load_motion_manifest()
    available_glosses = [
        str(clip.get("gloss", ""))
        for clip in manifest.get("clips", [])
        if isinstance(clip, dict) and str(clip.get("gloss", "")).strip()
    ]

    try:
        provider = create_provider(settings)
        provider.translate("hello", available_glosses or ["hello"])
    except LLMProviderError:
        pass

    return api_status()


@router.post("/auth/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: DatabaseSession) -> AuthResponse:
    user = User(name=payload.name.strip(), email=payload.email.strip().lower(), password_hash=hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists") from error
    db.refresh(user)
    return AuthResponse(access_token=create_access_token(str(user.id)), user=user)


@router.post("/auth/login", response_model=AuthResponse)
def login(payload: UserLogin, db: DatabaseSession) -> AuthResponse:
    user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return AuthResponse(access_token=create_access_token(str(user.id)), user=user)


@router.get("/auth/me", response_model=UserResponse)
def me(user: CurrentUser) -> UserResponse:
    return user


@router.get("/motions")
def motions() -> dict:
    manifest = load_motion_manifest()
    clips = manifest.get("clips", [])
    return {"clips": clips, "clipCount": len(clips)}


@router.post("/translate/text", response_model=TranslationResponse)
def translate_text(payload: TextTranslationRequest) -> TranslationResponse:
    return translate_normalized_text(payload.text, payload.language)


@router.post("/translate/document", response_model=UploadResponse)
async def translate_document(file: UploadFile = File(...)) -> UploadResponse:
    return await save_upload(file, {".pdf", ".docx", ".txt"}, "document")


@router.post("/translate/image", response_model=UploadResponse)
async def translate_image(file: UploadFile = File(...)) -> UploadResponse:
    return await save_upload(file, {".png", ".jpg", ".jpeg", ".webp"}, "image")


@router.post("/translate/speech", response_model=UploadResponse)
async def translate_speech(file: UploadFile = File(...)) -> UploadResponse:
    return await save_upload(file, {".wav", ".mp3", ".m4a", ".webm"}, "speech")


@router.post("/media/convert-mp4")
async def convert_recording_to_mp4(file: UploadFile = File(...)) -> FileResponse:
    settings = get_settings()
    _, suffix = safe_filename(file.filename)
    if suffix not in {".webm", ".mp4", ".m4v", ".mov", ".mkv"}:
        raise HTTPException(status_code=415, detail="Unsupported recording format")

    data = await file.read(settings.max_recording_bytes + 1)
    if len(data) > settings.max_recording_bytes:
        raise HTTPException(status_code=413, detail="Recording exceeds the upload limit")

    conversion_directory = Path(settings.upload_directory) / "conversions"
    conversion_directory.mkdir(parents=True, exist_ok=True)
    token = secrets.token_hex(8)
    input_path = conversion_directory / f"{token}{suffix}"
    output_path = conversion_directory / f"{token}.mp4"
    input_path.write_bytes(data)

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(input_path),
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
                str(output_path),
            ],
            check=True,
            capture_output=True,
            timeout=300,
        )
    except FileNotFoundError as error:
        cleanup_conversion_files(input_path, output_path)
        raise HTTPException(status_code=503, detail="MP4 conversion is unavailable on this server") from error
    except subprocess.TimeoutExpired as error:
        cleanup_conversion_files(input_path, output_path)
        raise HTTPException(status_code=504, detail="MP4 conversion timed out") from error
    except subprocess.CalledProcessError as error:
        cleanup_conversion_files(input_path, output_path)
        raise HTTPException(status_code=422, detail="The recording could not be converted to MP4") from error

    return FileResponse(
        output_path,
        media_type="video/mp4",
        filename="signstream-session.mp4",
        background=BackgroundTask(cleanup_conversion_files, input_path, output_path),
    )


def cleanup_conversion_files(*paths: Path) -> None:
    for path in paths:
        path.unlink(missing_ok=True)


def translate_normalized_text(text: str, language: str = "en") -> TranslationResponse:
    normalized_text = text.strip()
    if not normalized_text:
        raise HTTPException(status_code=422, detail={"code": "empty_input", "message": "Input text cannot be empty."})

    manifest = load_motion_manifest()
    available_glosses = [
        str(clip.get("gloss", ""))
        for clip in manifest.get("clips", [])
        if isinstance(clip, dict) and str(clip.get("gloss", "")).strip()
    ]

    try:
        provider = create_provider(get_settings())
        requested_glosses = provider.translate(normalized_text, available_glosses, language)
    except LLMProviderError as error:
        raise HTTPException(status_code=error.status_code, detail={"code": error.code, "message": error.message}) from error

    matches, unknown_glosses = resolve_gloss_sequence(requested_glosses, manifest)
    glosses = [str(item.get("gloss")) for item in matches]
    paths = [
        str(item.get("motionPath") or item.get("primaryMotionPath") or item.get("previewMotionPath"))
        for item in matches
        if item.get("motionPath") or item.get("primaryMotionPath") or item.get("previewMotionPath")
    ]
    response_status = "ready" if glosses and not unknown_glosses else "partial" if glosses else "no_matches"

    return TranslationResponse(
        text=normalized_text,
        glosses=glosses,
        motion_paths=paths,
        status=response_status,
        unknown_glosses=unknown_glosses,
        provider=provider.name
    )


async def save_upload(file: UploadFile, extensions: set[str], source_type: str) -> UploadResponse:
    settings = get_settings()
    stem, suffix = safe_filename(file.filename)
    if suffix not in extensions:
        raise HTTPException(status_code=415, detail=f"Unsupported {source_type} file type")

    upload_directory = Path(settings.upload_directory)
    upload_directory.mkdir(parents=True, exist_ok=True)
    target = upload_directory / f"{stem}-{secrets.token_hex(6)}{suffix}"
    size = 0

    try:
        with target.open("xb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise InputProcessingError("File exceeds the upload limit.", 413)
                output.write(chunk)

        data = target.read_bytes()
        validate_upload_bytes(source_type, suffix, file.content_type, data)
        if source_type == "document":
            normalized_text = extract_text(target, suffix, settings.max_text_characters)
        elif source_type == "image":
            provider = create_provider(settings)
            raw_text = provider.extract_image_text(data, file.content_type or guess_type(target.name)[0] or "image/png")
            normalized_text = normalize_text(raw_text, settings.max_text_characters)
        elif source_type == "speech":
            provider = create_provider(settings)
            raw_text = provider.transcribe_audio(data, file.content_type or guess_type(target.name)[0] or "audio/webm")
            normalized_text = normalize_text(raw_text, settings.max_text_characters)
        else:
            normalized_text = None
    except InputProcessingError as error:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=error.status_code, detail={"code": "invalid_upload", "message": error.message}) from error
    except LLMProviderError as error:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=error.status_code, detail={"code": error.code, "message": error.message}) from error
    except OSError as error:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="The upload could not be stored safely.") from error

    if normalized_text:
        translation = translate_normalized_text(normalized_text)
        return UploadResponse(
            filename=target.name,
            source_type=source_type,
            size_bytes=size,
            status=translation.status,
            normalized_text=normalized_text,
            glosses=translation.glosses,
            motion_paths=translation.motion_paths,
            unknown_glosses=translation.unknown_glosses,
            provider=translation.provider
        )

    message = "File uploaded and validated."
    return UploadResponse(filename=target.name, source_type=source_type, size_bytes=size, message=message)


@router.get("/history", response_model=list[HistoryResponse])
def history(db: DatabaseSession, user: CurrentUser) -> list[HistoryResponse]:
    return list(db.scalars(select(HistoryEntry).where(HistoryEntry.user_id == user.id).order_by(HistoryEntry.created_at.desc())))


@router.post("/history", response_model=HistoryResponse, status_code=status.HTTP_201_CREATED)
def create_history(payload: HistoryCreate, db: DatabaseSession, user: CurrentUser) -> HistoryResponse:
    entry = HistoryEntry(user_id=user.id, **payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/history/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_history(entry_id: int, db: DatabaseSession, user: CurrentUser) -> None:
    entry = db.scalar(select(HistoryEntry).where(HistoryEntry.id == entry_id, HistoryEntry.user_id == user.id))
    if entry is None:
        raise HTTPException(status_code=404, detail="History entry not found")
    db.delete(entry)
    db.commit()
