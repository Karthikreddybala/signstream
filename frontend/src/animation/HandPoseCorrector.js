import {
    Quaternion,
    Vector3
} from "three";
import HAND_CORRECTION_CONFIG from "./HandCorrectionConfig.js";

const FINGER_NAMES = [
    "THUMB_METACARPAL", "THUMB_PROXIMAL", "THUMB_DISTAL",
    "INDEX_PROXIMAL", "INDEX_INTERMEDIATE", "INDEX_DISTAL",
    "MIDDLE_PROXIMAL", "MIDDLE_INTERMEDIATE", "MIDDLE_DISTAL",
    "RING_PROXIMAL", "RING_INTERMEDIATE", "RING_DISTAL",
    "LITTLE_PROXIMAL", "LITTLE_INTERMEDIATE", "LITTLE_DISTAL"
];

const HAND_SIDES = ["LEFT", "RIGHT"];
const IDENTITY = new Quaternion();
const UNIT_X = new Vector3(1, 0, 0);
const UNIT_Y = new Vector3(0, 1, 0);
const UNIT_Z = new Vector3(0, 0, 1);

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function quaternionAngle(first, second = IDENTITY) {
    const dot = Math.abs(clamp(first.dot(second), -1, 1));
    return 2 * Math.acos(dot);
}

function rotationVector(quaternion) {
    const normalized = quaternion.clone().normalize();

    if (normalized.w < 0) {
        normalized.set(
            -normalized.x,
            -normalized.y,
            -normalized.z,
            -normalized.w
        );
    }

    const angle = 2 * Math.acos(clamp(normalized.w, -1, 1));
    const sine = Math.sqrt(Math.max(0, 1 - normalized.w * normalized.w));

    if (sine < 1e-5 || angle < 1e-5) {
        return new Vector3();
    }

    return new Vector3(
        normalized.x / sine,
        normalized.y / sine,
        normalized.z / sine
    ).multiplyScalar(angle);
}

function quaternionFromRotationVector(vector) {
    const angle = vector.length();

    if (angle < 1e-5) {
        return IDENTITY.clone();
    }

    return new Quaternion().setFromAxisAngle(
        vector.clone().multiplyScalar(1 / angle),
        angle
    );
}

function normalizeOr(vector, fallback) {
    if (vector.lengthSq() < 1e-8) {
        return fallback.clone();
    }

    return vector.normalize();
}

function degreesToRadians(degrees) {
    return (Number(degrees) * Math.PI) / 180;
}

export default class HandPoseCorrector {

    constructor(boneMapper, restTransforms, config = HAND_CORRECTION_CONFIG) {
        this.boneMapper = boneMapper;
        this.restTransforms = restTransforms;
        this.config = config ?? HAND_CORRECTION_CONFIG;
        this.enabled = this.config.enabled !== false;
        this.hands = new Map();
        this.debug = {
            LEFT: { state: "ACTIVE", restWeight: 0, collision: false, constraints: 0 },
            RIGHT: { state: "ACTIVE", restWeight: 0, collision: false, constraints: 0 }
        };

        for (const side of HAND_SIDES) {
            this.hands.set(side, this.buildHandReference(side));
        }
    }

    buildHandReference(side) {
        const wristName = `${side}_WRIST`;
        const wrist = this.boneMapper.getBone(wristName);
        const restWrist = this.restTransforms.get(wristName);
        const handWorld = restWrist?.worldQuaternion?.clone() ?? new Quaternion();
        const handWorldInverse = handWorld.clone().invert();
        const wristPosition = wrist?.getWorldPosition(new Vector3()) ?? new Vector3();
        const forearm = this.boneMapper.getBone(`${side}_ELBOW`);
        const forearmPosition = forearm?.getWorldPosition(new Vector3()) ?? wristPosition.clone().sub(UNIT_X);
        const index = this.boneMapper.getBone(`${side}_INDEX_PROXIMAL`);
        const middle = this.boneMapper.getBone(`${side}_MIDDLE_PROXIMAL`);
        const pinky = this.boneMapper.getBone(`${side}_LITTLE_PROXIMAL`);
        const indexPosition = index?.getWorldPosition(new Vector3()) ?? wristPosition.clone();
        const middlePosition = middle?.getWorldPosition(new Vector3()) ?? wristPosition.clone().add(UNIT_X);
        const pinkyPosition = pinky?.getWorldPosition(new Vector3()) ?? wristPosition.clone().sub(UNIT_X);
        const palmForward = normalizeOr(
            middlePosition.clone().sub(wristPosition),
            side === "LEFT" ? UNIT_X : UNIT_X.clone().negate()
        );
        const palmAcross = normalizeOr(
            indexPosition.clone().sub(pinkyPosition),
            UNIT_Y
        );
        const palmNormal = normalizeOr(
            palmForward.clone().cross(palmAcross),
            UNIT_Z
        );

        const reference = {
            side,
            wrist,
            handWorld,
            handWorldInverse,
            restWristPosition: wristPosition,
            restForearmPosition: forearmPosition,
            restUpperWorld: this.restTransforms.get(`${side}_SHOULDER`)?.worldQuaternion?.clone() ?? new Quaternion(),
            restForearmWorld: this.restTransforms.get(`${side}_ELBOW`)?.worldQuaternion?.clone() ?? new Quaternion(),
            restUpperDirection: this.getRestBoneDirection(`${side}_SHOULDER`, side === "LEFT" ? UNIT_X : UNIT_X.clone().negate()),
            restForearmDirection: this.getRestBoneDirection(`${side}_ELBOW`, side === "LEFT" ? UNIT_X : UNIT_X.clone().negate()),
            palmAcross,
            palmNormal,
            fingers: new Map(),
            upperArm: this.boneMapper.getBone(`${side}_SHOULDER`),
            forearm,
            state: {
                restWeight: 0,
                previousRotations: new Map(),
                collisionWeight: 0
            }
        };

        for (const fingerName of FINGER_NAMES) {
            const jointName = `${side}_${fingerName}`;
            const bone = this.boneMapper.getBone(jointName);
            const restTransform = this.restTransforms.get(jointName);

            if (!bone || !restTransform) {
                continue;
            }

            const boneWorldPosition = bone.getWorldPosition(new Vector3());
            const child = bone.children.find((item) => item.isBone || item.type === "Bone");
            const childPosition = child?.getWorldPosition(new Vector3());
            const parentPosition = bone.parent?.getWorldPosition(new Vector3());
            const restForwardWorld = childPosition
                ? childPosition.sub(boneWorldPosition).normalize()
                : parentPosition
                    ? boneWorldPosition.clone().sub(parentPosition).normalize()
                    : UNIT_X.clone().applyQuaternion(restTransform.worldQuaternion);
            const forwardHand = normalizeOr(
                restForwardWorld.clone().applyQuaternion(handWorldInverse),
                UNIT_X
            );
            const acrossHand = normalizeOr(
                reference.palmAcross.clone().applyQuaternion(handWorldInverse),
                UNIT_Y
            );
            const normalHand = normalizeOr(
                forwardHand.clone().cross(acrossHand),
                reference.palmNormal.clone().applyQuaternion(handWorldInverse)
            );
            const correctedAcrossHand = normalizeOr(
                normalHand.clone().cross(forwardHand),
                acrossHand
            );
            const profile = this.getFingerProfile(fingerName);
            const curlDegrees = this.config.relaxedPose.curlDegrees[fingerName] ?? 0;
            const relaxedDelta = new Quaternion().setFromAxisAngle(
                correctedAcrossHand,
                degreesToRadians(curlDegrees)
            );

            reference.fingers.set(jointName, {
                jointName,
                bone,
                restWorld: restTransform.worldQuaternion.clone(),
                restRelativeToHand: handWorldInverse.clone().multiply(restTransform.worldQuaternion),
                forwardHand,
                acrossHand: correctedAcrossHand,
                normalHand,
                profile,
                relaxedDelta
            });
        }

        return reference;
    }

    getRestBoneDirection(jointName, fallback) {
        const bone = this.boneMapper.getBone(jointName);
        const restTransform = this.restTransforms.get(jointName);
        const child = bone?.children.find((item) => item.isBone || item.type === "Bone");

        if (!bone || !restTransform || !child) {
            return fallback.clone().normalize();
        }

        const start = bone.getWorldPosition(new Vector3());
        const end = child.getWorldPosition(new Vector3());

        return normalizeOr(end.sub(start), fallback);
    }

    getFingerProfile(fingerName) {
        if (fingerName.startsWith("THUMB")) {
            return this.config.fingerLimits.thumb;
        }

        if (fingerName.endsWith("PROXIMAL")) {
            return this.config.fingerLimits.proximal;
        }

        if (fingerName.endsWith("INTERMEDIATE")) {
            return this.config.fingerLimits.intermediate;
        }

        return this.config.fingerLimits.distal;
    }

    apply(frame) {
        if (!this.enabled || !frame?.joints) {
            return;
        }

        for (const reference of this.hands.values()) {
            this.applyHand(reference, frame);
        }
    }

    applyHand(reference, frame) {
        if (!reference.wrist) {
            return;
        }

        const wristData = frame.joints[`${reference.side}_WRIST`];
        const wristTracked = wristData?.tracked === true;
        const allowTrackedIdleCorrection = this.config.restDetection.allowTrackedIdleCorrection === true;

        if (!wristTracked) {
            // Missing wrist landmarks are not an idle pose. Keep the last
            // authored hand pose until tracking becomes valid again.
            reference.state.restWeight = 0;
            reference.state.collisionWeight = 0;
            reference.state.previousRotations.clear();
            this.debug[reference.side] = {
                ...this.debug[reference.side],
                state: "TRACKING_LOST",
                restWeight: 0,
                collision: false,
                constraints: 0
            };
            return;
        }

        // A tracked wrist means this hand is part of authored signing motion.
        // The default path must not curl, constrain, or reposition it. A
        // tracked-idle relaxation mode is opt-in and intentionally separate.
        if (wristTracked && !allowTrackedIdleCorrection) {
            reference.state.restWeight = 0;
            reference.state.collisionWeight = 0;
            reference.state.previousRotations.clear();
            this.debug[reference.side] = {
                ...this.debug[reference.side],
                state: "ACTIVE",
                restWeight: 0,
                collision: false,
                constraints: 0
            };
            return;
        }

        const restWeight = this.updateRestState(reference, frame);
        this.applyRestArmPose(reference, restWeight);
        const wristTarget = this.getWorldQuaternion(reference.wrist);
        const neutralWrist = this.getNeutralWrist(reference);
        const wristBlend = restWeight * (this.config.relaxedPose.wristBlend ?? 0);
        wristTarget.slerp(neutralWrist, wristBlend);
        this.setWorldQuaternion(reference.wrist, wristTarget);

        let constraintCount = 0;

        for (const finger of reference.fingers.values()) {
            const fingerData = frame.joints[finger.jointName];
            if (fingerData?.tracked !== false) {
                // Preserve every tracked segment exactly. Generic rest pose
                // cleanup is only for explicitly untracked segments.
                continue;
            }

            const currentWorld = this.getWorldQuaternion(finger.bone);
            const handWorld = this.getWorldQuaternion(reference.wrist);
            const relaxedWorld = handWorld.clone()
                .multiply(finger.restRelativeToHand)
                .multiply(finger.relaxedDelta);
            const targetWorld = currentWorld.clone().slerp(relaxedWorld, restWeight);
            const constrainedWorld = restWeight > 1e-3
                ? this.constrainFinger(reference, finger, targetWorld)
                : targetWorld;

            if (quaternionAngle(targetWorld, constrainedWorld) > 1e-4) {
                constraintCount += 1;
            }

            this.setWorldQuaternion(finger.bone, constrainedWorld);
        }

        const collision = this.applyCollisionCorrection(reference, restWeight);
        const debugState = this.debug[reference.side];
        debugState.restWeight = Number(restWeight.toFixed(3));
        debugState.collision = collision;
        debugState.constraints = constraintCount;
        debugState.state = restWeight > 0.8
            ? "REST"
            : restWeight > 0.1
                ? "TRANSITION"
                : "ACTIVE";
    }

    applyRestArmPose(reference, restWeight) {
        if (restWeight < 1e-3) {
            return;
        }

        const sideSign = reference.side === "LEFT" ? 1 : -1;
        const upperDirection = new Vector3(sideSign * 0.16, -0.98, 0.04).normalize();
        const forearmDirection = new Vector3(sideSign * 0.025, -1, 0.04).normalize();
        const upperAlignment = new Quaternion().setFromUnitVectors(
            reference.restUpperDirection,
            upperDirection
        );
        const forearmAlignment = new Quaternion().setFromUnitVectors(
            reference.restForearmDirection,
            forearmDirection
        );
        const upperTarget = upperAlignment.multiply(reference.restUpperWorld.clone());
        const forearmTarget = forearmAlignment.multiply(reference.restForearmWorld.clone());

        if (reference.upperArm) {
            this.setWorldQuaternion(
                reference.upperArm,
                this.getWorldQuaternion(reference.upperArm).slerp(upperTarget, restWeight)
            );
        }

        if (reference.forearm) {
            this.setWorldQuaternion(
                reference.forearm,
                this.getWorldQuaternion(reference.forearm).slerp(forearmTarget, restWeight)
            );
        }
    }

    updateRestState(reference, frame) {
        const wristName = `${reference.side}_WRIST`;
        const wristData = frame.joints[wristName];
        const tracked = wristData?.tracked === true;
        if (tracked && this.config.restDetection.allowTrackedIdleCorrection !== true) {
            reference.state.restWeight = 0;
            return 0;
        }
        const rotations = new Map();
        let poseAngle = 0;
        let velocity = 0;

        for (const [jointName] of reference.fingers) {
            const data = frame.joints[jointName];
            const rotation = this.readQuaternion(data?.rotation);

            if (!rotation) {
                continue;
            }

            rotations.set(jointName, rotation);
            poseAngle = Math.max(poseAngle, quaternionAngle(rotation));
            const previous = reference.state.previousRotations.get(jointName);

            if (previous) {
                velocity = Math.max(velocity, quaternionAngle(previous, rotation));
            }
        }

        const wristRotation = this.readQuaternion(wristData?.rotation);

        if (wristRotation) {
            rotations.set(wristName, wristRotation);
            poseAngle = Math.max(poseAngle, quaternionAngle(wristRotation));
            const previous = reference.state.previousRotations.get(wristName);

            if (previous) {
                velocity = Math.max(velocity, quaternionAngle(previous, wristRotation));
            }
        }

        reference.state.previousRotations = rotations;

        const detection = this.config.restDetection;
        const isRest = !tracked || (
            poseAngle <= detection.poseThreshold
            && velocity <= detection.velocityThreshold
        );
        const target = isRest ? 1 : 0;
        const alpha = target > reference.state.restWeight
            ? detection.blendIn
            : 1;

        reference.state.restWeight += (target - reference.state.restWeight) * alpha;

        return reference.state.restWeight;
    }

    getNeutralWrist(reference) {
        const wristPosition = reference.wrist.getWorldPosition(new Vector3());
        const elbowPosition = reference.forearm?.getWorldPosition(new Vector3());

        if (!elbowPosition) {
            return reference.handWorld.clone();
        }

        const currentForearm = normalizeOr(
            wristPosition.clone().sub(elbowPosition),
            UNIT_X
        );
        const restForearm = normalizeOr(
            reference.restWristPosition.clone().sub(reference.restForearmPosition),
            UNIT_X
        );
        const alignment = new Quaternion().setFromUnitVectors(restForearm, currentForearm);

        return alignment.multiply(reference.handWorld.clone());
    }

    constrainFinger(reference, finger, targetWorld) {
        const handWorld = this.getWorldQuaternion(reference.wrist);
        const currentRelative = handWorld.clone().invert().multiply(targetWorld);
        const delta = finger.restRelativeToHand.clone().invert().multiply(currentRelative);
        const vector = rotationVector(delta);
        const bend = clamp(vector.dot(finger.acrossHand), -finger.profile.bend, finger.profile.bend);
        const spread = clamp(vector.dot(finger.normalHand), -finger.profile.spread, finger.profile.spread);
        const twist = clamp(vector.dot(finger.forwardHand), -finger.profile.twist, finger.profile.twist);
        const constrainedVector = finger.acrossHand.clone().multiplyScalar(bend)
            .add(finger.normalHand.clone().multiplyScalar(spread))
            .add(finger.forwardHand.clone().multiplyScalar(twist));
        const constrainedDelta = quaternionFromRotationVector(constrainedVector);

        return handWorld.clone()
            .multiply(finger.restRelativeToHand)
            .multiply(constrainedDelta);
    }

    applyCollisionCorrection(reference, restWeight) {
        const collisionConfig = this.config.collision;

        if (!collisionConfig.enabled || restWeight < collisionConfig.minimumRestWeight) {
            reference.state.collisionWeight = Math.max(
                0,
                reference.state.collisionWeight - collisionConfig.blend
            );
            return false;
        }

        const volume = this.getTorsoVolume();
        const wristPosition = reference.wrist.getWorldPosition(new Vector3());
        const middle = reference.fingers.get(`${reference.side}_MIDDLE_PROXIMAL`)?.bone;
        const middlePosition = middle?.getWorldPosition(new Vector3()) ?? wristPosition;
        const handCenter = wristPosition.clone().lerp(middlePosition, 0.6);

        const normalized = new Vector3(
            (handCenter.x - volume.center.x) / volume.radiusX,
            (handCenter.y - volume.center.y) / volume.radiusY,
            (handCenter.z - volume.center.z) / volume.radiusZ
        );
        const distance = normalized.length();

        if (distance >= 1) {
            reference.state.collisionWeight = Math.max(
                0,
                reference.state.collisionWeight - collisionConfig.blend
            );
            return false;
        }

        reference.state.collisionWeight += (
            1 - reference.state.collisionWeight
        ) * collisionConfig.blend;

        const outward = distance > 1e-5
            ? normalized.normalize()
            : new Vector3(reference.side === "LEFT" ? -1 : 1, 0, 0);
        const penetration = Math.max(
            0,
            (1 - distance) * collisionConfig.maxHandCorrection - collisionConfig.margin
        );
        const wristNormalized = new Vector3(
            (wristPosition.x - volume.center.x) / volume.radiusX,
            (wristPosition.y - volume.center.y) / volume.radiusY,
            (wristPosition.z - volume.center.z) / volume.radiusZ
        );

        if (wristNormalized.length() < 1 && reference.forearm) {
            const elbowPosition = reference.forearm.getWorldPosition(new Vector3());
            const currentForearm = wristPosition.clone().sub(elbowPosition);
            const safeWrist = wristPosition.clone().add(
                outward.clone().multiplyScalar(
                    Math.min(
                        penetration,
                        collisionConfig.maxForearmCorrection
                    ) * reference.state.collisionWeight
                )
            );
            const desiredForearm = safeWrist.sub(elbowPosition);

            if (currentForearm.lengthSq() > 1e-8 && desiredForearm.lengthSq() > 1e-8) {
                const correction = new Quaternion().setFromUnitVectors(
                    currentForearm.normalize(),
                    desiredForearm.normalize()
                );
                const currentForearmWorld = this.getWorldQuaternion(reference.forearm);
                this.setWorldQuaternion(
                    reference.forearm,
                    correction.multiply(currentForearmWorld)
                );
            }
        }

        const safeTarget = handCenter.clone().add(
            outward.multiplyScalar(penetration * reference.state.collisionWeight)
        );
        const handVector = middlePosition.clone().sub(wristPosition);
        const desiredVector = safeTarget.clone().sub(wristPosition);

        if (handVector.lengthSq() > 1e-8 && desiredVector.lengthSq() > 1e-8) {
            const correction = new Quaternion().setFromUnitVectors(
                handVector.normalize(),
                desiredVector.normalize()
            );
            const currentWrist = this.getWorldQuaternion(reference.wrist);
            this.setWorldQuaternion(
                reference.wrist,
                correction.multiply(currentWrist)
            );
        }

        return true;
    }

    getTorsoVolume() {
        const pelvis = this.boneMapper.getBone("PELVIS");
        const spine = this.boneMapper.getBone("SPINE2") ?? this.boneMapper.getBone("SPINE1");
        const leftShoulder = this.boneMapper.getBone("LEFT_SHOULDER");
        const rightShoulder = this.boneMapper.getBone("RIGHT_SHOULDER");
        const pelvisPosition = pelvis?.getWorldPosition(new Vector3()) ?? new Vector3(0, 1, 0);
        const spinePosition = spine?.getWorldPosition(new Vector3()) ?? pelvisPosition.clone().add(UNIT_Y);
        const leftPosition = leftShoulder?.getWorldPosition(new Vector3()) ?? pelvisPosition.clone().add(new Vector3(0.3, 0.5, 0));
        const rightPosition = rightShoulder?.getWorldPosition(new Vector3()) ?? pelvisPosition.clone().add(new Vector3(-0.3, 0.5, 0));
        const center = pelvisPosition.clone().lerp(spinePosition, 0.5);
        const radiusX = Math.max(0.16, leftPosition.distanceTo(rightPosition) * 0.28);
        const radiusY = Math.max(0.24, pelvisPosition.distanceTo(spinePosition) * 0.58);
        const radiusZ = Math.max(0.12, radiusX * 0.72);

        return { center, radiusX, radiusY, radiusZ };
    }

    getWorldQuaternion(bone) {
        return bone.getWorldQuaternion(new Quaternion());
    }

    setWorldQuaternion(bone, targetWorld) {
        const parentWorld = bone.parent
            ? bone.parent.getWorldQuaternion(new Quaternion()).invert()
            : new Quaternion();

        bone.quaternion.copy(parentWorld.multiply(targetWorld));
        bone.updateWorldMatrix(true, false);
    }

    readQuaternion(value) {
        if (!value || typeof value !== "object") {
            return null;
        }

        const quaternion = new Quaternion(
            Number(value.x ?? 0),
            Number(value.y ?? 0),
            Number(value.z ?? 0),
            Number(value.w ?? 1)
        );

        if (quaternion.lengthSq() < 1e-8) {
            return null;
        }

        return quaternion.normalize();
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
    }

    getDebugState() {
        return {
            LEFT: { ...this.debug.LEFT },
            RIGHT: { ...this.debug.RIGHT }
        };
    }

    reset() {
        for (const reference of this.hands.values()) {
            reference.state.restWeight = 0;
            reference.state.collisionWeight = 0;
            reference.state.previousRotations.clear();
        }
    }
}
