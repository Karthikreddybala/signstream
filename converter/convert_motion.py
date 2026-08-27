from __future__ import annotations

import argparse
import json
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

try:
    from loader import LandmarkLoader
    from motion_builder import MotionBuilder
    from video_landmarks import extract_landmark_sequences
except ImportError:  # pragma: no cover - keeps module usable as a package too
    from converter.loader import LandmarkLoader
    from converter.motion_builder import MotionBuilder
    from converter.video_landmarks import extract_landmark_sequences


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEX_PATH = ROOT / "converter" / "output" / "video_gloss_index.json"
DEFAULT_RECORDINGS_DIR = ROOT / "converter" / "recordings"
DEFAULT_OUTPUT_DIR = ROOT / "frontend" / "public" / "motion" / "clips"
DEFAULT_LANDMARK_OUTPUT_DIR = ROOT / "frontend" / "public" / "motion" / "landmarks"
DEFAULT_MANIFEST_PATH = ROOT / "frontend" / "public" / "motion" / "manifest.json"
DEFAULT_REPORT_PATH = ROOT / "converter" / "output" / "motion_library_report.json"
DEFAULT_FPS = 30.0


def slugify(value: str) -> str:
    return (
        str(value)
        .strip()
        .lower()
        .replace(" ", "_")
        .replace("/", "_")
        .replace("-", "_")
    )


def load_index(index_path: Path):
    if not index_path.exists():
        raise FileNotFoundError(f"Missing index file: {index_path}")

    with open(index_path, "r", encoding="utf-8") as index_file:
        index_data = json.load(index_file)

    if isinstance(index_data, dict):
        items = index_data.get("items", [])
    else:
        items = index_data

    normalized_items = []

    for item in items:
        gloss = str(item.get("gloss", "")).strip()
        video_id = str(item.get("videoId", item.get("video_id", ""))).strip()

        if not gloss or not video_id:
            continue

        normalized_items.append(
            {
                "gloss": gloss,
                "slug": str(item.get("slug") or slugify(gloss)),
                "videoId": video_id,
                "videoPath": item.get("videoPath"),
                "source": item.get("source"),
                "split": item.get("split"),
                "instanceId": item.get("instanceId", item.get("instance_id")),
                "signerId": item.get("signerId", item.get("signer_id")),
                "variationId": item.get("variationId", item.get("variation_id")),
                "frameStart": item.get("frameStart", item.get("frame_start")),
                "frameEnd": item.get("frameEnd", item.get("frame_end")),
                "fps": item.get("fps"),
                "url": item.get("url"),
                "motionPath": item.get("motionPath"),
            }
        )

    return normalized_items


def build_recording_lookup(loader: LandmarkLoader):
    lookup = {}

    for recording_name in loader.list_recordings():
        metadata = loader.load_metadata(recording_name)
        normalized_keys = {
            recording_name.lower(),
            slugify(recording_name),
        }

        for key in (
            metadata.get("recording_name"),
            metadata.get("video_id"),
            metadata.get("gloss"),
            metadata.get("slug"),
        ):
            if key:
                normalized_keys.add(str(key).strip().lower())

        for key in normalized_keys:
            lookup[key] = recording_name

    return lookup


def pick_recording_for_item(item, recording_lookup):
    candidate_keys = [
        item["videoId"],
        item["gloss"],
        item["slug"],
        f"{item['slug']}_{item['videoId']}",
    ]

    for candidate_key in candidate_keys:
        recording_name = recording_lookup.get(str(candidate_key).strip().lower())
        if recording_name:
            return recording_name

    return None


def load_motion_data(loader: LandmarkLoader, recording_name: str):
    body, left_hand, right_hand = loader.load(recording_name)
    metadata = loader.load_metadata(recording_name)

    return body, left_hand, right_hand, metadata


def write_motion_clip(builder: MotionBuilder, output_dir: Path, motion: dict, slug: str, overwrite: bool):
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{slug}.json"

    if output_path.exists() and not overwrite:
        return output_path, "skipped"

    builder.save(motion, output_path)
    return output_path, "written"


def write_landmark_debug_clip(output_dir: Path, payload: dict, video_id: str, overwrite: bool):
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{video_id}.json"

    if output_path.exists() and not overwrite:
        return output_path, "skipped"

    with open(output_path, "w", encoding="utf-8") as output_file:
        json.dump(payload, output_file, indent=2, ensure_ascii=False)

    return output_path, "written"


def refresh_manifest(manifest_path: Path, clips_dir: Path):
    if not manifest_path.exists():
        return None

    with open(manifest_path, "r", encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)

    clips = manifest.get("clips", [])
    manifest_root = manifest_path.parent.parent

    def resolve_motion_file(motion_path_value: str):
        normalized_motion_path = str(motion_path_value).lstrip("/").replace("\\", "/")
        return manifest_root / normalized_motion_path

    def resolve_landmark_file(landmark_path_value: str):
        normalized_landmark_path = str(landmark_path_value).lstrip("/").replace("\\", "/")
        return manifest_root / normalized_landmark_path

    for clip in clips:
        variants = clip.get("motionVariants") or clip.get("variants") or []
        video_ids = list(clip.get("videoIds", []))
        motion_paths = []
        landmark_paths = []
        normalized_variants = []
        ready_variant_count = 0

        if not variants and video_ids:
            variants = [
                {
                    "videoId": video_id,
                    "motionPath": f"/motion/clips/{video_id}.json",
                    "landmarkPath": f"/motion/landmarks/{video_id}.json",
                }
                for video_id in video_ids
            ]

        for variant in variants:
            if not isinstance(variant, dict):
                continue

            video_id = str(variant.get("videoId") or variant.get("video_id") or "").strip() or None
            motion_path = str(
                variant.get("motionPath")
                or variant.get("motion_path")
                or (f"/motion/clips/{video_id}.json" if video_id else "")
            ).strip()
            landmark_path = str(
                variant.get("landmarkPath")
                or variant.get("landmark_path")
                or (f"/motion/landmarks/{video_id}.json" if video_id else "")
            ).strip()

            if not motion_path:
                continue

            motion_file = resolve_motion_file(motion_path)
            status = "ready" if motion_file.exists() else "pending"
            landmark_file = resolve_landmark_file(landmark_path) if landmark_path else None
            landmark_status = "ready" if landmark_file and landmark_file.exists() else "pending"

            if status == "ready":
                ready_variant_count += 1

            motion_paths.append(motion_path)
            if landmark_path:
                landmark_paths.append(landmark_path)
            normalized_variants.append(
                {
                    "videoId": video_id,
                    "motionPath": motion_path,
                    "landmarkPath": landmark_path or None,
                    "status": status,
                    "landmarkStatus": landmark_status,
                    "sourceVideoPath": variant.get("sourceVideoPath") or variant.get("source_video_path"),
                }
            )

        if not normalized_variants:
            slug = str(clip.get("slug", "")).strip()
            fallback_motion_path = str(clip.get("motionPath") or f"/motion/clips/{slug}.json").strip()
            fallback_landmark_path = str(clip.get("landmarkPath") or f"/motion/landmarks/{clip.get('primaryVideoId') or slug}.json").strip()
            motion_file = resolve_motion_file(fallback_motion_path)
            landmark_file = resolve_landmark_file(fallback_landmark_path) if fallback_landmark_path else None
            normalized_variants = [
                {
                    "videoId": clip.get("primaryVideoId"),
                    "motionPath": fallback_motion_path,
                    "landmarkPath": fallback_landmark_path or None,
                    "status": "ready" if motion_file.exists() else "pending",
                    "landmarkStatus": "ready" if landmark_file and landmark_file.exists() else "pending",
                    "sourceVideoPath": clip.get("sourceVideoPath"),
                }
            ]
            motion_paths = [fallback_motion_path]
            if fallback_landmark_path:
                landmark_paths = [fallback_landmark_path]
            ready_variant_count = 1 if motion_file.exists() else 0

        primary_variant = next((variant for variant in normalized_variants if variant["status"] == "ready"), normalized_variants[0])
        primary_landmark_variant = next((variant for variant in normalized_variants if variant.get("landmarkStatus") == "ready"), normalized_variants[0])
        source_video_count = len(video_ids) or len(normalized_variants)
        clip["motionVariants"] = normalized_variants
        clip["motionPaths"] = motion_paths
        clip["landmarkPaths"] = landmark_paths
        clip["primaryMotionPath"] = primary_variant["motionPath"]
        clip["motionPath"] = primary_variant["motionPath"]
        clip["primaryLandmarkPath"] = primary_landmark_variant.get("landmarkPath")
        clip["landmarkPath"] = clip["primaryLandmarkPath"]
        clip["status"] = "ready" if ready_variant_count >= source_video_count and source_video_count > 0 else ("partial" if ready_variant_count > 0 else "pending")
        clip["readyVideoCount"] = ready_variant_count
        clip["sourceVideoCount"] = source_video_count

    manifest["clips"] = clips
    manifest["clipCount"] = len(clips)

    with open(manifest_path, "w", encoding="utf-8") as manifest_file:
        json.dump(manifest, manifest_file, indent=2, ensure_ascii=False)

    return manifest


def resolve_source_video_path(video_path_value, video_root: Path | None = None) -> Path:
    video_path = Path(str(video_path_value))

    if video_path.is_absolute():
        return video_path

    if video_root is not None:
        video_root = Path(video_root)
        candidates = [
            video_root / video_path,
            video_root / video_path.name,
        ]

        for candidate in candidates:
            if candidate.exists():
                return candidate

    return ROOT / video_path


def build_motion_from_video(item, output_dir: Path, overwrite: bool, target_fps: float, video_root: Path | None = None):
    video_path_value = item.get("videoPath")

    if not video_path_value:
        raise FileNotFoundError(f"Missing videoPath for videoId {item.get('videoId')}")

    video_path = resolve_source_video_path(video_path_value, video_root)

    if not video_path.exists():
        raise FileNotFoundError(f"Missing source video file: {video_path}")

    extracted = extract_landmark_sequences(video_path=video_path, target_fps=target_fps)
    motion_fps = extracted["fps"] or target_fps or DEFAULT_FPS
    builder = MotionBuilder(fps=motion_fps)
    landmark_output_dir = DEFAULT_LANDMARK_OUTPUT_DIR
    gloss = str(item["gloss"])
    slug = str(item["slug"])
    video_id = str(item["videoId"])
    motion_path_value = str(item.get("motionPath") or f"/motion/clips/{video_id}.json").strip()
    landmark_path_value = f"/motion/landmarks/{video_id}.json"

    body_frames = [frame.tolist() for frame in extracted["body"]]
    left_hand_frames = [frame.tolist() for frame in extracted["left_hand"]]
    right_hand_frames = [frame.tolist() for frame in extracted["right_hand"]]

    landmark_payload = {
        "version": "1.0",
        "name": gloss,
        "gloss": gloss,
        "slug": slug,
        "videoId": video_id,
        "videoPath": str(item.get("videoPath")),
        "source": item.get("source"),
        "fps": extracted["fps"],
        "frame_count": extracted["frameCount"],
        "frameStride": extracted["frameStride"],
        "frameSize": extracted["frameSize"],
        "poseDetectedFrames": extracted["poseDetectedFrames"],
        "leftHandDetectedFrames": extracted["leftHandDetectedFrames"],
        "rightHandDetectedFrames": extracted["rightHandDetectedFrames"],
        "coordinateSystem": {
            "name": "mediapipe_world_landmarks",
            "threejsTransform": ["x", "-y", "-z"],
            "units": "meters",
            "bodyAnchor": "hip_center",
            "leftHandAnchor": "LEFT_WRIST",
            "rightHandAnchor": "RIGHT_WRIST",
        },
        "body": body_frames,
        "left_hand": left_hand_frames,
        "right_hand": right_hand_frames,
    }

    motion = builder.build(
        extracted["body"],
        extracted["left_hand"],
        extracted["right_hand"],
        name=gloss,
        metadata={
            "gloss": gloss,
            "slug": slug,
            "videoId": video_id,
            "videoPath": str(item.get("videoPath")),
            "source": item.get("source"),
            "split": item.get("split"),
            "instanceId": item.get("instanceId"),
            "signerId": item.get("signerId"),
            "variationId": item.get("variationId"),
            "fps": motion_fps,
            "sourceFps": extracted["sourceFps"],
            "frameCount": extracted["frameCount"],
            "frameStride": extracted["frameStride"],
            "poseDetectedFrames": extracted["poseDetectedFrames"],
            "leftHandDetectedFrames": extracted["leftHandDetectedFrames"],
            "rightHandDetectedFrames": extracted["rightHandDetectedFrames"],
            "frameSize": extracted["frameSize"],
            "landmarkPath": landmark_path_value,
        },
    )

    motion["name"] = gloss
    motion["gloss"] = gloss
    motion["slug"] = slug
    motion["videoId"] = video_id
    motion["motionPath"] = motion_path_value
    motion["sourceVideoPath"] = str(item.get("videoPath"))
    motion["source"] = item.get("source")
    motion["landmarkPath"] = landmark_path_value

    output_filename = Path(motion_path_value).name if motion_path_value else f"{video_id}.json"
    output_slug = Path(output_filename).stem or video_id
    output_path, status = write_motion_clip(builder, output_dir, motion, output_slug, overwrite)
    landmark_output_path, landmark_status = write_landmark_debug_clip(
        output_dir=landmark_output_dir,
        payload=landmark_payload,
        video_id=video_id,
        overwrite=overwrite,
    )

    return {
        "gloss": gloss,
        "slug": slug,
        "videoId": video_id,
        "motionPath": motion_path_value,
        "landmarkPath": landmark_path_value,
        "sourceVideoPath": str(item.get("videoPath")),
        "outputPath": str(output_path),
        "landmarkOutputPath": str(landmark_output_path),
        "status": status,
        "landmarkStatus": landmark_status,
        "frameCount": motion["frame_count"],
        "fps": motion["fps"],
        "poseDetectedFrames": extracted["poseDetectedFrames"],
        "leftHandDetectedFrames": extracted["leftHandDetectedFrames"],
        "rightHandDetectedFrames": extracted["rightHandDetectedFrames"],
    }


def convert_single_recording(recording_path: Path, output_dir: Path, builder: MotionBuilder, overwrite: bool):
    loader = LandmarkLoader(recording_path.parent)
    recording_name = recording_path.name
    body, left_hand, right_hand, metadata = load_motion_data(loader, recording_name)
    gloss = metadata.get("gloss") or metadata.get("name") or recording_name
    slug = metadata.get("slug") or slugify(gloss)

    motion = builder.build(
        body,
        left_hand,
        right_hand,
        name=gloss,
        metadata={
            "recordingName": recording_name,
            "gloss": gloss,
            "slug": slug,
            "videoId": metadata.get("video_id") or metadata.get("videoId"),
            "sourceVideoPath": metadata.get("source_video_path"),
            "source": metadata.get("source"),
        },
    )

    motion["name"] = gloss
    motion["gloss"] = gloss
    motion["slug"] = slug
    motion["recordingName"] = recording_name

    output_path, status = write_motion_clip(builder, output_dir, motion, slug, overwrite)

    return {
        "gloss": gloss,
        "slug": slug,
        "recordingName": recording_name,
        "outputPath": str(output_path),
        "status": status,
        "frameCount": motion["frame_count"],
    }


def convert_video_item(task):
    item, output_dir_value, overwrite, target_fps, video_root_value, skip_updated_since = task

    video_id = str(item.get("videoId") or "").strip()
    output_dir = Path(output_dir_value)
    motion_filename = Path(str(item.get("motionPath") or f"/motion/clips/{video_id}.json")).name
    motion_file = output_dir / motion_filename
    landmark_file = output_dir.parent / "landmarks" / f"{video_id}.json"

    if (
        skip_updated_since is not None
        and motion_file.exists()
        and landmark_file.exists()
        and motion_file.stat().st_mtime >= skip_updated_since
        and landmark_file.stat().st_mtime >= skip_updated_since
    ):
        return {
            "status": "existing",
            "result": {
                "gloss": item.get("gloss"),
                "slug": item.get("slug"),
                "videoId": video_id,
                "motionPath": str(motion_file),
                "landmarkPath": str(landmark_file),
            },
        }

    try:
        result = build_motion_from_video(
            item=item,
            output_dir=output_dir,
            overwrite=overwrite,
            target_fps=target_fps,
            video_root=Path(video_root_value) if video_root_value else None,
        )
        return {"status": "generated", "result": result}
    except FileNotFoundError as error:
        return {
            "status": "missing",
            "result": {
                "gloss": item.get("gloss"),
                "slug": item.get("slug"),
                "videoId": item.get("videoId"),
                "videoPath": item.get("videoPath"),
                "error": str(error),
            },
        }
    except Exception as error:
        return {
            "status": "skipped",
            "result": {
                "gloss": item.get("gloss"),
                "slug": item.get("slug"),
                "videoId": item.get("videoId"),
                "videoPath": item.get("videoPath"),
                "error": repr(error),
            },
        }


def convert_batch(index_path: Path, recordings_dir: Path, output_dir: Path, manifest_path: Path, overwrite: bool, target_fps: float, limit: int | None = None, video_root: Path | None = None, workers: int = 1, skip_updated_since: float | None = None):
    index_items = load_index(index_path)

    report = {
        "indexPath": str(index_path),
        "recordingsDir": str(recordings_dir),
        "outputDir": str(output_dir),
        "generated": [],
        "existing": [],
        "skipped": [],
        "missing": [],
    }

    selected_items = index_items[:limit] if limit is not None else index_items
    task_values = [
        (
            item,
            str(output_dir),
            overwrite,
            target_fps,
            str(video_root) if video_root else None,
            skip_updated_since,
        )
        for item in selected_items
    ]
    worker_count = max(1, min(int(workers), len(task_values) or 1, os.cpu_count() or 1))

    if worker_count == 1:
        results = map(convert_video_item, task_values)
        for index, outcome in enumerate(results, start=1):
            if outcome["status"] == "generated":
                report["generated"].append(outcome["result"])
            elif outcome["status"] == "existing":
                report["existing"].append(outcome["result"])
            elif outcome["status"] == "missing":
                report["missing"].append(outcome["result"])
            else:
                report["skipped"].append(outcome["result"])
            if index % 25 == 0 or index == len(task_values):
                print(f"Processed {index}/{len(task_values)} videos", flush=True)
    else:
        with ProcessPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(convert_video_item, task) for task in task_values]
            for index, future in enumerate(as_completed(futures), start=1):
                outcome = future.result()
                if outcome["status"] == "generated":
                    report["generated"].append(outcome["result"])
                elif outcome["status"] == "existing":
                    report["existing"].append(outcome["result"])
                elif outcome["status"] == "missing":
                    report["missing"].append(outcome["result"])
                else:
                    report["skipped"].append(outcome["result"])
                if index % 25 == 0 or index == len(futures):
                    print(f"Processed {index}/{len(futures)} videos", flush=True)

    manifest = refresh_manifest(manifest_path, output_dir)
    report["manifestUpdated"] = manifest is not None
    report["generatedCount"] = len(report["generated"])
    report["existingCount"] = len(report["existing"])
    report["missingCount"] = len(report["missing"])
    report["skippedCount"] = len(report["skipped"])

    report_path = DEFAULT_REPORT_PATH
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as report_file:
        json.dump(report, report_file, indent=2, ensure_ascii=False)

    return report


def parse_args():
    parser = argparse.ArgumentParser(description="Convert local videos or processed recordings into motion clips.")
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX_PATH, help="Path to the local video-to-gloss index.")
    parser.add_argument("--recordings", type=Path, default=DEFAULT_RECORDINGS_DIR, help="Legacy root folder for processed landmark recordings.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_DIR, help="Folder where per-video motion clips are written.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH, help="Frontend manifest to refresh after conversion.")
    parser.add_argument("--recording", type=Path, help="Convert a single legacy recording folder instead of the batch video flow.")
    parser.add_argument("--video-root", type=Path, help="Optional directory containing the raw source videos.")
    parser.add_argument("--limit", type=int, help="Optional cap on the number of local videos to export.")
    parser.add_argument("--target-fps", type=float, default=DEFAULT_FPS, help="Target FPS used when sampling local videos for motion extraction.")
    parser.add_argument("--workers", type=int, default=1, help="Number of bounded video extraction workers.")
    parser.add_argument("--skip-updated-since", type=str, help="Skip clips and landmarks updated at or after this ISO timestamp.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite an existing clip file if it already exists.")
    return parser.parse_args()


def main():
    args = parse_args()

    if args.recording:
        builder = MotionBuilder()
        report = convert_single_recording(
            recording_path=args.recording,
            output_dir=args.output,
            builder=builder,
            overwrite=args.overwrite,
        )
        refresh_manifest(args.manifest, args.output)

        print("=" * 60)
        print("Single recording converted")
        print(json.dumps(report, indent=2, ensure_ascii=False))
        print("=" * 60)
        return

    skip_updated_since = None
    if args.skip_updated_since:
        skip_updated_since = datetime.fromisoformat(args.skip_updated_since).timestamp()

    report = convert_batch(
        index_path=args.index,
        recordings_dir=args.recordings,
        output_dir=args.output,
        manifest_path=args.manifest,
        overwrite=args.overwrite,
        target_fps=args.target_fps,
        limit=args.limit,
        video_root=args.video_root,
        workers=args.workers,
        skip_updated_since=skip_updated_since,
    )

    print("=" * 60)
    print("Batch motion conversion complete")
    print(f"Generated clips : {report['generatedCount']}")
    print(f"Already current : {report['existingCount']}")
    print(f"Missing glosses : {report['missingCount']}")
    print(f"Skipped glosses : {report['skippedCount']}")
    print(f"Report path     : {DEFAULT_REPORT_PATH}")
    print("=" * 60)


if __name__ == "__main__":
    main()
