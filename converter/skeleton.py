from __future__ import annotations

import numpy as np

BODY_LANDMARKS = {
    "NOSE": 0,
    "LEFT_EYE_INNER": 1,
    "LEFT_EYE": 2,
    "LEFT_EYE_OUTER": 3,
    "RIGHT_EYE_INNER": 4,
    "RIGHT_EYE": 5,
    "RIGHT_EYE_OUTER": 6,
    "LEFT_EAR": 7,
    "RIGHT_EAR": 8,
    "MOUTH_LEFT": 9,
    "MOUTH_RIGHT": 10,
    "LEFT_SHOULDER": 11,
    "RIGHT_SHOULDER": 12,
    "LEFT_ELBOW": 13,
    "RIGHT_ELBOW": 14,
    "LEFT_WRIST": 15,
    "RIGHT_WRIST": 16,
    "LEFT_PINKY": 17,
    "RIGHT_PINKY": 18,
    "LEFT_INDEX": 19,
    "RIGHT_INDEX": 20,
    "LEFT_THUMB": 21,
    "RIGHT_THUMB": 22,
    "LEFT_HIP": 23,
    "RIGHT_HIP": 24,
    "LEFT_KNEE": 25,
    "RIGHT_KNEE": 26,
    "LEFT_ANKLE": 27,
    "RIGHT_ANKLE": 28,
    "LEFT_HEEL": 29,
    "RIGHT_HEEL": 30,
    "LEFT_FOOT_INDEX": 31,
    "RIGHT_FOOT_INDEX": 32,
}

HAND_LANDMARKS = {
    "WRIST": 0,
    "THUMB_CMC": 1,
    "THUMB_MCP": 2,
    "THUMB_IP": 3,
    "THUMB_TIP": 4,
    "INDEX_MCP": 5,
    "INDEX_PIP": 6,
    "INDEX_DIP": 7,
    "INDEX_TIP": 8,
    "MIDDLE_MCP": 9,
    "MIDDLE_PIP": 10,
    "MIDDLE_DIP": 11,
    "MIDDLE_TIP": 12,
    "RING_MCP": 13,
    "RING_PIP": 14,
    "RING_DIP": 15,
    "RING_TIP": 16,
    "PINKY_MCP": 17,
    "PINKY_PIP": 18,
    "PINKY_DIP": 19,
    "PINKY_TIP": 20,
}


def is_valid_point(point, minimum_magnitude: float = 1e-6) -> bool:
    point_array = np.asarray(point, dtype=float).reshape(-1)

    if point_array.shape != (3,):
        return False

    if not np.isfinite(point_array).all():
        return False

    return np.linalg.norm(point_array) > minimum_magnitude


def to_three_space(point) -> np.ndarray:
    point_array = np.asarray(point, dtype=float).reshape(3)
    return np.array(
        [
            float(point_array[0]),
            float(-point_array[1]),
            float(-point_array[2]),
        ],
        dtype=float,
    )


def midpoint(*points) -> np.ndarray:
    valid_points = [
        np.asarray(point, dtype=float).reshape(3)
        for point in points
        if point is not None
    ]

    if not valid_points:
        return np.zeros(3, dtype=float)

    return np.mean(np.stack(valid_points, axis=0), axis=0)
