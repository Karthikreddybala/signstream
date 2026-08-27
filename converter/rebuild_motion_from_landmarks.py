from __future__ import annotations

import argparse
import json
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

try:
    from convert_motion import refresh_manifest
    from motion_builder import MotionBuilder
except ImportError:  # pragma: no cover
    from converter.convert_motion import refresh_manifest
    from converter.motion_builder import MotionBuilder


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "frontend" / "public" / "motion" / "manifest.json"
DEFAULT_PUBLIC = ROOT / "frontend" / "public"


def local_asset_path(public_root: Path, public_path: str) -> Path:
    return public_root / str(public_path).lstrip("/").replace("/", "\\")


def variant_entries(clip: dict) -> list[dict]:
    variants = clip.get("motionVariants") or clip.get("variants") or []
    if variants:
        return [variant for variant in variants if isinstance(variant, dict)]

    video_ids = clip.get("videoIds") or [clip.get("primaryVideoId")]
    return [
        {
            "videoId": video_id,
            "motionPath": f"/motion/clips/{video_id}.json" if video_id else None,
            "landmarkPath": f"/motion/landmarks/{video_id}.json" if video_id else None,
        }
        for video_id in video_ids
        if video_id
    ]


def rebuild_variant(task: tuple[str, str, dict, str]) -> str:
    gloss, slug, variant, public_root_value = task
    public_root = Path(public_root_value)
    video_id = str(variant.get("videoId") or "").strip()
    motion_path = str(variant.get("motionPath") or f"/motion/clips/{video_id}.json").strip()
    landmark_path = str(variant.get("landmarkPath") or f"/motion/landmarks/{video_id}.json").strip()
    landmark_file = local_asset_path(public_root, landmark_path)

    if not landmark_file.exists():
        return "skipped"

    try:
        payload = json.loads(landmark_file.read_text(encoding="utf-8"))
        builder = MotionBuilder(fps=float(payload.get("fps") or 30.0))
        motion = builder.build(
            payload.get("body", []),
            payload.get("left_hand", []),
            payload.get("right_hand", []),
            name=gloss,
            metadata={
                "gloss": gloss,
                "slug": slug,
                "videoId": video_id,
                "sourceVideoPath": variant.get("sourceVideoPath"),
                "landmarkPath": landmark_path,
                "rebuiltFromLandmarks": True,
            },
        )
        motion.update({
            "name": gloss,
            "gloss": gloss,
            "slug": slug,
            "videoId": video_id,
            "motionPath": motion_path,
            "landmarkPath": landmark_path,
            "sourceVideoPath": variant.get("sourceVideoPath"),
        })
        motion_file = local_asset_path(public_root, motion_path)
        motion_file.parent.mkdir(parents=True, exist_ok=True)
        motion_file.write_text(json.dumps(motion, indent=2, ensure_ascii=False), encoding="utf-8")
        return "rebuilt"
    except Exception:
        return "failed"


def rebuild(manifest_path: Path, public_root: Path, workers: int) -> dict[str, int]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    tasks = []
    skipped = 0

    for clip in manifest.get("clips", []):
        gloss = str(clip.get("gloss", "")).strip()
        slug = str(clip.get("slug", gloss)).strip()
        for variant in variant_entries(clip):
            video_id = str(variant.get("videoId") or clip.get("primaryVideoId") or "").strip()
            normalized_variant = {
                **variant,
                "videoId": video_id,
                "motionPath": variant.get("motionPath") or f"/motion/clips/{video_id}.json",
                "landmarkPath": variant.get("landmarkPath") or f"/motion/landmarks/{video_id}.json",
            }
            if local_asset_path(public_root, normalized_variant["landmarkPath"]).exists():
                tasks.append((gloss, slug, normalized_variant, str(public_root)))
            else:
                skipped += 1

    with ProcessPoolExecutor(max_workers=max(1, workers)) as executor:
        results = list(executor.map(rebuild_variant, tasks, chunksize=8))

    refresh_manifest(manifest_path, public_root / "motion" / "clips")
    return {
        "rebuilt": results.count("rebuilt"),
        "skipped": skipped,
        "failed": results.count("failed"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild motion JSON from exported landmark JSON.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--public-root", type=Path, default=DEFAULT_PUBLIC)
    parser.add_argument("--workers", type=int, default=max(1, min(4, os.cpu_count() or 1)))
    args = parser.parse_args()
    result = rebuild(args.manifest, args.public_root, args.workers)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
