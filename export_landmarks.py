from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


DEFAULT_RECORDING_ROOT = Path(__file__).resolve().parent / "converter" / "recordings"


def load_recording_parameters(recording_path: Path):
    parameters_path = recording_path / "output_data" / "recording_parameters.json"

    if not parameters_path.exists():
        return {}

    with open(parameters_path, "r", encoding="utf-8") as parameters_file:
        return json.load(parameters_file)


def export_landmarks(recording_path: Path, output_dir: Path, overwrite: bool = False, gloss: str | None = None, video_id: str | None = None, source_video_path: str | None = None):
    recording_path = Path(recording_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    output_data = recording_path / "output_data"
    files = {
        "body.json": "mediapipe_body_3d_xyz.npy",
        "left_hand.json": "mediapipe_left_hand_3d_xyz.npy",
        "right_hand.json": "mediapipe_right_hand_3d_xyz.npy",
    }

    exported = {}

    for json_name, npy_name in files.items():
        source_file = output_data / npy_name
        target_file = output_dir / json_name

        if not source_file.exists():
            raise FileNotFoundError(f"Missing landmark file: {source_file}")

        if target_file.exists() and not overwrite:
            exported[json_name] = str(target_file)
            continue

        data = np.load(source_file)

        with open(target_file, "w", encoding="utf-8") as target_handle:
            json.dump(data.tolist(), target_handle)

        exported[json_name] = str(target_file)

    recording_parameters = load_recording_parameters(recording_path)
    fps = (
        recording_parameters.get("post_processing_parameters_model", {})
        .get("framerate")
        or recording_parameters.get("framerate")
        or 30
    )

    metadata = {
        "recording_name": output_dir.name,
        "gloss": gloss,
        "video_id": video_id,
        "source_video_path": source_video_path,
        "recording_path": str(recording_path),
        "output_data_path": str(output_data),
        "fps": fps,
        "frame_count": int(np.load(output_data / files["body.json"]).shape[0]),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    metadata_path = output_dir / "metadata.json"
    with open(metadata_path, "w", encoding="utf-8") as metadata_handle:
        json.dump(metadata, metadata_handle, indent=2, ensure_ascii=False)

    exported["metadata.json"] = str(metadata_path)
    return exported


def parse_args():
    parser = argparse.ArgumentParser(description="Export FreeMoCap landmark arrays to JSON.")
    parser.add_argument("--recording-path", type=Path, required=True, help="Path to the FreeMoCap recording folder.")
    parser.add_argument("--output-dir", type=Path, help="Folder where the JSON landmarks should be written.")
    parser.add_argument("--gloss", type=str, help="Gloss label to store in metadata.")
    parser.add_argument("--video-id", type=str, help="Video id to store in metadata.")
    parser.add_argument("--source-video-path", type=str, help="Source video path to store in metadata.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing exported JSON files.")
    return parser.parse_args()


def main():
    args = parse_args()
    output_dir = args.output_dir or args.recording_path

    exported = export_landmarks(
        recording_path=args.recording_path,
        output_dir=output_dir,
        overwrite=args.overwrite,
        gloss=args.gloss,
        video_id=args.video_id,
        source_video_path=args.source_video_path,
    )

    print("Finished exporting.")
    print(json.dumps(exported, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
