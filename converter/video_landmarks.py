from __future__ import annotations

from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

try:
    from skeleton import BODY_LANDMARKS, HAND_LANDMARKS
except ImportError:  # pragma: no cover - keeps module usable as a package too
    from converter.skeleton import BODY_LANDMARKS, HAND_LANDMARKS


DEFAULT_TARGET_FPS = 30.0


def _landmark_list_to_array(landmark_list, expected_length: int):
    frame = np.zeros((expected_length, 3), dtype=float)

    if landmark_list is None:
        return frame

    points = getattr(landmark_list, "landmark", landmark_list)

    for index, landmark in enumerate(points[:expected_length]):
        frame[index] = [
            float(getattr(landmark, "x", 0.0)),
            float(getattr(landmark, "y", 0.0)),
            float(getattr(landmark, "z", 0.0)),
        ]

    return frame


def _hand_label(handedness):
    classifications = getattr(handedness, "classification", None)

    if not classifications:
        return None

    return str(getattr(classifications[0], "label", "")).strip().lower() or None


def _canonical_hand_label(handedness):
    label = _hand_label(handedness)
    return {
        "left": "right",
        "right": "left",
    }.get(label)


def _is_meaningful_frame(frame: np.ndarray) -> bool:
    return bool(np.isfinite(frame).all() and np.linalg.norm(frame) > 1e-6)


def extract_landmark_sequences(
    video_path: Path,
    target_fps: float = DEFAULT_TARGET_FPS,
    frame_stride: int | None = None,
    max_frames: int | None = None,
):
    video_path = Path(video_path)

    if not video_path.exists():
        raise FileNotFoundError(f"Missing video file: {video_path}")

    capture = cv2.VideoCapture(str(video_path))

    if not capture.isOpened():
        raise RuntimeError(f"Could not open video file: {video_path}")

    source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    source_frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    frame_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    if frame_stride is None:
        if target_fps and source_fps > target_fps:
            frame_stride = max(1, int(round(source_fps / float(target_fps))))
        else:
            frame_stride = 1

    effective_fps = source_fps / frame_stride if source_fps > 0 else float(target_fps or DEFAULT_TARGET_FPS)
    effective_fps = float(effective_fps or DEFAULT_TARGET_FPS)

    pose_frames = []
    left_hand_frames = []
    right_hand_frames = []

    processed_frames = 0
    pose_detected_frames = 0
    left_hand_detected_frames = 0
    right_hand_detected_frames = 0
    raw_frame_index = 0

    pose_options = dict(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    hands_options = dict(
        static_image_mode=False,
        max_num_hands=2,
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    try:
        with mp.solutions.pose.Pose(**pose_options) as pose, mp.solutions.hands.Hands(**hands_options) as hands:
            while True:
                success, frame = capture.read()

                if not success:
                    break

                raw_frame_index += 1

                if frame_stride > 1 and (raw_frame_index - 1) % frame_stride != 0:
                    continue

                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                rgb_frame.flags.writeable = False

                pose_results = pose.process(rgb_frame)
                hand_results = hands.process(rgb_frame)

                body_frame = np.zeros((len(BODY_LANDMARKS), 3), dtype=float)
                if pose_results.pose_world_landmarks is not None:
                    body_frame = _landmark_list_to_array(pose_results.pose_world_landmarks, len(BODY_LANDMARKS))
                    pose_detected_frames += 1

                left_hand_frame = np.zeros((len(HAND_LANDMARKS), 3), dtype=float)
                right_hand_frame = np.zeros((len(HAND_LANDMARKS), 3), dtype=float)

                hand_landmarks_list = hand_results.multi_hand_world_landmarks or []
                handedness_list = hand_results.multi_handedness or []

                for hand_index, hand_landmarks in enumerate(hand_landmarks_list):
                    label = _canonical_hand_label(handedness_list[hand_index]) if hand_index < len(handedness_list) else None
                    hand_frame = _landmark_list_to_array(hand_landmarks, len(HAND_LANDMARKS))

                    if label == "left":
                        left_hand_frame = hand_frame
                        if _is_meaningful_frame(hand_frame):
                            left_hand_detected_frames += 1
                    elif label == "right":
                        right_hand_frame = hand_frame
                        if _is_meaningful_frame(hand_frame):
                            right_hand_detected_frames += 1
                    elif not _is_meaningful_frame(left_hand_frame):
                        left_hand_frame = hand_frame
                        if _is_meaningful_frame(hand_frame):
                            left_hand_detected_frames += 1
                    elif not _is_meaningful_frame(right_hand_frame):
                        right_hand_frame = hand_frame
                        if _is_meaningful_frame(hand_frame):
                            right_hand_detected_frames += 1

                pose_frames.append(body_frame)
                left_hand_frames.append(left_hand_frame)
                right_hand_frames.append(right_hand_frame)

                processed_frames += 1

                if max_frames is not None and processed_frames >= max_frames:
                    break

    finally:
        capture.release()

    if pose_detected_frames == 0:
        raise ValueError(f"No pose landmarks were detected in {video_path}")

    return {
        "videoPath": str(video_path),
        "sourceFps": source_fps,
        "fps": effective_fps,
        "sourceFrameCount": source_frame_count,
        "frameCount": processed_frames,
        "frameStride": frame_stride,
        "frameSize": {
            "width": frame_width,
            "height": frame_height,
        },
        "poseDetectedFrames": pose_detected_frames,
        "leftHandDetectedFrames": left_hand_detected_frames,
        "rightHandDetectedFrames": right_hand_detected_frames,
        "body": pose_frames,
        "left_hand": left_hand_frames,
        "right_hand": right_hand_frames,
    }
