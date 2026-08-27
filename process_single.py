from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from freemocap.core_processes.process_motion_capture_videos.process_recording_headless import (
    process_recording_headless,
)
from freemocap.data_layer.recording_models.post_processing_parameter_models import (
    ProcessingParameterModel,
)


DEFAULT_RECORDING_ROOT = Path(__file__).resolve().parent / "converter" / "recordings"


def prepare_recording_folder(video_path: Path, recording_root: Path, recording_name: str | None = None, overwrite: bool = False):
    video_path = Path(video_path)
    recording_root = Path(recording_root)
    recording_name = recording_name or video_path.stem

    recording_path = recording_root / recording_name
    synchronized_videos_path = recording_path / "synchronized_videos"
    synchronized_videos_path.mkdir(parents=True, exist_ok=True)

    destination_video_path = synchronized_videos_path / video_path.name

    if destination_video_path.exists() and not overwrite:
        return recording_path

    shutil.copy2(video_path, destination_video_path)
    return recording_path


def run_single(video_path: Path, recording_root: Path, recording_name: str | None = None, overwrite: bool = False, run_blender: bool = False, make_jupyter_notebook: bool = False, use_tqdm: bool = True):
    recording_path = prepare_recording_folder(
        video_path=video_path,
        recording_root=recording_root,
        recording_name=recording_name,
        overwrite=overwrite,
    )

    process_recording_headless(
        recording_path=recording_path,
        recording_processing_parameter_model=ProcessingParameterModel(),
        run_blender=run_blender,
        make_jupyter_notebook=make_jupyter_notebook,
        use_tqdm=use_tqdm,
    )

    return recording_path


def parse_args():
    parser = argparse.ArgumentParser(description="Prepare and process a single WLASL video with FreeMoCap.")
    parser.add_argument("--video", type=Path, required=True, help="Path to the raw video file to process.")
    parser.add_argument("--recording-root", type=Path, default=DEFAULT_RECORDING_ROOT, help="Root folder where recording sessions are created.")
    parser.add_argument("--recording-name", type=str, help="Optional recording folder name. Defaults to the video stem.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite the copied video if it already exists.")
    parser.add_argument("--run-blender", action="store_true", help="Also run the Blender export step.")
    parser.add_argument("--make-jupyter-notebook", action="store_true", help="Generate the FreeMoCap notebook after processing.")
    parser.add_argument("--quiet", action="store_true", help="Disable tqdm progress output.")
    return parser.parse_args()


def main():
    args = parse_args()

    recording_path = run_single(
        video_path=args.video,
        recording_root=args.recording_root,
        recording_name=args.recording_name,
        overwrite=args.overwrite,
        run_blender=args.run_blender,
        make_jupyter_notebook=args.make_jupyter_notebook,
        use_tqdm=not args.quiet,
    )

    print("Processing completed!")
    print(recording_path)


if __name__ == "__main__":
    main()
