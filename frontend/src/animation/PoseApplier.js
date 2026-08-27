import { Quaternion, Vector3 } from "three";
import HandPoseCorrector from "./HandPoseCorrector.js";

const LOCKED_JOINTS = new Set([
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
    "RIGHT_FOOT"
]);

const FINGER_JOINTS = new Set([
    "LEFT_THUMB_METACARPAL", "LEFT_THUMB_PROXIMAL", "LEFT_THUMB_DISTAL",
    "LEFT_INDEX_PROXIMAL", "LEFT_INDEX_INTERMEDIATE", "LEFT_INDEX_DISTAL",
    "LEFT_MIDDLE_PROXIMAL", "LEFT_MIDDLE_INTERMEDIATE", "LEFT_MIDDLE_DISTAL",
    "LEFT_RING_PROXIMAL", "LEFT_RING_INTERMEDIATE", "LEFT_RING_DISTAL",
    "LEFT_LITTLE_PROXIMAL", "LEFT_LITTLE_INTERMEDIATE", "LEFT_LITTLE_DISTAL",
    "RIGHT_THUMB_METACARPAL", "RIGHT_THUMB_PROXIMAL", "RIGHT_THUMB_DISTAL",
    "RIGHT_INDEX_PROXIMAL", "RIGHT_INDEX_INTERMEDIATE", "RIGHT_INDEX_DISTAL",
    "RIGHT_MIDDLE_PROXIMAL", "RIGHT_MIDDLE_INTERMEDIATE", "RIGHT_MIDDLE_DISTAL",
    "RIGHT_RING_PROXIMAL", "RIGHT_RING_INTERMEDIATE", "RIGHT_RING_DISTAL",
    "RIGHT_LITTLE_PROXIMAL", "RIGHT_LITTLE_INTERMEDIATE", "RIGHT_LITTLE_DISTAL"
]);

const HAND_WRISTS = new Set(["LEFT_WRIST", "RIGHT_WRIST"]);

export function deriveFingerRestAxes(boneMapper) {
    const axes = new Map();

    for (const jointName of FINGER_JOINTS) {
        const bone = boneMapper.getBone(jointName);
        if (!bone) continue;

        bone.updateWorldMatrix(true, false);
        const start = bone.getWorldPosition(new Vector3());
        const child = bone.children.find((item) => item.isBone || item.type === "Bone");
        const end = child
            ? child.getWorldPosition(new Vector3())
            : bone.parent
                ? start.clone().add(start.clone().sub(bone.parent.getWorldPosition(new Vector3())))
                : start.clone().add(new Vector3(1, 0, 0).applyQuaternion(bone.getWorldQuaternion(new Quaternion())));
        const direction = end.sub(start);

        if (direction.lengthSq() > 1e-8) {
            axes.set(jointName, direction.normalize());
        }
    }

    return axes;
}

function toQuaternion(value) {

    if (!value) return null;

    if (Array.isArray(value)) {

        const [x = 0, y = 0, z = 0, w = 1] = value;

        return { x, y, z, w };

    }

    if (typeof value === "object") {

        if ("rotation" in value) {
            return toQuaternion(value.rotation);
        }

        const x = Number(value.x ?? 0);
        const y = Number(value.y ?? 0);
        const z = Number(value.z ?? 0);
        const w = Number(value.w ?? 1);

        return { x, y, z, w };

    }

    return null;

}

function toPosition(value) {

    if (!value) return null;

    if (Array.isArray(value)) {

        const [x = 0, y = 0, z = 0] = value;

        return { x, y, z };

    }

    if (typeof value === "object") {

        if ("position" in value) {
            return toPosition(value.position);
        }

        const x = Number(value.x ?? 0);
        const y = Number(value.y ?? 0);
        const z = Number(value.z ?? 0);

        return { x, y, z };

    }

    return null;

}

export default class PoseApplier {

    constructor(boneMapper, options = {}) {
        this.boneMapper = boneMapper;
        this.restTransforms = new Map();

        for (const [jointName, bone] of this.boneMapper.getAllBones().entries()) {

            bone.updateWorldMatrix(true, false);

            this.restTransforms.set(jointName, {
                position: bone.position.clone(),
                quaternion: bone.quaternion.clone(),
                worldQuaternion: bone.getWorldQuaternion(new Quaternion()),
                parentWorldQuaternion: bone.parent
                    ? bone.parent.getWorldQuaternion(new Quaternion())
                    : new Quaternion()
            });

        }

        // Finger source axes are calibrated from the loaded VRM, rather than
        // assuming that a generic thumb axis matches this avatar.
        this.restFingerAxes = deriveFingerRestAxes(this.boneMapper);

        this.handPoseCorrector = new HandPoseCorrector(
            this.boneMapper,
            this.restTransforms,
            options.handCorrection
        );
    }

    apply(frame) {

        if (!frame || !frame.joints) return;

        const entries = Object.entries(frame.joints).sort(([firstName], [secondName]) => {
            const firstBone = this.boneMapper.getBone(firstName);
            const secondBone = this.boneMapper.getBone(secondName);
            return this.getBoneDepth(firstBone) - this.getBoneDepth(secondBone);
        });

        for (const [jointName, jointData] of entries) {

            const bone = this.boneMapper.getBone(jointName);
            const restTransform = this.restTransforms.get(jointName);

            if (!bone) continue;

            const rotation = toQuaternion(
                jointData.rotation ?? jointData
            );

            if (jointData.tracked === false && (FINGER_JOINTS.has(jointName) || HAND_WRISTS.has(jointName))) {
                // Explicit tracking loss is a hold condition for the whole
                // hand. Applying an invalid wrist sample while holding the
                // fingers makes the chain shear and produces a finger pop.
                continue;
            } else if ((jointData.locked === true || LOCKED_JOINTS.has(jointName)) && restTransform) {
                const parentWorldQuaternion = bone.parent
                    ? bone.parent.getWorldQuaternion(new Quaternion()).invert()
                    : new Quaternion();

                bone.quaternion.copy(parentWorldQuaternion)
                    .multiply(restTransform.worldQuaternion);
            } else if (rotation) {
                const motionQuaternion = new Quaternion(
                    rotation.x,
                    rotation.y,
                    rotation.z,
                    rotation.w
                );

                motionQuaternion.normalize();

                if (restTransform && FINGER_JOINTS.has(jointName)) {
                    const isNoFingerDelta = Math.abs(motionQuaternion.x) < 1e-5
                        && Math.abs(motionQuaternion.y) < 1e-5
                        && Math.abs(motionQuaternion.z) < 1e-5
                        && motionQuaternion.w >= 0.99999;

                    if (isNoFingerDelta) {
                        // An identity finger sample means "follow the wrist",
                        // not "force this child back to its old world pose".
                        // Keeping the rest local rotation lets the whole hand
                        // move rigidly with the wrist while tracking is quiet.
                        bone.quaternion.copy(restTransform.quaternion);
                    } else {
                        // Finger rotations in the motion format are world-space
                        // deltas from the calibrated rest pose. Convert the
                        // resulting world target back through the *current*
                        // parent chain. Treating this as a local quaternion
                        // compounds wrist/forearm motion on every segment.
                        const targetWorldQuaternion = restTransform.worldQuaternion.clone()
                            .premultiply(motionQuaternion);
                        const parentWorldQuaternion = bone.parent
                            ? bone.parent.getWorldQuaternion(new Quaternion()).invert()
                            : new Quaternion();

                        bone.quaternion.copy(parentWorldQuaternion)
                            .multiply(targetWorldQuaternion);
                    }
                } else if (restTransform) {
                    const targetWorldQuaternion = restTransform.worldQuaternion.clone()
                        .premultiply(motionQuaternion);
                    const parentWorldQuaternion = bone.parent
                        ? bone.parent.getWorldQuaternion(new Quaternion()).invert()
                        : new Quaternion();

                    bone.quaternion.copy(parentWorldQuaternion)
                        .multiply(targetWorldQuaternion);
                } else {
                    bone.quaternion.copy(motionQuaternion);
                }
            }

            if (jointName === "PELVIS") {

                const position = toPosition(
                    jointData.position
                );

                if (position) {
                    if (restTransform) {
                        bone.position.set(
                            restTransform.position.x + position.x,
                            restTransform.position.y + position.y,
                            restTransform.position.z + position.z
                        );
                    } else {
                        bone.position.set(
                            position.x,
                            position.y,
                            position.z
                        );
                    }
                }
            }

            bone.updateWorldMatrix(true, false);
        }

        this.handPoseCorrector.apply(frame);
    }

    getBoneDepth(bone) {

        let depth = 0;
        let current = bone;

        while (current?.parent) {
            depth += 1;
            current = current.parent;
        }

        return depth;

    }

    reset() {

        for (const [jointName, bone] of this.boneMapper.getAllBones().entries()) {

            const restTransform = this.restTransforms.get(jointName);

            if (!restTransform) continue;

            bone.position.copy(restTransform.position);
            bone.quaternion.copy(restTransform.quaternion);
            bone.updateWorldMatrix(true, false);

        }

        this.handPoseCorrector.reset();

    }

    setHandCorrectionEnabled(enabled) {
        this.handPoseCorrector.setEnabled(enabled);

    }

    getHandCorrectionDebug() {
        return this.handPoseCorrector.getDebugState();

    }

}
