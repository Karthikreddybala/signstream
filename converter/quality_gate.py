from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

try:
    from skeleton import BODY_LANDMARKS, HAND_LANDMARKS
except ImportError:  # pragma: no cover
    from converter.skeleton import BODY_LANDMARKS, HAND_LANDMARKS


HAND_SIDES = ("LEFT", "RIGHT")
HAND_CORE = (0, 5, 9, 17)
QUALITY_STATUSES = ("ready", "needs-review", "rejected")
FINGER_CHAINS = {
    "THUMB": (HAND_LANDMARKS["THUMB_CMC"], HAND_LANDMARKS["THUMB_MCP"], HAND_LANDMARKS["THUMB_IP"], HAND_LANDMARKS["THUMB_TIP"]),
    "INDEX": (HAND_LANDMARKS["INDEX_MCP"], HAND_LANDMARKS["INDEX_PIP"], HAND_LANDMARKS["INDEX_DIP"], HAND_LANDMARKS["INDEX_TIP"]),
    "MIDDLE": (HAND_LANDMARKS["MIDDLE_MCP"], HAND_LANDMARKS["MIDDLE_PIP"], HAND_LANDMARKS["MIDDLE_DIP"], HAND_LANDMARKS["MIDDLE_TIP"]),
    "RING": (HAND_LANDMARKS["RING_MCP"], HAND_LANDMARKS["RING_PIP"], HAND_LANDMARKS["RING_DIP"], HAND_LANDMARKS["RING_TIP"]),
    "LITTLE": (HAND_LANDMARKS["PINKY_MCP"], HAND_LANDMARKS["PINKY_PIP"], HAND_LANDMARKS["PINKY_DIP"], HAND_LANDMARKS["PINKY_TIP"]),
}


def _valid_point(point) -> bool:
    if not isinstance(point, (list, tuple)) or len(point) < 3:
        return False
    values = [float(value) for value in point[:3]]
    return all(math.isfinite(value) for value in values) and math.sqrt(sum(value * value for value in values)) > 1e-6


def _vector(start, end):
    return [float(end[index]) - float(start[index]) for index in range(3)]


def _length(vector):
    return math.sqrt(sum(component * component for component in vector))


def _normalize(vector):
    length = _length(vector)
    if length <= 1e-6:
        return None
    return [component / length for component in vector]


def _dot(first, second):
    return sum(first[index] * second[index] for index in range(3))


def _cross(first, second):
    return [
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
    ]


def _angle_degrees(first, second):
    first_normal = _normalize(first)
    second_normal = _normalize(second)
    if first_normal is None or second_normal is None:
        return None
    return math.degrees(math.acos(max(-1.0, min(1.0, _dot(first_normal, second_normal)))))


def _frame_count(landmarks, motion):
    return max(
        len(landmarks.get("body", [])),
        len(landmarks.get("left_hand", [])),
        len(landmarks.get("right_hand", [])),
        len(motion.get("frames", [])),
    )


def _hand_frame(landmarks, side, index):
    frames = landmarks.get(f"{side.lower()}_hand", [])
    return frames[index] if index < len(frames) else []


def _hand_detection_percentages(landmarks, frame_count):
    result = {}
    for side in HAND_SIDES:
        valid_frames = sum(
            1
            for index in range(frame_count)
            if all(_valid_point(_hand_frame(landmarks, side, index)[point]) for point in HAND_CORE)
        )
        result[side] = valid_frames / frame_count if frame_count else 0.0
    return result


def _finger_missing_percentages(landmarks, frame_count):
    result = {side: {} for side in HAND_SIDES}
    for side in HAND_SIDES:
        for finger_name, chain in FINGER_CHAINS.items():
            valid_frames = 0
            for index in range(frame_count):
                frame = _hand_frame(landmarks, side, index)
                if all(_valid_point(frame[point]) for point in chain):
                    valid_frames += 1
            result[side][finger_name] = 1.0 - (valid_frames / frame_count if frame_count else 0.0)
    return result


def _basis(hand_frame):
    if not hand_frame or not all(_valid_point(hand_frame[index]) for index in HAND_CORE):
        return None

    wrist = hand_frame[0]
    forward = _normalize(_vector(wrist, hand_frame[9]))
    across = _normalize(_vector(hand_frame[17], hand_frame[5]))
    if forward is None or across is None:
        return None

    normal = _normalize(_cross(forward, across))
    if normal is None:
        return None

    across = _normalize(_cross(normal, forward))
    return (forward, across, normal) if across is not None else None


def _palm_basis_stability(landmarks, frame_count):
    result = {}
    for side in HAND_SIDES:
        bases = [_basis(_hand_frame(landmarks, side, index)) for index in range(frame_count)]
        bases = [basis for basis in bases if basis is not None]
        jumps = []
        for previous, current in zip(bases, bases[1:]):
            jumps.append(max(
                _angle_degrees(previous[0], current[0]),
                _angle_degrees(previous[1], current[1]),
                _angle_degrees(previous[2], current[2]),
            ))
        mean_jump = sum(jumps) / len(jumps) if jumps else 180.0
        score = max(0.0, min(1.0, math.exp(-math.radians(mean_jump) / math.radians(35.0))))
        result[side] = {
            "score": score,
            "validFrames": len(bases),
            "meanJumpDegrees": mean_jump if jumps else None,
            "maxJumpDegrees": max(jumps) if jumps else None,
        }
    return result


def _max_quaternion_jump(motion, active_hands):
    previous = {}
    maximum = {"degrees": 0.0, "joint": None, "frame": None}
    for frame_index, frame in enumerate(motion.get("frames", [])):
        for joint_name, joint in (frame.get("joints", {}) or {}).items():
            rotation = joint.get("rotation") if isinstance(joint, dict) else None
            if not isinstance(rotation, dict):
                continue
            side = joint_name.split("_", 1)[0] if "_" in joint_name else None
            if side in HAND_SIDES:
                if side not in active_hands or joint.get("tracked") is False:
                    previous.pop(joint_name, None)
                    continue
            current = [
                float(rotation.get("x", 0.0)),
                float(rotation.get("y", 0.0)),
                float(rotation.get("z", 0.0)),
                float(rotation.get("w", 1.0)),
            ]
            norm = math.sqrt(sum(value * value for value in current))
            if norm <= 1e-8 or not all(math.isfinite(value) for value in current):
                maximum["degrees"] = float("inf")
                maximum["joint"] = joint_name
                maximum["frame"] = frame_index
                continue
            current = [value / norm for value in current]
            if joint_name in previous:
                dot = abs(sum(previous[joint_name][index] * current[index] for index in range(4)))
                angle = math.degrees(2.0 * math.acos(max(-1.0, min(1.0, dot))))
                if angle > maximum["degrees"]:
                    maximum = {"degrees": angle, "joint": joint_name, "frame": frame_index}
            previous[joint_name] = current
    return maximum


def _finger_bend_ranges(landmarks, frame_count):
    result = {side: {} for side in HAND_SIDES}
    for side in HAND_SIDES:
        for finger_name, chain in FINGER_CHAINS.items():
            angles = []
            for index in range(frame_count):
                frame = _hand_frame(landmarks, side, index)
                if not all(_valid_point(frame[point]) for point in chain):
                    continue
                points = [frame[point] for point in chain]
                for point_index in range(1, len(points) - 1):
                    incoming = _vector(points[point_index - 1], points[point_index])
                    outgoing = _vector(points[point_index], points[point_index + 1])
                    angle = _angle_degrees(incoming, outgoing)
                    if angle is not None:
                        angles.append(angle)
            result[side][finger_name] = {
                "minDegrees": min(angles) if angles else None,
                "maxDegrees": max(angles) if angles else None,
                "rangeDegrees": (max(angles) - min(angles)) if angles else None,
                "samples": len(angles),
            }
    return result


def _torso_volume(body_frame):
    if not body_frame:
        return None
    left_hip = body_frame[BODY_LANDMARKS["LEFT_HIP"]]
    right_hip = body_frame[BODY_LANDMARKS["RIGHT_HIP"]]
    left_shoulder = body_frame[BODY_LANDMARKS["LEFT_SHOULDER"]]
    right_shoulder = body_frame[BODY_LANDMARKS["RIGHT_SHOULDER"]]
    if not all(_valid_point(point) for point in (left_hip, right_hip, left_shoulder, right_shoulder)):
        return None
    pelvis = [(left_hip[index] + right_hip[index]) / 2.0 for index in range(3)]
    shoulders = [(left_shoulder[index] + right_shoulder[index]) / 2.0 for index in range(3)]
    center = [(pelvis[index] + shoulders[index]) / 2.0 for index in range(3)]
    shoulder_width = _length(_vector(left_shoulder, right_shoulder))
    torso_height = _length(_vector(pelvis, shoulders))
    radius_x = max(0.16, shoulder_width * 0.28)
    radius_y = max(0.24, torso_height * 0.58)
    radius_z = max(0.12, radius_x * 0.72)
    return center, radius_x, radius_y, radius_z


def _wrist_to_torso_clearance(landmarks, frame_count):
    by_side = {side: [] for side in HAND_SIDES}
    for index in range(frame_count):
        body = landmarks.get("body", [])[index] if index < len(landmarks.get("body", [])) else []
        volume = _torso_volume(body)
        if volume is None:
            continue
        center, radius_x, radius_y, radius_z = volume
        minimum_radius = min(radius_x, radius_y, radius_z)
        for side in HAND_SIDES:
            wrist_index = BODY_LANDMARKS[f"{side}_WRIST"]
            wrist = body[wrist_index]
            if not _valid_point(wrist):
                continue
            normalized = [
                (wrist[0] - center[0]) / radius_x,
                (wrist[1] - center[1]) / radius_y,
                (wrist[2] - center[2]) / radius_z,
            ]
            by_side[side].append((math.sqrt(sum(value * value for value in normalized)) - 1.0) * minimum_radius)
    values = {
        side: min(clearances) if clearances else None
        for side, clearances in by_side.items()
    }
    available = [value for value in values.values() if value is not None]
    return {
        "byHand": values,
        "minimumMeters": min(available) if available else None,
    }


def _rejected_frame_count(landmarks, frame_count):
    rejected = 0
    for index in range(frame_count):
        body = landmarks.get("body", [])[index] if index < len(landmarks.get("body", [])) else []
        body_core = (
            BODY_LANDMARKS["LEFT_SHOULDER"],
            BODY_LANDMARKS["RIGHT_SHOULDER"],
            BODY_LANDMARKS["LEFT_HIP"],
            BODY_LANDMARKS["RIGHT_HIP"],
        )
        if not all(_valid_point(body[point]) for point in body_core):
            rejected += 1
            continue
        for side in HAND_SIDES:
            frame = _hand_frame(landmarks, side, index)
            valid_count = sum(_valid_point(point) for point in frame)
            if 0 < valid_count < 21:
                rejected += 1
                break
    return rejected


def _identity_change_count(landmarks, motion):
    tracking = landmarks.get("handIdentityTracking") or motion.get("handIdentityTracking") or {}
    events = tracking.get("identityChangeEvents")
    if isinstance(events, list):
        return len(events)
    value = tracking.get("identityChanges", 0)
    return int(value) if isinstance(value, (int, float)) else 0


def _active_hands(detection_percentages):
    detected = [side for side, percentage in detection_percentages.items() if percentage >= 0.10]
    if len(detected) == 0:
        return [], "unusable"
    if len(detected) == 1:
        return detected, "confirmed one-handed"
    return detected, "two-handed"


def _quality_score(metrics, active_hands):
    detection = metrics["handDetectionPercentage"]
    detection_score = min(1.0, min(detection[side] for side in active_hands) / 0.55)
    missing = metrics["fingerMissingPercentage"]
    missing_score = min(
        1.0,
        sum(1.0 - missing[side][finger] for side in active_hands for finger in missing[side])
        / max(1, len(active_hands) * len(missing[active_hands[0]])),
    )
    palm_score = sum(metrics["palmBasisStability"][side]["score"] for side in active_hands) / len(active_hands)
    jump_degrees = metrics["maxQuaternionJump"]["degrees"]
    jump_score = max(0.0, min(1.0, 1.0 - jump_degrees / 60.0)) if math.isfinite(jump_degrees) else 0.0
    clearance = metrics["wristToTorsoClearance"]["minimumMeters"]
    clearance_score = 1.0 if clearance is None or clearance >= 0 else max(0.0, 1.0 + clearance / 0.15)
    rejected_score = max(0.0, 1.0 - metrics["rejectedFrameCount"] / max(1, metrics["frameCount"] * 0.2))
    identity_score = 1.0 if metrics["identityChangeCount"] == 0 else 0.0
    return max(0.0, min(1.0, (
        detection_score * 0.2
        + missing_score * 0.15
        + palm_score * 0.2
        + jump_score * 0.2
        + clearance_score * 0.1
        + rejected_score * 0.1
        + identity_score * 0.05
    )))


def evaluate_clip(motion, landmarks):
    frame_count = _frame_count(landmarks, motion)
    detection = _hand_detection_percentages(landmarks, frame_count)
    active_hands, hand_usage = _active_hands(detection)
    metrics = {
        "frameCount": frame_count,
        "handDetectionPercentage": detection,
        "handConfidence": {
            side: detection[side]
            for side in HAND_SIDES
        },
        "fingerMissingPercentage": _finger_missing_percentages(landmarks, frame_count),
        "palmBasisStability": _palm_basis_stability(landmarks, frame_count),
        "maxQuaternionJump": _max_quaternion_jump(motion, active_hands),
        "fingerBendAngleRange": _finger_bend_ranges(landmarks, frame_count),
        "wristToTorsoClearance": _wrist_to_torso_clearance(landmarks, frame_count),
        "identityChangeCount": _identity_change_count(landmarks, motion),
        "detectorLabelFlipCount": len((landmarks.get("handIdentityTracking") or {}).get("labelFlipEvents", [])),
        "rejectedFrameCount": _rejected_frame_count(landmarks, frame_count),
        "handUsage": hand_usage,
    }

    if not active_hands:
        status = "rejected"
        reasons = ["no usable hand detections"]
        score = 0.0
    else:
        score = _quality_score(metrics, active_hands)
        reasons = []
        if metrics["identityChangeCount"] > 0:
            reasons.append("hand identity changed")
        if metrics["maxQuaternionJump"]["degrees"] > 45.0:
            reasons.append("large quaternion jump")
        if any(
            metrics["fingerMissingPercentage"][side][finger] > 0.65
            for side in active_hands
            for finger in metrics["fingerMissingPercentage"][side]
        ):
            reasons.append("active finger landmarks frequently missing")
        if any(metrics["palmBasisStability"][side]["score"] < 0.45 for side in active_hands):
            reasons.append("unstable palm basis")
        if metrics["wristToTorsoClearance"]["minimumMeters"] is not None and metrics["wristToTorsoClearance"]["minimumMeters"] < -0.03:
            reasons.append("wrist enters torso volume")
        if metrics["rejectedFrameCount"] > frame_count * 0.2:
            reasons.append("too many rejected frames")

        hard_reject = (
            not math.isfinite(metrics["maxQuaternionJump"]["degrees"])
            or metrics["maxQuaternionJump"]["degrees"] > 90.0
            or score < 0.35
        )
        status = "rejected" if hard_reject else "needs-review" if reasons or score < 0.7 else "ready"

    return {
        "status": status,
        "qualityScore": score,
        "reasons": reasons,
        "metrics": metrics,
    }


def _resolve_artifact(manifest_root, path_value):
    normalized = str(path_value or "").lstrip("/").replace("\\", "/")
    return manifest_root / normalized


def apply_quality_gate(manifest, manifest_root: Path, only_video_ids: set[str] | None = None):
    report = []
    for clip in manifest.get("clips", []):
        variants = clip.get("motionVariants") or []
        gated_variants = []
        for variant in variants:
            video_id = str(variant.get("videoId") or "").strip()
            if only_video_ids is not None and video_id not in only_video_ids:
                gated_variants.append(variant)
                continue
            motion_path = _resolve_artifact(manifest_root, variant.get("motionPath"))
            landmark_path = _resolve_artifact(manifest_root, variant.get("landmarkPath"))
            if not motion_path.exists() or not landmark_path.exists():
                quality = {
                    "status": "rejected",
                    "qualityScore": 0.0,
                    "reasons": ["motion or landmark artifact missing"],
                    "metrics": {},
                }
            else:
                with motion_path.open("r", encoding="utf-8") as motion_file:
                    motion = json.load(motion_file)
                with landmark_path.open("r", encoding="utf-8") as landmark_file:
                    landmarks = json.load(landmark_file)
                quality = evaluate_clip(motion, landmarks)
            updated = {
                **variant,
                "status": quality["status"],
                "qualityStatus": quality["status"],
                "qualityScore": round(quality["qualityScore"], 4),
                "qualityReasons": quality["reasons"],
                "qualityMetrics": quality["metrics"],
                "confidence": quality["metrics"].get("handConfidence"),
                "handUsage": quality["metrics"].get("handUsage"),
            }
            gated_variants.append(updated)
            report.append({
                "gloss": clip.get("gloss"),
                "videoId": video_id,
                **quality,
            })

        clip["motionVariants"] = gated_variants
        statuses = [variant.get("qualityStatus", variant.get("status")) for variant in gated_variants]
        if statuses and all(status == "ready" for status in statuses):
            clip["status"] = "ready"
        elif any(status in ("ready", "needs-review") for status in statuses):
            clip["status"] = "needs-review"
        elif statuses:
            clip["status"] = "rejected"
        else:
            clip["status"] = "rejected"
        clip["readyVideoCount"] = sum(status == "ready" for status in statuses)
        clip["qualityStatus"] = clip["status"]
        primary_variant = next(
            (variant for variant in gated_variants if variant.get("status") == "ready"),
            gated_variants[0] if gated_variants else None,
        )
        if primary_variant:
            clip["primaryMotionPath"] = primary_variant.get("motionPath")
            clip["motionPath"] = primary_variant.get("motionPath")
        primary_landmark_variant = next(
            (variant for variant in gated_variants if variant.get("qualityStatus") == "ready"),
            gated_variants[0] if gated_variants else None,
        )
        if primary_landmark_variant:
            clip["primaryLandmarkPath"] = primary_landmark_variant.get("landmarkPath")
            clip["landmarkPath"] = primary_landmark_variant.get("landmarkPath")

    return manifest, report


def parse_args():
    parser = argparse.ArgumentParser(description="Compute clip quality metrics and gate motion readiness.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--video-id", action="append", dest="video_ids")
    return parser.parse_args()


def main():
    args = parse_args()
    with args.manifest.open("r", encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)
    gated_manifest, report = apply_quality_gate(
        manifest,
        args.manifest.parent.parent,
        set(args.video_ids) if args.video_ids else None,
    )
    with args.manifest.open("w", encoding="utf-8") as manifest_file:
        json.dump(gated_manifest, manifest_file, indent=2, ensure_ascii=False)
    payload = {
        "version": 1,
        "clipCount": len(report),
        "readyCount": sum(item["status"] == "ready" for item in report),
        "needsReviewCount": sum(item["status"] == "needs-review" for item in report),
        "rejectedCount": sum(item["status"] == "rejected" for item in report),
        "clips": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as output_file:
        json.dump(payload, output_file, indent=2, ensure_ascii=False)
    print(json.dumps({key: payload[key] for key in ("clipCount", "readyCount", "needsReviewCount", "rejectedCount")}, indent=2))


if __name__ == "__main__":
    main()

