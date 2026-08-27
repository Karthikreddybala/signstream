import io
import re
import zipfile
from html import unescape
from pathlib import Path


class InputProcessingError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def safe_filename(filename: str | None) -> tuple[str, str]:
    name = Path(filename or "").name
    suffix = Path(name).suffix.lower()
    stem = re.sub(r"[^a-zA-Z0-9_-]", "_", Path(name).stem)[:80]
    if not stem or not suffix:
        raise InputProcessingError("A filename with a supported extension is required.", 415)
    return stem, suffix


def validate_upload_bytes(source_type: str, suffix: str, content_type: str | None, data: bytes) -> None:
    if not data:
        raise InputProcessingError("The uploaded file is empty.", 400)

    if source_type == "document":
        if suffix == ".pdf" and not data.startswith(b"%PDF-"):
            raise InputProcessingError("The uploaded PDF is malformed.", 422)
        if suffix == ".docx" and not data.startswith(b"PK\x03\x04"):
            raise InputProcessingError("The uploaded DOCX file is malformed.", 422)
        if suffix == ".txt":
            try:
                data.decode("utf-8")
            except UnicodeDecodeError as error:
                raise InputProcessingError("The uploaded text file is not valid UTF-8.", 422) from error

    if source_type == "image":
        signatures = (
            data.startswith(b"\x89PNG\r\n\x1a\n"),
            data.startswith(b"\xff\xd8\xff"),
            data[:4] == b"RIFF" and data[8:12] == b"WEBP"
        )
        if not any(signatures):
            raise InputProcessingError("The uploaded image format is invalid.", 422)

    if source_type == "speech":
        if content_type and not content_type.startswith(("audio/", "video/webm")):
            raise InputProcessingError("The uploaded audio format is invalid.", 415)
        audio_signature = (
            suffix == ".wav" and data.startswith(b"RIFF") and data[8:12] == b"WAVE",
            suffix == ".mp3" and (data.startswith(b"ID3") or data[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}),
            suffix == ".m4a" and data[4:8] == b"ftyp",
            suffix == ".webm" and data.startswith(b"\x1a\x45\xdf\xa3")
        )
        if not any(audio_signature):
            raise InputProcessingError("The uploaded audio bytes do not match the selected format.", 422)


def normalize_text(text: str, max_characters: int) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        raise InputProcessingError("No readable text was found in the uploaded file.", 422)
    if len(normalized) > max_characters:
        raise InputProcessingError("Extracted text exceeds the configured text limit.", 413)
    return normalized


def extract_text(path: Path, suffix: str, max_characters: int) -> str | None:
    if suffix == ".txt":
        return normalize_text(path.read_text(encoding="utf-8"), max_characters)

    if suffix == ".docx":
        try:
            with zipfile.ZipFile(path) as archive:
                xml = archive.read("word/document.xml").decode("utf-8")
        except (KeyError, OSError, UnicodeDecodeError, zipfile.BadZipFile) as error:
            raise InputProcessingError("The uploaded DOCX file could not be read.", 422) from error
        text = re.sub(r"<[^>]+>", " ", unescape(xml))
        return normalize_text(text, max_characters)

    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as error:
            raise InputProcessingError("PDF extraction is unavailable because pypdf is not installed.", 503) from error
        try:
            reader = PdfReader(str(path))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as error:
            raise InputProcessingError("The uploaded PDF could not be read.", 422) from error
        return normalize_text(text, max_characters)

    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        try:
            from PIL import Image
            with Image.open(io.BytesIO(path.read_bytes())) as image:
                image.verify()
        except ImportError as error:
            raise InputProcessingError("Image validation is unavailable because Pillow is not installed.", 503) from error
        except Exception as error:
            raise InputProcessingError("The uploaded image could not be read.", 422) from error
        return None

    return None
