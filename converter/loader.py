import json
from pathlib import Path


class LandmarkLoader:

    def __init__(self, recordings_dir="recordings"):
        self.recordings_dir = Path(recordings_dir)

    def list_recordings(self):
        if not self.recordings_dir.exists():
            return []

        return sorted(
            folder.name
            for folder in self.recordings_dir.iterdir()
            if folder.is_dir()
        )

    def recording_path(self, recording_name):
        return self.recordings_dir / recording_name

    def load_metadata(self, recording_name):
        folder = self.recording_path(recording_name)
        metadata_path = folder / "metadata.json"

        if not metadata_path.exists():
            return {}

        with open(metadata_path, "r", encoding="utf-8-sig") as metadata_file:
            return json.load(metadata_file)

    def load(self, recording_name):

        folder = self.recording_path(recording_name)

        if not folder.exists():
            raise FileNotFoundError(
                f"Recording '{recording_name}' not found."
            )

        with open(folder / "body.json", "r", encoding="utf-8") as f:
            body = json.load(f)

        with open(folder / "left_hand.json", "r", encoding="utf-8") as f:
            left = json.load(f)

        with open(folder / "right_hand.json", "r", encoding="utf-8") as f:
            right = json.load(f)

        return body, left, right
