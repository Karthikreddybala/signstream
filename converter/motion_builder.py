from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import numpy as np

try:
    from skeleton import BODY_LANDMARKS, HAND_LANDMARKS, is_valid_point, midpoint, to_three_space
except ImportError:  # pragma: no cover - keeps module usable as a package too
    from converter.skeleton import BODY_LANDMARKS, HAND_LANDMARKS, is_valid_point, midpoint, to_three_space

CANONICAL_JOINTS = [
    "PELVIS",
    "SPINE1",
    "SPINE2",
    "SPINE3",
    "NECK",
    "HEAD",
    "LEFT_COLLAR",
    "RIGHT_COLLAR",
    "LEFT_SHOULDER",
    "RIGHT_SHOULDER",
    "LEFT_ELBOW",
    "RIGHT_ELBOW",
    "LEFT_WRIST",
    "RIGHT_WRIST",
    "LEFT_HIP",
    "RIGHT_HIP",
    "LEFT_KNEE",
    "RIGHT_KNEE",
    "LEFT_ANKLE",
    "RIGHT_ANKLE",
    "LEFT_FOOT",
    "RIGHT_FOOT",
]

FINGER_SEGMENTS = {
    "LEFT_THUMB_METACARPAL": (HAND_LANDMARKS["THUMB_CMC"], HAND_LANDMARKS["THUMB_MCP"]),
    "LEFT_THUMB_PROXIMAL": (HAND_LANDMARKS["THUMB_MCP"], HAND_LANDMARKS["THUMB_IP"]),
    "LEFT_THUMB_DISTAL": (HAND_LANDMARKS["THUMB_IP"], HAND_LANDMARKS["THUMB_TIP"]),
    "LEFT_INDEX_PROXIMAL": (HAND_LANDMARKS["INDEX_MCP"], HAND_LANDMARKS["INDEX_PIP"]),
    "LEFT_INDEX_INTERMEDIATE": (HAND_LANDMARKS["INDEX_PIP"], HAND_LANDMARKS["INDEX_DIP"]),
    "LEFT_INDEX_DISTAL": (HAND_LANDMARKS["INDEX_DIP"], HAND_LANDMARKS["INDEX_TIP"]),
    "LEFT_MIDDLE_PROXIMAL": (HAND_LANDMARKS["MIDDLE_MCP"], HAND_LANDMARKS["MIDDLE_PIP"]),
    "LEFT_MIDDLE_INTERMEDIATE": (HAND_LANDMARKS["MIDDLE_PIP"], HAND_LANDMARKS["MIDDLE_DIP"]),
    "LEFT_MIDDLE_DISTAL": (HAND_LANDMARKS["MIDDLE_DIP"], HAND_LANDMARKS["MIDDLE_TIP"]),
    "LEFT_RING_PROXIMAL": (HAND_LANDMARKS["RING_MCP"], HAND_LANDMARKS["RING_PIP"]),
    "LEFT_RING_INTERMEDIATE": (HAND_LANDMARKS["RING_PIP"], HAND_LANDMARKS["RING_DIP"]),
    "LEFT_RING_DISTAL": (HAND_LANDMARKS["RING_DIP"], HAND_LANDMARKS["RING_TIP"]),
    "LEFT_LITTLE_PROXIMAL": (HAND_LANDMARKS["PINKY_MCP"], HAND_LANDMARKS["PINKY_PIP"]),
    "LEFT_LITTLE_INTERMEDIATE": (HAND_LANDMARKS["PINKY_PIP"], HAND_LANDMARKS["PINKY_DIP"]),
    "LEFT_LITTLE_DISTAL": (HAND_LANDMARKS["PINKY_DIP"], HAND_LANDMARKS["PINKY_TIP"]),
    "RIGHT_THUMB_METACARPAL": (HAND_LANDMARKS["THUMB_CMC"], HAND_LANDMARKS["THUMB_MCP"]),
    "RIGHT_THUMB_PROXIMAL": (HAND_LANDMARKS["THUMB_MCP"], HAND_LANDMARKS["THUMB_IP"]),
    "RIGHT_THUMB_DISTAL": (HAND_LANDMARKS["THUMB_IP"], HAND_LANDMARKS["THUMB_TIP"]),
    "RIGHT_INDEX_PROXIMAL": (HAND_LANDMARKS["INDEX_MCP"], HAND_LANDMARKS["INDEX_PIP"]),
    "RIGHT_INDEX_INTERMEDIATE": (HAND_LANDMARKS["INDEX_PIP"], HAND_LANDMARKS["INDEX_DIP"]),
    "RIGHT_INDEX_DISTAL": (HAND_LANDMARKS["INDEX_DIP"], HAND_LANDMARKS["INDEX_TIP"]),
    "RIGHT_MIDDLE_PROXIMAL": (HAND_LANDMARKS["MIDDLE_MCP"], HAND_LANDMARKS["MIDDLE_PIP"]),
    "RIGHT_MIDDLE_INTERMEDIATE": (HAND_LANDMARKS["MIDDLE_PIP"], HAND_LANDMARKS["MIDDLE_DIP"]),
    "RIGHT_MIDDLE_DISTAL": (HAND_LANDMARKS["MIDDLE_DIP"], HAND_LANDMARKS["MIDDLE_TIP"]),
    "RIGHT_RING_PROXIMAL": (HAND_LANDMARKS["RING_MCP"], HAND_LANDMARKS["RING_PIP"]),
    "RIGHT_RING_INTERMEDIATE": (HAND_LANDMARKS["RING_PIP"], HAND_LANDMARKS["RING_DIP"]),
    "RIGHT_RING_DISTAL": (HAND_LANDMARKS["RING_DIP"], HAND_LANDMARKS["RING_TIP"]),
    "RIGHT_LITTLE_PROXIMAL": (HAND_LANDMARKS["PINKY_MCP"], HAND_LANDMARKS["PINKY_PIP"]),
    "RIGHT_LITTLE_INTERMEDIATE": (HAND_LANDMARKS["PINKY_PIP"], HAND_LANDMARKS["PINKY_DIP"]),
    "RIGHT_LITTLE_DISTAL": (HAND_LANDMARKS["PINKY_DIP"], HAND_LANDMARKS["PINKY_TIP"]),
}

CANONICAL_JOINTS.extend(FINGER_SEGMENTS)
HAND_MOTION_JOINTS = {
    "LEFT_WRIST",
    "RIGHT_WRIST",
    *FINGER_SEGMENTS,
}
SMOOTHING_WEIGHTS = (1.0, 2.0, 3.0, 2.0, 1.0)
HAND_LANDMARK_SMOOTHING_WEIGHTS = (1.0, 2.0, 3.0, 4.0, 3.0, 2.0, 1.0)
HAND_ROTATION_SMOOTHING_WEIGHTS = (1.0, 2.0, 3.0, 4.0, 3.0, 2.0, 1.0)
HAND_DEADBAND_RADIANS = math.radians(1.2)
HAND_MAX_STEP_RADIANS = math.radians(16.0)
HAND_HOLD_FRAMES = 5
HAND_CORE_INDICES = (
    HAND_LANDMARKS["WRIST"],
    HAND_LANDMARKS["INDEX_MCP"],
    HAND_LANDMARKS["MIDDLE_MCP"],
    HAND_LANDMARKS["PINKY_MCP"],
)
FINGER_CHAINS = {
    "THUMB": (
        HAND_LANDMARKS["THUMB_CMC"],
        HAND_LANDMARKS["THUMB_MCP"],
        HAND_LANDMARKS["THUMB_IP"],
        HAND_LANDMARKS["THUMB_TIP"],
    ),
    "INDEX": (
        HAND_LANDMARKS["INDEX_MCP"],
        HAND_LANDMARKS["INDEX_PIP"],
        HAND_LANDMARKS["INDEX_DIP"],
        HAND_LANDMARKS["INDEX_TIP"],
    ),
    "MIDDLE": (
        HAND_LANDMARKS["MIDDLE_MCP"],
        HAND_LANDMARKS["MIDDLE_PIP"],
        HAND_LANDMARKS["MIDDLE_DIP"],
        HAND_LANDMARKS["MIDDLE_TIP"],
    ),
    "RING": (
        HAND_LANDMARKS["RING_MCP"],
        HAND_LANDMARKS["RING_PIP"],
        HAND_LANDMARKS["RING_DIP"],
        HAND_LANDMARKS["RING_TIP"],
    ),
    "LITTLE": (
        HAND_LANDMARKS["PINKY_MCP"],
        HAND_LANDMARKS["PINKY_PIP"],
        HAND_LANDMARKS["PINKY_DIP"],
        HAND_LANDMARKS["PINKY_TIP"],
    ),
}
# Angles are measured between consecutive forward segment vectors. A straight
# finger is 0 degrees; a reversed/near-folded chain approaches 180 degrees.
# These limits are deliberately conservative so impossible bends are held,
# rather than being converted into a plausible-looking but wrong quaternion.
FINGER_MAX_BEND_ANGLES = {
    "THUMB": (math.radians(85.0), math.radians(90.0)),
    "INDEX": (math.radians(100.0), math.radians(110.0)),
    "MIDDLE": (math.radians(100.0), math.radians(110.0)),
    "RING": (math.radians(100.0), math.radians(110.0)),
    "LITTLE": (math.radians(105.0), math.radians(115.0)),
}
DEFAULT_AVATAR_PATH = Path(__file__).resolve().parents[1] / "frontend" / "public" / "avatar.vrm"
LOCKED_BODY_JOINTS = {
    "PELVIS",
    "SPINE1",
    "SPINE2",
    "SPINE3",
    "NECK",
    "HEAD",
    "LEFT_COLLAR",
    "RIGHT_COLLAR",
    "LEFT_HIP",
    "RIGHT_HIP",
    "LEFT_KNEE",
    "RIGHT_KNEE",
    "LEFT_ANKLE",
    "RIGHT_ANKLE",
    "LEFT_FOOT",
    "RIGHT_FOOT",
}

REST_AXES = {
    "PELVIS": np.array([0.0, 1.0, 0.0], dtype=float),
    "SPINE1": np.array([0.0, 0.99963606, 0.02697674], dtype=float),
    "SPINE2": np.array([0.0, 0.99086969, -0.13482305], dtype=float),
    "SPINE3": np.array([0.0, 0.96044321, -0.27847593], dtype=float),
    "NECK": np.array([0.0, 0.99337124, 0.11495031], dtype=float),
    "HEAD": np.array([0.0, 1.0, 0.0], dtype=float),
    "LEFT_COLLAR": np.array([0.99002725, -0.14087597, 0.0], dtype=float),
    "RIGHT_COLLAR": np.array([-0.99002725, -0.14087597, 0.0], dtype=float),
    "LEFT_SHOULDER": np.array([1.0, 0.0, 0.0], dtype=float),
    "RIGHT_SHOULDER": np.array([-1.0, 0.0, 0.0], dtype=float),
    "LEFT_ELBOW": np.array([1.0, 0.0, 0.0], dtype=float),
    "RIGHT_ELBOW": np.array([-1.0, 0.0, 0.0], dtype=float),
    "LEFT_WRIST": np.array([1.0, 0.0, 0.0], dtype=float),
    "RIGHT_WRIST": np.array([-1.0, 0.0, 0.0], dtype=float),
    "LEFT_HIP": np.array([0.0, -0.99978110, -0.02092237], dtype=float),
    "RIGHT_HIP": np.array([0.0, -0.99978110, -0.02092237], dtype=float),
    "LEFT_KNEE": np.array([0.0, -0.99819998, -0.05997332], dtype=float),
    "RIGHT_KNEE": np.array([0.0, -0.99819998, -0.05997332], dtype=float),
    "LEFT_ANKLE": np.array([0.0, -0.49497944, 0.86890468], dtype=float),
    "RIGHT_ANKLE": np.array([0.0, -0.49497944, 0.86890468], dtype=float),
    "LEFT_FOOT": np.array([0.0, -0.49497944, 0.86890468], dtype=float),
    "RIGHT_FOOT": np.array([0.0, -0.49497944, 0.86890468], dtype=float),
}

HAND_REST_BASES = {
    "LEFT_WRIST": (
        np.array([1.0, 0.0, 0.0], dtype=float),
        np.array([0.0, 0.0, 1.0], dtype=float),
        np.array([0.0, -1.0, 0.0], dtype=float),
    ),
    "RIGHT_WRIST": (
        np.array([-1.0, 0.0, 0.0], dtype=float),
        np.array([0.0, 0.0, 1.0], dtype=float),
        np.array([0.0, 1.0, 0.0], dtype=float),
    ),
}

FINGER_REST_FORWARDS = {
    "LEFT_THUMB_METACARPAL": np.array([0.759129, -0.044261, 0.649434], dtype=float),
    "LEFT_THUMB_PROXIMAL": np.array([0.787201, -0.033851, 0.615767], dtype=float),
    "LEFT_THUMB_DISTAL": np.array([0.787201, -0.033851, 0.615767], dtype=float),
    "LEFT_INDEX_PROXIMAL": np.array([0.999811, 0.0, -0.019424], dtype=float),
    "LEFT_INDEX_INTERMEDIATE": np.array([0.998841, -0.028877, -0.038520], dtype=float),
    "LEFT_INDEX_DISTAL": np.array([0.998841, -0.028877, -0.038520], dtype=float),
    "LEFT_MIDDLE_PROXIMAL": np.array([1.0, 0.0, 0.0], dtype=float),
    "LEFT_MIDDLE_INTERMEDIATE": np.array([1.0, 0.0, 0.0], dtype=float),
    "LEFT_MIDDLE_DISTAL": np.array([1.0, 0.0, 0.0], dtype=float),
    "LEFT_RING_PROXIMAL": np.array([1.0, 0.0, 0.0], dtype=float),
    "LEFT_RING_INTERMEDIATE": np.array([1.0, 0.0, 0.0], dtype=float),
    "LEFT_RING_DISTAL": np.array([1.0, 0.0, 0.0], dtype=float),
    "LEFT_LITTLE_PROXIMAL": np.array([1.0, 0.0, 0.0], dtype=float),
    "LEFT_LITTLE_INTERMEDIATE": np.array([1.0, 0.0, 0.0], dtype=float),
    "LEFT_LITTLE_DISTAL": np.array([1.0, 0.0, 0.0], dtype=float),
    "RIGHT_THUMB_METACARPAL": np.array([-0.759129, -0.044261, 0.649434], dtype=float),
    "RIGHT_THUMB_PROXIMAL": np.array([-0.787201, -0.033851, 0.615767], dtype=float),
    "RIGHT_THUMB_DISTAL": np.array([-0.787201, -0.033851, 0.615767], dtype=float),
    "RIGHT_INDEX_PROXIMAL": np.array([-0.999811, 0.0, -0.019424], dtype=float),
    "RIGHT_INDEX_INTERMEDIATE": np.array([-0.998841, -0.028877, -0.038520], dtype=float),
    "RIGHT_INDEX_DISTAL": np.array([-0.998841, -0.028877, -0.038520], dtype=float),
    "RIGHT_MIDDLE_PROXIMAL": np.array([-1.0, 0.0, 0.0], dtype=float),
    "RIGHT_MIDDLE_INTERMEDIATE": np.array([-1.0, 0.0, 0.0], dtype=float),
    "RIGHT_MIDDLE_DISTAL": np.array([-1.0, 0.0, 0.0], dtype=float),
    "RIGHT_RING_PROXIMAL": np.array([-1.0, 0.0, 0.0], dtype=float),
    "RIGHT_RING_INTERMEDIATE": np.array([-1.0, 0.0, 0.0], dtype=float),
    "RIGHT_RING_DISTAL": np.array([-1.0, 0.0, 0.0], dtype=float),
    "RIGHT_LITTLE_PROXIMAL": np.array([-1.0, 0.0, 0.0], dtype=float),
    "RIGHT_LITTLE_INTERMEDIATE": np.array([-1.0, 0.0, 0.0], dtype=float),
    "RIGHT_LITTLE_DISTAL": np.array([-1.0, 0.0, 0.0], dtype=float),
}

# The avatar has three bones per finger. The proximal/intermediate names in
# the motion format map to avatar nodes 1/2 for non-thumb fingers, while the
# thumb uses nodes 1/2/3 directly.
FINGER_AVATAR_NODES = {}
for _side in ("LEFT", "RIGHT"):
    _avatar_side = "L" if _side == "LEFT" else "R"
    for _finger, _avatar_finger in (
        ("THUMB", "Thumb"),
        ("INDEX", "Index"),
        ("MIDDLE", "Middle"),
        ("RING", "Ring"),
        ("LITTLE", "Little"),
    ):
        _segments = (1, 2, 3)
        for _segment_name, _node_index in zip(
            ("METACARPAL", "PROXIMAL", "DISTAL") if _finger == "THUMB" else ("PROXIMAL", "INTERMEDIATE", "DISTAL"),
            _segments,
        ):
            FINGER_AVATAR_NODES[f"{_side}_{_finger}_{_segment_name}"] = (
                f"J_Bip_{_avatar_side}_{_avatar_finger}{_node_index}"
            )

BODY_CHAIN = {
    "PELVIS": ("hip_center", "shoulder_center"),
    "SPINE1": ("hip_center", "shoulder_center"),
    "SPINE2": ("shoulder_center", "neck_point"),
    "SPINE3": ("neck_point", "head_point"),
    "NECK": ("shoulder_center", "head_point"),
    "HEAD": ("neck_point", "head_point"),
    "LEFT_COLLAR": ("shoulder_center", "left_shoulder"),
    "RIGHT_COLLAR": ("shoulder_center", "right_shoulder"),
    "LEFT_SHOULDER": ("left_shoulder", "left_elbow"),
    "RIGHT_SHOULDER": ("right_shoulder", "right_elbow"),
    "LEFT_ELBOW": ("left_elbow", "left_wrist"),
    "RIGHT_ELBOW": ("right_elbow", "right_wrist"),
    "LEFT_WRIST": ("left_wrist", "left_hand_target"),
    "RIGHT_WRIST": ("right_wrist", "right_hand_target"),
    "LEFT_HIP": ("left_hip", "left_knee"),
    "RIGHT_HIP": ("right_hip", "right_knee"),
    "LEFT_KNEE": ("left_knee", "left_ankle"),
    "RIGHT_KNEE": ("right_knee", "right_ankle"),
    "LEFT_ANKLE": ("left_ankle", "left_foot_index"),
    "RIGHT_ANKLE": ("right_ankle", "right_foot_index"),
    "LEFT_FOOT": ("left_ankle", "left_foot_index"),
    "RIGHT_FOOT": ("right_ankle", "right_foot_index"),
}

MIN_DIRECTION_LENGTH = 1e-6


def _slugify(value: str) -> str:
    return (
        str(value)
        .strip()
        .lower()
        .replace(" ", "_")
        .replace("/", "_")
        .replace("-", "_")
    )


def _to_json_number(value: float) -> float:
    if not np.isfinite(value):
        return 0.0
    return float(value)


def _normalize_vector(vector: np.ndarray, fallback: np.ndarray) -> np.ndarray:
    vector = np.asarray(vector, dtype=float).reshape(3)
    length = np.linalg.norm(vector)

    if not np.isfinite(length) or length < MIN_DIRECTION_LENGTH:
        fallback = np.asarray(fallback, dtype=float).reshape(3)
        fallback_length = np.linalg.norm(fallback)

        if fallback_length < MIN_DIRECTION_LENGTH:
            return np.array([0.0, 1.0, 0.0], dtype=float)

        return fallback / fallback_length

    return vector / length


def _quaternion_from_unit_vectors(source: np.ndarray, target: np.ndarray) -> dict:
    source = _normalize_vector(source, np.array([0.0, 1.0, 0.0], dtype=float))
    target = _normalize_vector(target, np.array([0.0, 1.0, 0.0], dtype=float))

    dot = float(np.clip(np.dot(source, target), -1.0, 1.0))

    if dot > 0.999999:
        return {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}

    if dot < -0.999999:
        axis = np.cross(source, np.array([1.0, 0.0, 0.0], dtype=float))

        if np.linalg.norm(axis) < MIN_DIRECTION_LENGTH:
            axis = np.cross(source, np.array([0.0, 1.0, 0.0], dtype=float))

        axis = _normalize_vector(axis, np.array([0.0, 0.0, 1.0], dtype=float))

        return {
            "x": float(axis[0]),
            "y": float(axis[1]),
            "z": float(axis[2]),
            "w": 0.0,
        }

    cross = np.cross(source, target)
    quaternion = np.array(
        [cross[0], cross[1], cross[2], 1.0 + dot],
        dtype=float,
    )
    quaternion_length = np.linalg.norm(quaternion)

    if quaternion_length < MIN_DIRECTION_LENGTH:
        return {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}

    quaternion /= quaternion_length

    return {
        "x": float(quaternion[0]),
        "y": float(quaternion[1]),
        "z": float(quaternion[2]),
        "w": float(quaternion[3]),
    }


def _quaternion_from_bases(source_basis, target_basis) -> dict:
    source_matrix = np.column_stack(source_basis)
    target_matrix = np.column_stack(target_basis)
    rotation = target_matrix @ source_matrix.T
    trace = float(np.trace(rotation))

    if trace > 0.0:
        scale = math.sqrt(trace + 1.0) * 2.0
        quaternion = np.array([
            (rotation[2, 1] - rotation[1, 2]) / scale,
            (rotation[0, 2] - rotation[2, 0]) / scale,
            (rotation[1, 0] - rotation[0, 1]) / scale,
            0.25 * scale,
        ])
    elif rotation[0, 0] > rotation[1, 1] and rotation[0, 0] > rotation[2, 2]:
        scale = math.sqrt(1.0 + rotation[0, 0] - rotation[1, 1] - rotation[2, 2]) * 2.0
        quaternion = np.array([
            0.25 * scale,
            (rotation[0, 1] + rotation[1, 0]) / scale,
            (rotation[0, 2] + rotation[2, 0]) / scale,
            (rotation[2, 1] - rotation[1, 2]) / scale,
        ])
    elif rotation[1, 1] > rotation[2, 2]:
        scale = math.sqrt(1.0 + rotation[1, 1] - rotation[0, 0] - rotation[2, 2]) * 2.0
        quaternion = np.array([
            (rotation[0, 1] + rotation[1, 0]) / scale,
            0.25 * scale,
            (rotation[1, 2] + rotation[2, 1]) / scale,
            (rotation[0, 2] - rotation[2, 0]) / scale,
        ])
    else:
        scale = math.sqrt(1.0 + rotation[2, 2] - rotation[0, 0] - rotation[1, 1]) * 2.0
        quaternion = np.array([
            (rotation[0, 2] + rotation[2, 0]) / scale,
            (rotation[1, 2] + rotation[2, 1]) / scale,
            0.25 * scale,
            (rotation[1, 0] - rotation[0, 1]) / scale,
        ])

    quaternion_length = np.linalg.norm(quaternion)

    if not np.isfinite(quaternion_length) or quaternion_length < MIN_DIRECTION_LENGTH:
        quaternion = np.array([0.0, 0.0, 0.0, 1.0], dtype=float)
    else:
        quaternion = quaternion / quaternion_length

    return {
        "x": float(quaternion[0]),
        "y": float(quaternion[1]),
        "z": float(quaternion[2]),
        "w": float(quaternion[3]),
    }


def _quaternion_matrix(quaternion) -> np.ndarray:
    x, y, z, w = np.asarray(quaternion, dtype=float)
    return np.array(
        [
            [1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - z * w), 2.0 * (x * z + y * w)],
            [2.0 * (x * y + z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - x * w)],
            [2.0 * (x * z - y * w), 2.0 * (y * z + x * w), 1.0 - 2.0 * (x * x + y * y)],
        ],
        dtype=float,
    )


def load_avatar_finger_rest_forwards(avatar_path: Path | str) -> dict[str, np.ndarray]:
    """Read the actual rest directions from a VRM's bone transforms.

    The converter intentionally does not depend on a GLTF package. VRM 1.0
    is a GLB, so the small JSON-only reader below is enough to derive the
    direction of every mapped finger bone from its child (or its parent for a
    terminal bone). This keeps backend source axes synchronized with the
    avatar used by the frontend, including thumb axes.
    """
    path = Path(avatar_path)
    if not path.exists():
        return {}

    try:
        data = path.read_bytes()
        if data[:4] != b"glTF":
            return {}

        offset = 12
        json_chunk = None
        while offset + 8 <= len(data):
            chunk_length, chunk_type = struct.unpack_from("<I4s", data, offset)
            offset += 8
            chunk = data[offset:offset + chunk_length]
            offset += chunk_length
            if chunk_type == b"JSON":
                json_chunk = chunk
                break

        if json_chunk is None:
            return {}

        document = json.loads(json_chunk.decode("utf-8"))
        nodes = document.get("nodes", [])
        parents = {
            child_index: node_index
            for node_index, node in enumerate(nodes)
            for child_index in node.get("children", [])
        }
        world_cache = {}

        def world_transform(node_index):
            if node_index in world_cache:
                return world_cache[node_index]

            node = nodes[node_index]
            translation = np.asarray(node.get("translation", (0.0, 0.0, 0.0)), dtype=float)
            rotation = _quaternion_matrix(node.get("rotation", (0.0, 0.0, 0.0, 1.0)))
            scale = np.asarray(node.get("scale", (1.0, 1.0, 1.0)), dtype=float)
            parent_index = parents.get(node_index)

            if parent_index is None:
                result = (translation, rotation @ np.diag(scale))
            else:
                parent_position, parent_rotation = world_transform(parent_index)
                result = (
                    parent_position + parent_rotation @ translation,
                    parent_rotation @ rotation @ np.diag(scale),
                )

            world_cache[node_index] = result
            return result

        node_by_name = {
            str(node.get("name")): index
            for index, node in enumerate(nodes)
            if node.get("name")
        }
        axes = {}

        for joint_name, node_name in FINGER_AVATAR_NODES.items():
            node_index = node_by_name.get(node_name)
            if node_index is None:
                return {}

            start, _ = world_transform(node_index)
            children = nodes[node_index].get("children", [])
            if children:
                end, _ = world_transform(children[0])
                direction = end - start
            else:
                parent_index = parents.get(node_index)
                if parent_index is None:
                    direction = world_transform(node_index)[1] @ np.array([1.0, 0.0, 0.0])
                else:
                    parent_start, _ = world_transform(parent_index)
                    direction = start - parent_start

            if np.linalg.norm(direction) < MIN_DIRECTION_LENGTH:
                return {}

            axes[joint_name] = _normalize_vector(
                direction,
                FINGER_REST_FORWARDS[joint_name],
            )

        return axes
    except (OSError, ValueError, KeyError, IndexError, json.JSONDecodeError, struct.error):
        return {}


def rest_axis_errors(
    computed_axes: dict[str, np.ndarray],
    reference_axes: dict[str, np.ndarray] = FINGER_REST_FORWARDS,
) -> dict[str, float]:
    """Return per-bone angular errors in radians for calibration tests."""
    errors = {}
    for joint_name, reference in reference_axes.items():
        computed = computed_axes.get(joint_name)
        if computed is None:
            errors[joint_name] = math.inf
            continue

        dot = float(np.clip(np.dot(_normalize_vector(computed, reference), _normalize_vector(reference, computed)), -1.0, 1.0))
        errors[joint_name] = math.acos(dot)
    return errors


class MotionBuilder:

    def __init__(
        self,
        fps: float = 30.0,
        scale: float = 1.0,
        avatar_path: Path | str | None = DEFAULT_AVATAR_PATH,
    ):
        self.fps = float(fps)
        self.scale = float(scale)
        self.avatar_path = Path(avatar_path) if avatar_path else None
        self.finger_rest_forwards = dict(FINGER_REST_FORWARDS)
        if self.avatar_path:
            self.finger_rest_forwards.update(
                load_avatar_finger_rest_forwards(self.avatar_path)
            )

    def build(self, body_frames, left_hand_frames, right_hand_frames, name: str, metadata: dict | None = None):
        body_frames = self._prepare_sequence(body_frames, 33)
        left_hand_frames = self._smooth_hand_landmarks(
            self._prepare_sequence(left_hand_frames, 21)
        )
        right_hand_frames = self._smooth_hand_landmarks(
            self._prepare_sequence(right_hand_frames, 21)
        )

        if not body_frames:
            raise ValueError("Body landmark sequence is empty.")

        total_frames = max(len(body_frames), len(left_hand_frames), len(right_hand_frames))
        output_frames = []

        body_state = None
        left_state = None
        right_state = None
        root_reference = None

        for frame_index in range(total_frames):
            body_frame = self._get_frame(body_frames, frame_index)
            left_frame = self._get_frame(left_hand_frames, frame_index)
            right_frame = self._get_frame(right_hand_frames, frame_index)

            body_frame, body_state = self._stabilize_sequence(body_frame, body_state)
            left_frame, left_state = self._stabilize_hand_sequence(left_frame, left_state)
            right_frame, right_state = self._stabilize_hand_sequence(right_frame, right_state)

            frame = self._build_frame(
                body_frame=body_frame,
                left_hand_frame=left_frame,
                right_hand_frame=right_frame,
                root_reference=root_reference,
                left_hand_state=left_state,
                right_hand_state=right_state,
            )

            if root_reference is None:
                root_reference = frame["root_reference"]

            output_frames.append({"joints": frame["joints"]})

        self._smooth_output_frames(output_frames)
        self._apply_hand_deadband(output_frames)

        clip = {
            "version": "1.0",
            "name": name,
            "fps": self.fps,
            "frame_count": len(output_frames),
            "coordinateSystem": {
                "name": "threejs",
                "up": "+Y",
                "forward": "+Z",
                "right": "+X",
                "handedness": "right",
                "units": "meters",
                "rotationSpace": "world_delta",
            },
            "fingerRestForwards": {
                joint_name: self._vector_to_json(axis)
                for joint_name, axis in self.finger_rest_forwards.items()
            },
            "frames": output_frames,
        }

        if metadata:
            clip["metadata"] = metadata

        return clip

    def _prepare_sequence(self, frames, expected_length: int):
        if frames is None:
            return []

        prepared_frames = []

        for frame in frames:
            array = np.asarray(frame, dtype=float)

            if array.shape != (expected_length, 3):
                raise ValueError(
                    f"Expected frames with shape ({expected_length}, 3), got {array.shape}"
                )

            prepared_frames.append(np.nan_to_num(array, nan=0.0))

        return prepared_frames

    def _get_frame(self, frames, index: int):
        if not frames:
            return None

        if index < len(frames):
            return frames[index].copy()

        return frames[-1].copy()

    def _smooth_hand_landmarks(self, frames):
        """Dampen landmark noise without filling genuine hand-loss gaps.

        MediaPipe hand world landmarks can wobble independently for a few
        frames even when the signer is holding a stable shape. A small
        symmetric window removes that wobble before joint directions are
        converted to quaternions. Missing points remain missing so the later
        hold-state logic can handle tracking loss explicitly.
        """
        if len(frames) < 2:
            return frames

        smoothed = [frame.copy() for frame in frames]
        window_radius = len(HAND_LANDMARK_SMOOTHING_WEIGHTS) // 2

        for frame_index, frame in enumerate(frames):
            # Smoothing is per landmark and never fills an invalid point. The
            # complete-chain decision is made by stabilization below.
            if not any(is_valid_point(point) for point in frame):
                continue

            valid_indices = {
                point_index
                for point_index, point in enumerate(frame)
                if is_valid_point(point)
            }

            for point_index in valid_indices:
                point = frame[point_index]
                if not is_valid_point(point):
                    continue

                weighted_point = np.zeros(3, dtype=float)
                weight_total = 0.0

                for offset, weight in enumerate(HAND_LANDMARK_SMOOTHING_WEIGHTS):
                    sample_index = frame_index + offset - window_radius

                    if sample_index < 0 or sample_index >= len(frames):
                        continue

                    sample = frames[sample_index][point_index]

                    if not is_valid_point(sample):
                        continue

                    weighted_point += sample * weight
                    weight_total += weight

                if weight_total > 0.0:
                    smoothed[frame_index][point_index] = weighted_point / weight_total

        return smoothed

    def _stabilize_sequence(self, frame, previous_frame):
        if frame is None:
            return previous_frame, previous_frame

        if previous_frame is None:
            previous_frame = np.zeros_like(frame)

        stabilized = frame.copy()

        for point_index, point in enumerate(stabilized):
            if is_valid_point(point):
                previous_frame[point_index] = point
            else:
                stabilized[point_index] = previous_frame[point_index]

        return stabilized, previous_frame

    def _hand_core_is_valid(self, frame):
        return frame is not None and all(
            is_valid_point(frame[index])
            for index in HAND_CORE_INDICES
        )

    def _finger_chain_is_valid(self, frame, finger_name):
        chain = FINGER_CHAINS[finger_name]
        return (
            frame is not None
            and all(is_valid_point(frame[index]) for index in chain)
            and self._finger_geometry_is_valid(frame, finger_name)
        )

    def _finger_geometry_is_valid(self, frame, finger_name):
        chain = FINGER_CHAINS[finger_name]
        points = [to_three_space(frame[index]) for index in chain]

        for start, end in zip(points, points[1:]):
            if np.linalg.norm(end - start) < MIN_DIRECTION_LENGTH:
                return False

        maximum_angles = FINGER_MAX_BEND_ANGLES[finger_name]
        for joint_index, maximum_angle in enumerate(maximum_angles, start=1):
            incoming = _normalize_vector(
                points[joint_index] - points[joint_index - 1],
                np.zeros(3, dtype=float),
            )
            outgoing = _normalize_vector(
                points[joint_index + 1] - points[joint_index],
                np.zeros(3, dtype=float),
            )
            if np.linalg.norm(incoming) < MIN_DIRECTION_LENGTH or np.linalg.norm(outgoing) < MIN_DIRECTION_LENGTH:
                return False

            bend_angle = math.acos(float(np.clip(np.dot(incoming, outgoing), -1.0, 1.0)))
            if bend_angle > maximum_angle:
                return False

        return True

    def _new_hand_state(self, frame, chain_frames, chain_tracked, hand_tracked, missing):
        return {
            "frame": frame.copy(),
            "chain_frames": {
                finger_name: points.copy()
                for finger_name, points in chain_frames.items()
            },
            "chain_tracked": dict(chain_tracked),
            "hand_tracked": bool(hand_tracked),
            "missing": int(missing),
        }

    def _stabilize_hand_sequence(self, frame, state):
        if frame is None:
            return None, state

        frame = np.asarray(frame, dtype=float).copy()
        previous_chain_frames = state.get("chain_frames", {}) if state else {}
        has_current_core = self._hand_core_is_valid(frame)

        if not any(is_valid_point(point) for point in frame):
            missing = (state["missing"] + 1) if state else 1
            if state and missing <= HAND_HOLD_FRAMES:
                next_state = self._new_hand_state(
                    state["frame"],
                    previous_chain_frames,
                    {finger_name: False for finger_name in FINGER_CHAINS},
                    False,
                    missing,
                )
                next_state["core_frame"] = np.asarray(
                    state.get("core_frame", np.zeros((len(HAND_CORE_INDICES), 3))),
                    dtype=float,
                ).copy()
                return state["frame"].copy(), next_state

            empty = np.zeros_like(frame)
            next_state = self._new_hand_state(
                empty,
                previous_chain_frames,
                {finger_name: False for finger_name in FINGER_CHAINS},
                False,
                missing,
            )
            next_state["core_frame"] = np.asarray(
                state.get("core_frame", np.zeros((len(HAND_CORE_INDICES), 3))) if state else np.zeros((len(HAND_CORE_INDICES), 3)),
                dtype=float,
            ).copy()
            return empty, next_state

        stabilized = frame.copy()
        chain_frames = dict(previous_chain_frames)
        chain_tracked = {}

        # A current chain is accepted only as a complete unit. If its geometry
        # is missing or impossible, copy the previous complete chain as a unit
        # and explicitly mark it untracked for downstream hold/interpolation.
        for finger_name, chain in FINGER_CHAINS.items():
            current_valid = has_current_core and self._finger_chain_is_valid(frame, finger_name)
            if current_valid:
                chain_frames[finger_name] = frame[list(chain)].copy()
                chain_tracked[finger_name] = True
                continue

            chain_tracked[finger_name] = False
            previous_chain = previous_chain_frames.get(finger_name)
            if previous_chain is not None:
                stabilized[list(chain)] = previous_chain
            else:
                stabilized[list(chain)] = 0.0

        # Palm orientation is also a single all-or-nothing sample. Never make
        # a current wrist plus stale MCPs (or the reverse) into a new hand.
        if has_current_core:
            # A rejected finger chain may include its MCP, but a valid palm
            # still belongs to the current frame for the other chains.
            stabilized[list(HAND_CORE_INDICES)] = frame[list(HAND_CORE_INDICES)]
            hand_tracked = True
        else:
            previous_core = state.get("core_frame") if state else None
            if previous_core is not None:
                stabilized[list(HAND_CORE_INDICES)] = previous_core
            else:
                stabilized[list(HAND_CORE_INDICES)] = 0.0
            hand_tracked = False

        if has_current_core:
            core_frame = frame[list(HAND_CORE_INDICES)].copy()
        elif state and state.get("core_frame") is not None:
            core_frame = np.asarray(state["core_frame"], dtype=float).copy()
        else:
            core_frame = np.zeros((len(HAND_CORE_INDICES), 3), dtype=float)

        next_state = self._new_hand_state(
            stabilized,
            chain_frames,
            chain_tracked,
            hand_tracked,
            0,
        )
        next_state["core_frame"] = core_frame
        return stabilized, next_state

    def _point(self, frame, index: int, fallback=None):
        if frame is None:
            if fallback is None:
                return np.zeros(3, dtype=float)
            return np.asarray(fallback, dtype=float).reshape(3)

        point = frame[index]

        if is_valid_point(point):
            return to_three_space(point)

        if fallback is not None:
            return np.asarray(fallback, dtype=float).reshape(3)

        return np.zeros(3, dtype=float)

    def _direction(self, start_point, end_point, fallback_axis):
        direction = np.asarray(end_point, dtype=float).reshape(3) - np.asarray(start_point, dtype=float).reshape(3)
        return _normalize_vector(direction, fallback_axis)

    def _joint_rotation(self, start_point, end_point, joint_name: str):
        direction = self._direction(start_point, end_point, REST_AXES[joint_name])
        return _quaternion_from_unit_vectors(REST_AXES[joint_name], direction)

    def _build_frame(
        self,
        body_frame,
        left_hand_frame,
        right_hand_frame,
        root_reference,
        left_hand_state=None,
        right_hand_state=None,
    ):
        left_hand_tracked = self._is_hand_frame_tracked(left_hand_frame, left_hand_state)
        right_hand_tracked = self._is_hand_frame_tracked(right_hand_frame, right_hand_state)

        hip_center = midpoint(
            self._point(body_frame, BODY_LANDMARKS["LEFT_HIP"]),
            self._point(body_frame, BODY_LANDMARKS["RIGHT_HIP"]),
        )
        shoulder_center = midpoint(
            self._point(body_frame, BODY_LANDMARKS["LEFT_SHOULDER"]),
            self._point(body_frame, BODY_LANDMARKS["RIGHT_SHOULDER"]),
        )
        ear_center = midpoint(
            self._point(body_frame, BODY_LANDMARKS["LEFT_EAR"], fallback=shoulder_center),
            self._point(body_frame, BODY_LANDMARKS["RIGHT_EAR"], fallback=shoulder_center),
        )
        head_point = midpoint(
            self._point(body_frame, BODY_LANDMARKS["NOSE"], fallback=ear_center),
            ear_center,
        )
        neck_point = shoulder_center + (head_point - shoulder_center) * 0.55

        left_shoulder = self._point(body_frame, BODY_LANDMARKS["LEFT_SHOULDER"])
        right_shoulder = self._point(body_frame, BODY_LANDMARKS["RIGHT_SHOULDER"])
        left_elbow = self._point(body_frame, BODY_LANDMARKS["LEFT_ELBOW"])
        right_elbow = self._point(body_frame, BODY_LANDMARKS["RIGHT_ELBOW"])
        left_wrist = self._point(body_frame, BODY_LANDMARKS["LEFT_WRIST"])
        right_wrist = self._point(body_frame, BODY_LANDMARKS["RIGHT_WRIST"])

        left_hip = self._point(body_frame, BODY_LANDMARKS["LEFT_HIP"])
        right_hip = self._point(body_frame, BODY_LANDMARKS["RIGHT_HIP"])
        left_knee = self._point(body_frame, BODY_LANDMARKS["LEFT_KNEE"])
        right_knee = self._point(body_frame, BODY_LANDMARKS["RIGHT_KNEE"])
        left_ankle = self._point(body_frame, BODY_LANDMARKS["LEFT_ANKLE"])
        right_ankle = self._point(body_frame, BODY_LANDMARKS["RIGHT_ANKLE"])
        left_foot_index = self._point(body_frame, BODY_LANDMARKS["LEFT_FOOT_INDEX"], fallback=left_ankle)
        right_foot_index = self._point(body_frame, BODY_LANDMARKS["RIGHT_FOOT_INDEX"], fallback=right_ankle)

        if root_reference is None:
            root_reference = hip_center.copy()

        root_position = np.zeros(3, dtype=float)
        left_wrist_rotation = (
            self._hand_rotation(left_hand_frame, left_wrist, "LEFT_WRIST")
            if left_hand_tracked
            else self._neutral_hand_rotation(left_elbow, left_wrist, "LEFT_WRIST")
        )
        right_wrist_rotation = (
            self._hand_rotation(right_hand_frame, right_wrist, "RIGHT_WRIST")
            if right_hand_tracked
            else self._neutral_hand_rotation(right_elbow, right_wrist, "RIGHT_WRIST")
        )

        joints = {
            "PELVIS": {
                "position": self._vector_to_json(root_position),
                "rotation": {
                    "x": 0.0,
                    "y": 0.0,
                    "z": 0.0,
                    "w": 1.0,
                },
                "locked": True,
            },
            "SPINE1": {**self._locked_joint()},
            "SPINE2": {**self._locked_joint()},
            "SPINE3": {**self._locked_joint()},
            "NECK": {
                **self._locked_joint(),
            },
            "HEAD": {
                **self._locked_joint(),
            },
            "LEFT_COLLAR": {**self._locked_joint()},
            "RIGHT_COLLAR": {**self._locked_joint()},
            "LEFT_SHOULDER": {
                "rotation": self._quaternion_to_json(
                    self._joint_rotation(left_shoulder, left_elbow, "LEFT_SHOULDER")
                ),
            },
            "RIGHT_SHOULDER": {
                "rotation": self._quaternion_to_json(
                    self._joint_rotation(right_shoulder, right_elbow, "RIGHT_SHOULDER")
                ),
            },
            "LEFT_ELBOW": {
                "rotation": self._quaternion_to_json(
                    self._joint_rotation(left_elbow, left_wrist, "LEFT_ELBOW")
                ),
            },
            "RIGHT_ELBOW": {
                "rotation": self._quaternion_to_json(
                    self._joint_rotation(right_elbow, right_wrist, "RIGHT_ELBOW")
                ),
            },
            "LEFT_WRIST": {
                "rotation": left_wrist_rotation,
                "tracked": left_hand_tracked,
            },
            "RIGHT_WRIST": {
                "rotation": right_wrist_rotation,
                "tracked": right_hand_tracked,
            },
            "LEFT_HIP": {
                **self._locked_joint(),
            },
            "RIGHT_HIP": {
                **self._locked_joint(),
            },
            "LEFT_KNEE": {
                **self._locked_joint(),
            },
            "RIGHT_KNEE": {
                **self._locked_joint(),
            },
            "LEFT_ANKLE": {
                **self._locked_joint(),
            },
            "RIGHT_ANKLE": {
                **self._locked_joint(),
            },
            "LEFT_FOOT": {
                **self._locked_joint(),
            },
            "RIGHT_FOOT": {
                **self._locked_joint(),
            },
        }

        for joint_name in FINGER_SEGMENTS:
            hand_frame = left_hand_frame if joint_name.startswith("LEFT_") else right_hand_frame
            body_wrist = left_wrist if joint_name.startswith("LEFT_") else right_wrist
            hand_state = left_hand_state if joint_name.startswith("LEFT_") else right_hand_state
            finger_name = joint_name.split("_", 2)[1]
            chain_tracked = (
                hand_state.get("chain_tracked", {}).get(finger_name, False)
                if hand_state
                else self._finger_chain_is_valid(hand_frame, finger_name)
            )
            rotation, segment_tracked = self._finger_rotation(
                hand_frame,
                body_wrist,
                joint_name,
                chain_tracked=chain_tracked,
                return_status=True,
            )
            joints[joint_name] = {
                "rotation": rotation,
                "tracked": segment_tracked,
            }

        return {
            "root_reference": root_reference,
            "joints": joints,
        }

    def _is_hand_frame_tracked(self, hand_frame, state=None):
        if state is not None:
            return bool(state.get("hand_tracked", False))

        return self._hand_core_is_valid(hand_frame)

    def _identity_rotation(self):
        return {
            "x": 0.0,
            "y": 0.0,
            "z": 0.0,
            "w": 1.0,
        }

    def _locked_joint(self):
        return {
            "rotation": self._identity_rotation(),
            "locked": True,
        }

    def _aligned_hand_point(self, hand_frame, point_index, body_wrist):
        hand_wrist = self._point(
            hand_frame,
            HAND_LANDMARKS["WRIST"],
            fallback=body_wrist,
        )
        hand_point = self._point(
            hand_frame,
            point_index,
            fallback=hand_wrist,
        )
        return body_wrist + hand_point - hand_wrist

    def _hand_rotation(self, hand_frame, body_wrist, joint_name):
        required_indices = [
            HAND_LANDMARKS["WRIST"],
            HAND_LANDMARKS["INDEX_MCP"],
            HAND_LANDMARKS["MIDDLE_MCP"],
            HAND_LANDMARKS["PINKY_MCP"],
        ]

        if hand_frame is None or not all(
            is_valid_point(hand_frame[index])
            for index in required_indices
        ):
            return self._identity_rotation()

        source_forward, source_across, source_normal = HAND_REST_BASES[joint_name]
        target_forward = _normalize_vector(
            self._aligned_hand_point(
                hand_frame,
                HAND_LANDMARKS["MIDDLE_MCP"],
                body_wrist,
            ) - body_wrist,
            source_forward,
        )
        target_across = (
            self._aligned_hand_point(
                hand_frame,
                HAND_LANDMARKS["INDEX_MCP"],
                body_wrist,
            )
            - self._aligned_hand_point(
                hand_frame,
                HAND_LANDMARKS["PINKY_MCP"],
                body_wrist,
            )
        )
        target_across = target_across - target_forward * np.dot(
            target_across,
            target_forward,
        )
        target_across = _normalize_vector(target_across, source_across)
        target_normal = _normalize_vector(
            np.cross(target_forward, target_across),
            source_normal,
        )
        if np.dot(target_normal, source_normal) < 0.0:
            target_normal = -target_normal
        target_across = _normalize_vector(
            np.cross(target_normal, target_forward),
            source_across,
        )

        return _quaternion_from_bases(
            (source_forward, source_across, source_normal),
            (target_forward, target_across, target_normal),
        )

    def _neutral_hand_rotation(self, elbow, wrist, joint_name):
        source_forward, source_across, source_normal = HAND_REST_BASES[joint_name]
        target_forward = self._direction(elbow, wrist, source_forward)
        target_normal = source_normal - target_forward * np.dot(
            source_normal,
            target_forward,
        )
        target_normal = _normalize_vector(target_normal, source_across)
        target_across = _normalize_vector(
            np.cross(target_normal, target_forward),
            source_across,
        )
        target_normal = _normalize_vector(
            np.cross(target_forward, target_across),
            source_normal,
        )

        return self._quaternion_to_json(
            _quaternion_from_bases(
                (source_forward, source_across, source_normal),
                (target_forward, target_across, target_normal),
            )
        )

    def _finger_source_bases(self, joint_name):
        source_forward = _normalize_vector(
            self.finger_rest_forwards[joint_name],
            HAND_REST_BASES["RIGHT_WRIST" if joint_name.startswith("RIGHT_") else "LEFT_WRIST"][0],
        )
        _, source_across, source_normal = HAND_REST_BASES[
            "RIGHT_WRIST" if joint_name.startswith("RIGHT_") else "LEFT_WRIST"
        ]
        source_normal = _normalize_vector(
            source_normal - source_forward * np.dot(source_normal, source_forward),
            source_across,
        )
        source_across = _normalize_vector(
            np.cross(source_normal, source_forward),
            source_across,
        )
        source_normal = _normalize_vector(
            np.cross(source_forward, source_across),
            source_normal,
        )
        return source_forward, source_across, source_normal

    def _hand_target_bases(self, hand_frame, body_wrist, joint_name):
        if hand_frame is None or not self._hand_core_is_valid(hand_frame):
            return None

        source_forward, source_across, source_normal = HAND_REST_BASES[joint_name]
        target_forward = _normalize_vector(
            self._aligned_hand_point(
                hand_frame,
                HAND_LANDMARKS["MIDDLE_MCP"],
                body_wrist,
            ) - body_wrist,
            source_forward,
        )
        target_across = (
            self._aligned_hand_point(
                hand_frame,
                HAND_LANDMARKS["INDEX_MCP"],
                body_wrist,
            )
            - self._aligned_hand_point(
                hand_frame,
                HAND_LANDMARKS["PINKY_MCP"],
                body_wrist,
            )
        )
        target_across = target_across - target_forward * np.dot(
            target_across,
            target_forward,
        )
        target_across = _normalize_vector(target_across, source_across)
        target_normal = _normalize_vector(
            np.cross(target_forward, target_across),
            source_normal,
        )
        if np.dot(target_normal, source_normal) < 0.0:
            target_normal = -target_normal
        target_across = _normalize_vector(
            np.cross(target_normal, target_forward),
            source_across,
        )
        return target_forward, target_across, target_normal

    def _finger_rotation(
        self,
        hand_frame,
        body_wrist,
        joint_name,
        chain_tracked=True,
        return_status=False,
    ):
        def result(rotation, tracked):
            return (rotation, tracked) if return_status else rotation

        if hand_frame is None or not chain_tracked:
            return result(self._identity_rotation(), False)

        start_index, end_index = FINGER_SEGMENTS[joint_name]

        if not is_valid_point(hand_frame[start_index]) or not is_valid_point(hand_frame[end_index]):
            return result(self._identity_rotation(), False)

        start_point = self._aligned_hand_point(hand_frame, start_index, body_wrist)
        end_point = self._aligned_hand_point(hand_frame, end_index, body_wrist)
        source_basis = self._finger_source_bases(joint_name)
        source_forward, source_across, source_normal = source_basis
        target_palm_basis = self._hand_target_bases(
            hand_frame,
            body_wrist,
            "RIGHT_WRIST" if joint_name.startswith("RIGHT_") else "LEFT_WRIST",
        )
        if target_palm_basis is None:
            return result(self._identity_rotation(), False)

        target_forward = self._direction(
            start_point,
            end_point,
            source_forward,
        )
        _, _, target_palm_normal = target_palm_basis
        target_normal = _normalize_vector(
            target_palm_normal - target_forward * np.dot(target_palm_normal, target_forward),
            source_normal,
        )
        target_across = _normalize_vector(
            np.cross(target_normal, target_forward),
            source_across,
        )
        target_normal = _normalize_vector(
            np.cross(target_forward, target_across),
            target_normal,
        )

        return result(
            self._quaternion_to_json(
                _quaternion_from_bases(
                    (source_forward, source_across, source_normal),
                    (target_forward, target_across, target_normal),
                )
            ),
            True,
        )

    def _smooth_output_frames(self, frames):
        if len(frames) < 2:
            return

        joint_names = [
            joint_name
            for joint_name in CANONICAL_JOINTS
            if joint_name not in LOCKED_BODY_JOINTS
        ]

        for joint_name in joint_names:
            rotations = [
                None
                if joint_name in HAND_MOTION_JOINTS
                and frame["joints"].get(joint_name, {}).get("tracked") is False
                else self._rotation_to_array(frame["joints"].get(joint_name, {}).get("rotation"))
                for frame in frames
            ]

            for frame_index, frame in enumerate(frames):
                center = rotations[frame_index]
                if center is None:
                    continue

                smoothing_weights = (
                    HAND_ROTATION_SMOOTHING_WEIGHTS
                    if joint_name in HAND_MOTION_JOINTS
                    else SMOOTHING_WEIGHTS
                )
                smoothing_radius = len(smoothing_weights) // 2
                weighted_rotation = np.zeros(4, dtype=float)
                weight_total = 0.0
                first_sample = max(0, frame_index - smoothing_radius)
                last_sample = min(len(frames), frame_index + smoothing_radius + 1)

                for sample_index in range(first_sample, last_sample):
                    sample = rotations[sample_index]
                    if sample is None:
                        continue

                    weight = smoothing_weights[sample_index - frame_index + smoothing_radius]
                    if np.dot(sample, center) < 0.0:
                        sample = -sample

                    weighted_rotation += sample * weight
                    weight_total += weight

                if weight_total <= 0.0:
                    continue

                rotation_length = np.linalg.norm(weighted_rotation)
                if rotation_length < MIN_DIRECTION_LENGTH:
                    continue

                smoothed_rotation = weighted_rotation / rotation_length
                frame["joints"][joint_name]["rotation"] = self._array_to_rotation(smoothed_rotation)
                rotations[frame_index] = smoothed_rotation


    def _apply_hand_deadband(self, frames):
        for joint_name in HAND_MOTION_JOINTS:
            previous = None

            for frame in frames:
                joint_data = frame["joints"].get(joint_name, {})
                rotation = joint_data.get("rotation")
                current = self._rotation_to_array(rotation)
                if current is None:
                    continue

                if joint_data.get("tracked") is False:
                    # Keep the last valid sample as the re-entry anchor. The
                    # frontend holds an untracked bone, so resetting this
                    # limiter to identity would create a jump on the first
                    # valid frame after a dropout.
                    continue

                if previous is not None:
                    dot = float(np.clip(abs(np.dot(previous, current)), -1.0, 1.0))
                    angle = 2.0 * math.acos(dot)
                    if angle < HAND_DEADBAND_RADIANS:
                        frame["joints"][joint_name]["rotation"] = self._array_to_rotation(previous)
                        current = previous
                    elif angle > HAND_MAX_STEP_RADIANS:
                        target = current if np.dot(previous, current) >= 0.0 else -current
                        blend = HAND_MAX_STEP_RADIANS / angle
                        current = previous * (1.0 - blend) + target * blend
                        current_length = np.linalg.norm(current)
                        if current_length >= MIN_DIRECTION_LENGTH:
                            current = current / current_length
                            frame["joints"][joint_name]["rotation"] = self._array_to_rotation(current)

                previous = current

    def _rotation_to_array(self, rotation):
        if not isinstance(rotation, dict):
            return None

        quaternion = np.array(
            [
                float(rotation.get("x", 0.0)),
                float(rotation.get("y", 0.0)),
                float(rotation.get("z", 0.0)),
                float(rotation.get("w", 1.0)),
            ],
            dtype=float,
        )
        length = np.linalg.norm(quaternion)

        if not np.isfinite(length) or length < MIN_DIRECTION_LENGTH:
            return None

        return quaternion / length

    def _array_to_rotation(self, quaternion):
        return {
            "x": _to_json_number(quaternion[0]),
            "y": _to_json_number(quaternion[1]),
            "z": _to_json_number(quaternion[2]),
            "w": _to_json_number(quaternion[3]),
        }

    def _quaternion_to_json(self, quaternion):
        return {
            "x": _to_json_number(quaternion["x"]),
            "y": _to_json_number(quaternion["y"]),
            "z": _to_json_number(quaternion["z"]),
            "w": _to_json_number(quaternion["w"]),
        }

    def _vector_to_json(self, vector):
        return {
            "x": _to_json_number(vector[0]),
            "y": _to_json_number(vector[1]),
            "z": _to_json_number(vector[2]),
        }

    def save(self, motion, output_path: Path):
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as output_file:
            json.dump(motion, output_file, indent=2, ensure_ascii=False)
        return output_path
