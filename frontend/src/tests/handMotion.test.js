import assert from "node:assert/strict";
import test from "node:test";
import { Bone, Quaternion, Vector3 } from "three";
import PoseApplier, { deriveFingerRestAxes } from "../animation/PoseApplier.js";
import MotionPlayer from "../animation/MotionPlayer.js";

const FINGERS = [
    ["THUMB", ["METACARPAL", "PROXIMAL", "DISTAL"]],
    ["INDEX", ["PROXIMAL", "INTERMEDIATE", "DISTAL"]],
    ["MIDDLE", ["PROXIMAL", "INTERMEDIATE", "DISTAL"]],
    ["RING", ["PROXIMAL", "INTERMEDIATE", "DISTAL"]],
    ["LITTLE", ["PROXIMAL", "INTERMEDIATE", "DISTAL"]]
];

class TestBoneMapper {
    constructor(bones) {
        this.bones = bones;
    }

    getBone(name) {
        return this.bones.get(name);
    }

    getAllBones() {
        return this.bones;
    }
}

function makeSkeleton() {
    const root = new Bone();
    const bones = new Map();

    for (const side of ["LEFT", "RIGHT"]) {
        const sideSign = side === "LEFT" ? 1 : -1;
        const shoulder = new Bone();
        shoulder.position.set(sideSign * 0.3, 1.4, 0);
        root.add(shoulder);
        bones.set(`${side}_SHOULDER`, shoulder);

        const elbow = new Bone();
        elbow.position.set(sideSign * 0.25, -0.35, 0);
        shoulder.add(elbow);
        bones.set(`${side}_ELBOW`, elbow);

        const wrist = new Bone();
        wrist.position.set(sideSign * 0.15, -0.35, 0);
        elbow.add(wrist);
        bones.set(`${side}_WRIST`, wrist);

        for (const [finger, segments] of FINGERS) {
            let parent = wrist;
            for (let index = 0; index < segments.length; index += 1) {
                const segment = segments[index];
                const joint = new Bone();
                joint.position.set(
                    sideSign * (0.03 + index * 0.01),
                    finger === "THUMB" ? 0.04 : 0.02 + (finger === "LITTLE" ? -0.02 : 0),
                    finger === "THUMB" ? 0.05 : 0
                );
                parent.add(joint);
                bones.set(`${side}_${finger}_${segment}`, joint);
                parent = joint;
            }

            const tip = new Bone();
            tip.position.set(sideSign * 0.08, 0, 0);
            parent.add(tip);
        }
    }

    root.updateWorldMatrix(true, true);
    return { root, mapper: new TestBoneMapper(bones), bones };
}

function identityFingerJoints(tracked = true) {
    const joints = {};
    for (const side of ["LEFT", "RIGHT"]) {
        for (const [finger, segments] of FINGERS) {
            for (const segment of segments) {
                joints[`${side}_${finger}_${segment}`] = {
                    rotation: { x: 0, y: 0, z: 0, w: 1 },
                    tracked
                };
            }
        }
    }
    return joints;
}

function makeFrame({ wristRotation = new Quaternion(), wristTracked = true, fingerRotation, fingerTracked = true } = {}) {
    return {
        joints: {
            LEFT_WRIST: {
                rotation: wristRotation,
                tracked: wristTracked
            },
            ...identityFingerJoints(fingerTracked),
            ...(fingerRotation
                ? {
                    LEFT_INDEX_PROXIMAL: {
                        rotation: fingerRotation,
                        tracked: fingerTracked
                    }
                }
                : {})
        }
    };
}

test("rest axes are derived from every mapped avatar finger bone", () => {
    const { mapper } = makeSkeleton();
    const axes = deriveFingerRestAxes(mapper);
    assert.equal(axes.size, 30);
    for (const axis of axes.values()) {
        assert.ok(Math.abs(axis.length() - 1) < 1e-8);
    }
});

test("wrist-only rotation preserves fingertip rigid motion with zero finger deltas", () => {
    const { mapper } = makeSkeleton();
    const poseApplier = new PoseApplier(mapper);
    const wrist = mapper.getBone("LEFT_WRIST");
    const tip = wrist.children[0].children[0].children[0].children[0];
    const restWrist = wrist.getWorldPosition(new Vector3());
    const restTip = tip.getWorldPosition(new Vector3());
    const wristRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);

    poseApplier.apply(makeFrame({ wristRotation }));

    const expectedTip = restTip.clone()
        .sub(restWrist)
        .applyQuaternion(wristRotation)
        .add(restWrist);
    const actualTip = tip.getWorldPosition(new Vector3());
    assert.ok(actualTip.distanceTo(expectedTip) < 1e-7);
});

test("non-zero finger deltas preserve their calibrated world target", () => {
    const { mapper } = makeSkeleton();
    const poseApplier = new PoseApplier(mapper);
    const finger = mapper.getBone("LEFT_INDEX_PROXIMAL");
    const restWorld = finger.getWorldQuaternion(new Quaternion());
    const signingRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.55);

    poseApplier.apply(makeFrame({ fingerRotation: signingRotation }));

    const expectedWorld = restWorld.clone().premultiply(signingRotation);
    const actualWorld = finger.getWorldQuaternion(new Quaternion());
    assert.ok(actualWorld.angleTo(expectedWorld) < 1e-7);
});

test("explicitly untracked finger segments hold their last pose", () => {
    const { mapper } = makeSkeleton();
    const poseApplier = new PoseApplier(mapper);
    const signingRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.55);
    poseApplier.apply(makeFrame({ fingerRotation: signingRotation }));
    const finger = mapper.getBone("LEFT_INDEX_PROXIMAL");
    const heldLocalRotation = finger.quaternion.clone();
    poseApplier.setHandCorrectionEnabled(false);

    poseApplier.apply(makeFrame({
        wristTracked: false,
        fingerTracked: false
    }));

    assert.ok(finger.quaternion.angleTo(heldLocalRotation) < 1e-7);
});

test("explicitly untracked wrists hold the last valid hand pose", () => {
    const { mapper } = makeSkeleton();
    const poseApplier = new PoseApplier(mapper);
    const wristRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.8);

    poseApplier.apply(makeFrame({ wristRotation }));
    const wrist = mapper.getBone("LEFT_WRIST");
    const heldLocalRotation = wrist.quaternion.clone();

    poseApplier.apply(makeFrame({
        wristRotation: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.3),
        wristTracked: false,
        fingerTracked: false
    }));

    assert.ok(wrist.quaternion.angleTo(heldLocalRotation) < 1e-7);
});

test("tracked signing integration never activates rest-weight correction", () => {
    const { mapper } = makeSkeleton();
    const poseApplier = new PoseApplier(mapper);
    const signingRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4);

    for (let index = 0; index < 12; index += 1) {
        poseApplier.apply(makeFrame({ fingerRotation: signingRotation }));
    }

    const debug = poseApplier.getHandCorrectionDebug();
    assert.equal(debug.LEFT.restWeight, 0);
    assert.equal(debug.LEFT.constraints, 0);
});

test("interpolation never blends a valid hand pose with a tracking-loss placeholder", () => {
    const player = new MotionPlayer({}, {});
    const signingRotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7);
    const result = player.interpolateFrames(
        {
            joints: {
                LEFT_INDEX_PROXIMAL: {
                    rotation: { x: 0, y: 0, z: 0, w: 1 },
                    tracked: false
                }
            }
        },
        {
            joints: {
                LEFT_INDEX_PROXIMAL: {
                    rotation: signingRotation,
                    tracked: true
                }
            }
        },
        0.25
    );

    const interpolated = result.joints.LEFT_INDEX_PROXIMAL;
    const quaternion = new Quaternion(
        interpolated.rotation.x,
        interpolated.rotation.y,
        interpolated.rotation.z,
        interpolated.rotation.w
    );

    assert.equal(interpolated.tracked, true);
    assert.ok(quaternion.angleTo(signingRotation) < 1e-7);
});
