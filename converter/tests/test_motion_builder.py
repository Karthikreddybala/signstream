import numpy as np

from converter.motion_builder import (
    FINGER_CHAINS,
    FINGER_SEGMENTS,
    FINGER_REST_FORWARDS,
    HAND_REST_BASES,
    HAND_MAX_STEP_RADIANS,
    MotionBuilder,
    _quaternion_from_bases,
    _quaternion_matrix,
    rest_axis_errors,
)
from converter.skeleton import HAND_LANDMARKS


def test_finger_segments_cover_all_hand_landmark_segments() -> None:
    assert len(FINGER_SEGMENTS) == 30

    for side in ("LEFT", "RIGHT"):
        for finger in ("THUMB", "INDEX", "MIDDLE", "RING", "LITTLE"):
            prefix = f"{side}_{finger}_"
            segments = [
                pair
                for name, pair in FINGER_SEGMENTS.items()
                if name.startswith(prefix)
            ]
            assert len(segments) == 3
            assert all(start < end for start, end in segments)

    assert HAND_LANDMARKS["WRIST"] == 0
    assert HAND_LANDMARKS["PINKY_TIP"] == 20


def test_hand_landmark_smoothing_reduces_frame_noise() -> None:
    builder = MotionBuilder()
    frames = []

    for index in range(9):
        frame = np.zeros((21, 3), dtype=float)
        frame[0] = [0.0, 0.0, 0.0]
        frame[5] = [0.4 + (0.08 if index % 2 else -0.08), -0.1, 0.0]
        frame[9] = [0.0, -0.45 + (0.08 if index % 2 else -0.08), 0.0]
        frame[17] = [-0.4 + (0.08 if index % 2 else -0.08), -0.1, 0.0]
        frames.append(frame)

    smoothed = builder._smooth_hand_landmarks(frames)
    raw_variance = np.var([frame[5, 0] for frame in frames])
    smoothed_variance = np.var([frame[5, 0] for frame in smoothed])

    assert smoothed_variance < raw_variance
    assert np.all(np.isfinite(smoothed))


def test_hand_deadband_limits_reentry_after_tracking_loss() -> None:
    builder = MotionBuilder()

    def rotation(degrees: float) -> dict[str, float]:
        radians = np.radians(degrees) / 2.0
        return {
            "x": 0.0,
            "y": 0.0,
            "z": float(np.sin(radians)),
            "w": float(np.cos(radians)),
        }

    frames = [
        {"joints": {"LEFT_WRIST": {"rotation": rotation(0), "tracked": True}}},
        {"joints": {"LEFT_WRIST": {"rotation": rotation(0), "tracked": False}}},
        {"joints": {"LEFT_WRIST": {"rotation": rotation(140), "tracked": True}}},
    ]

    builder._apply_hand_deadband(frames)
    reentry = frames[-1]["joints"]["LEFT_WRIST"]["rotation"]
    reentry_angle = 2.0 * np.arccos(abs(float(reentry["w"])))

    assert reentry_angle <= HAND_MAX_STEP_RADIANS + 1e-6


def test_hand_deadband_keeps_last_valid_reentry_anchor() -> None:
    builder = MotionBuilder()

    def rotation(degrees: float) -> dict[str, float]:
        radians = np.radians(degrees) / 2.0
        return {
            "x": 0.0,
            "y": 0.0,
            "z": float(np.sin(radians)),
            "w": float(np.cos(radians)),
        }

    frames = [
        {"joints": {"LEFT_WRIST": {"rotation": rotation(30), "tracked": True}}},
        {"joints": {"LEFT_WRIST": {"rotation": rotation(0), "tracked": False}}},
        {"joints": {"LEFT_WRIST": {"rotation": rotation(120), "tracked": True}}},
    ]

    builder._apply_hand_deadband(frames)
    previous = _quaternion_array(frames[0]["joints"]["LEFT_WRIST"]["rotation"])
    current = _quaternion_array(frames[-1]["joints"]["LEFT_WRIST"]["rotation"])
    angle = 2.0 * np.arccos(abs(float(np.clip(np.dot(previous, current), -1.0, 1.0))))
    assert angle <= HAND_MAX_STEP_RADIANS + 1e-6


def _to_raw(three_point: np.ndarray) -> np.ndarray:
    return np.array([three_point[0], -three_point[1], -three_point[2]], dtype=float)


def _synthetic_hand(builder: MotionBuilder, side: str = "LEFT") -> np.ndarray:
    """Build a complete, straight hand in the converter's input space."""
    frame = np.zeros((21, 3), dtype=float)
    wrist = np.array([0.2, 0.3, 0.4], dtype=float)
    forward, across, _ = HAND_REST_BASES[f"{side}_WRIST"]
    points = {
        HAND_LANDMARKS["WRIST"]: wrist,
        HAND_LANDMARKS["INDEX_MCP"]: wrist + forward * 0.09 + across * 0.04,
        HAND_LANDMARKS["MIDDLE_MCP"]: wrist + forward * 0.10,
        HAND_LANDMARKS["RING_MCP"]: wrist + forward * 0.09 - across * 0.02,
        HAND_LANDMARKS["PINKY_MCP"]: wrist + forward * 0.08 - across * 0.04,
        HAND_LANDMARKS["THUMB_CMC"]: wrist + forward * 0.02 + across * 0.05,
    }

    segment_names = {
        "THUMB": ("METACARPAL", "PROXIMAL", "DISTAL"),
        "INDEX": ("PROXIMAL", "INTERMEDIATE", "DISTAL"),
        "MIDDLE": ("PROXIMAL", "INTERMEDIATE", "DISTAL"),
        "RING": ("PROXIMAL", "INTERMEDIATE", "DISTAL"),
        "LITTLE": ("PROXIMAL", "INTERMEDIATE", "DISTAL"),
    }
    for finger_name, chain in FINGER_CHAINS.items():
        start = points[chain[0]]
        for segment_name, (start_index, end_index) in zip(
            segment_names[finger_name],
            [FINGER_SEGMENTS[f"{side}_{finger_name}_{name}"] for name in segment_names[finger_name]],
        ):
            segment_start = points.get(start_index, start)
            segment_end = segment_start + builder.finger_rest_forwards[
                f"{side}_{finger_name}_{segment_name}"
            ] * 0.035
            points[start_index] = segment_start
            points[end_index] = segment_end
            start = segment_end

    for index, point in points.items():
        frame[index] = _to_raw(point)

    return frame


def _rotate_hand(frame: np.ndarray, rotation: np.ndarray) -> np.ndarray:
    three_points = np.column_stack((frame[:, 0], -frame[:, 1], -frame[:, 2]))
    origin = three_points[HAND_LANDMARKS["WRIST"]]
    rotated = origin + (rotation @ (three_points - origin).T).T
    return np.column_stack((rotated[:, 0], -rotated[:, 1], -rotated[:, 2]))


def _quaternion_array(value: dict[str, float]) -> np.ndarray:
    return np.array([value["x"], value["y"], value["z"], value["w"]], dtype=float)


def test_finger_rotation_constrains_twist_for_every_segment() -> None:
    builder = MotionBuilder()
    twist = _quaternion_matrix(
        [np.sin(np.radians(55.0) / 2.0), 0.0, 0.0, np.cos(np.radians(55.0) / 2.0)]
    )
    body_wrist = np.array([0.2, 0.3, 0.4], dtype=float)
    left_target_hand = None

    for side in ("LEFT", "RIGHT"):
        source_hand = _synthetic_hand(builder, side)
        target_hand = _rotate_hand(source_hand, twist)
        if side == "LEFT":
            left_target_hand = target_hand
        for joint_name in FINGER_SEGMENTS:
            if not joint_name.startswith(f"{side}_"):
                continue
            actual, tracked = builder._finger_rotation(
                target_hand,
                body_wrist,
                joint_name,
                chain_tracked=True,
                return_status=True,
            )
            source_basis = builder._finger_source_bases(joint_name)
            expected_basis = tuple(twist @ axis for axis in source_basis)
            expected = _quaternion_array(_quaternion_from_bases(source_basis, expected_basis))
            actual_array = _quaternion_array(actual)

            assert tracked is True
            assert abs(float(np.dot(actual_array, expected))) > 1.0 - 1e-5

    # A direction-only quaternion would be identity for the middle finger;
    # this assertion specifically catches the discarded roll/twist axes.
    middle = _quaternion_array(
        builder._finger_rotation(
            left_target_hand,
            body_wrist,
            "LEFT_MIDDLE_PROXIMAL",
        )
    )
    assert abs(float(middle[0])) > 0.2


def test_avatar_rest_axes_are_calibrated_for_all_30_finger_bones() -> None:
    builder = MotionBuilder()
    assert set(builder.finger_rest_forwards) == set(FINGER_REST_FORWARDS)
    errors = rest_axis_errors(builder.finger_rest_forwards)
    assert max(errors.values()) <= np.radians(2.0)


def test_incomplete_finger_chain_is_untracked_and_not_identity_tracked() -> None:
    builder = MotionBuilder()
    complete = _synthetic_hand(builder)
    _, first_state = builder._stabilize_hand_sequence(complete, None)

    missing = complete.copy()
    missing[HAND_LANDMARKS["MIDDLE_DIP"]] = np.nan
    stabilized, state = builder._stabilize_hand_sequence(missing, first_state)

    assert state["chain_tracked"]["MIDDLE"] is False
    rotation, tracked = builder._finger_rotation(
        stabilized,
        np.array([0.2, 0.3, 0.4], dtype=float),
        "LEFT_MIDDLE_INTERMEDIATE",
        chain_tracked=state["chain_tracked"]["MIDDLE"],
        return_status=True,
    )
    assert tracked is False
    assert rotation == builder._identity_rotation()


def test_implausible_bend_is_held_and_rejected() -> None:
    builder = MotionBuilder()
    complete = _synthetic_hand(builder)
    bad = complete.copy()
    three_points = np.column_stack((bad[:, 0], -bad[:, 1], -bad[:, 2]))
    middle_mcp = three_points[HAND_LANDMARKS["MIDDLE_MCP"]]
    middle_pip = middle_mcp + np.array([0.035, 0.0, 0.0])
    middle_dip = middle_pip - np.array([0.035, 0.0, 0.0])
    middle_tip = middle_dip + np.array([0.02, 0.0, 0.0])
    for index, point in zip(
        (
            HAND_LANDMARKS["MIDDLE_PIP"],
            HAND_LANDMARKS["MIDDLE_DIP"],
            HAND_LANDMARKS["MIDDLE_TIP"],
        ),
        (middle_pip, middle_dip, middle_tip),
    ):
        bad[index] = _to_raw(point)

    _, state = builder._stabilize_hand_sequence(bad, None)
    assert state["chain_tracked"]["MIDDLE"] is False


def test_complete_hand_clip_keeps_adjacent_segments_continuous() -> None:
    builder = MotionBuilder()
    source_hand = _synthetic_hand(builder)
    body_frames = [np.zeros((33, 3), dtype=float) for _ in range(8)]
    hand_frames = []
    for degrees in range(0, 32, 4):
        radians = np.radians(degrees)
        rotation = _quaternion_matrix(
            [0.0, np.sin(radians / 2.0), 0.0, np.cos(radians / 2.0)]
        )
        hand_frames.append(_rotate_hand(source_hand, rotation))

    clip = builder.build(body_frames, hand_frames, [], name="synthetic_regression")
    previous = {}
    for frame in clip["frames"]:
        for joint_name, data in frame["joints"].items():
            if joint_name not in FINGER_SEGMENTS or not joint_name.startswith("LEFT_"):
                continue
            assert data["tracked"] is True
            current = _quaternion_array(data["rotation"])
            if joint_name in previous:
                angle = 2.0 * np.arccos(abs(float(np.clip(np.dot(previous[joint_name], current), -1.0, 1.0))))
                assert angle <= HAND_MAX_STEP_RADIANS + 1e-6
            previous[joint_name] = current
