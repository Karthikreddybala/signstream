import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20]
];

const HIDDEN_POSITION = new THREE.Vector3(1e6, 1e6, 1e6);
const UNIT_Y = new THREE.Vector3(0, 1, 0);

function isPointValid(point) {
    return Array.isArray(point)
        && point.length >= 3
        && point.some((component) => {
            const value = Number(component);
            return Number.isFinite(value) && Math.abs(value) > 1e-6;
        });
}

function asPoint(point) {
    return new THREE.Vector3(
        Number(point[0] ?? 0),
        Number(point[1] ?? 0),
        Number(point[2] ?? 0)
    );
}

function midpoint(first, second) {
    return first && second
        ? first.clone().add(second).multiplyScalar(0.5)
        : first?.clone() ?? second?.clone() ?? null;
}

function average(points) {
    const validPoints = points.filter(Boolean);
    if (validPoints.length === 0) return null;

    return validPoints.reduce(
        (center, point) => center.add(point),
        new THREE.Vector3()
    ).multiplyScalar(1 / validPoints.length);
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export default class LandmarkAvatar {

    constructor(scene, options = {}) {
        this.scene = scene;
        this.visible = options.visible ?? false;
        this.referencePoint = [0, 0, 0];
        this.staticBodyFrame = [];
        this.bodyScale = 1;
        this.staticBodyBuilt = false;
        this.handAnchors = {
            left: new THREE.Vector3(0.36, 0.3, 0.08),
            right: new THREE.Vector3(-0.36, 0.3, 0.08)
        };
        this.staticBodyAnchors = {
            hipCenter: new THREE.Vector3(0, 0.02, 0),
            headCenter: new THREE.Vector3(0, 0.96, 0.025),
            headRadius: 0.15
        };
        this.motion = null;
        this.frameCount = 0;
        this.frameIndex = 0;
        this.bodySmoothing = clamp(options.bodySmoothing ?? 0.38, 0.15, 1);
        this.showBodyLandmarks = options.showBodyLandmarks ?? false;
        this.showHandLandmarks = options.showHandLandmarks ?? false;
        this.smoothedBodyPoints = new Map();
        this.currentBodyPose = null;

        this.root = new THREE.Group();
        this.root.name = "LandmarkAvatar";
        this.root.visible = false;
        this.root.renderOrder = 1;
        this.scene.add(this.root);

        this.segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
        this.bodySegmentGeometry = new RoundedBoxGeometry(1, 1, 1, 0.22, 6);
        this.jointGeometry = new THREE.SphereGeometry(1, 14, 10);
        this.bodyJointGeometry = new THREE.SphereGeometry(1, 18, 14);
        this.palmGeometry = new RoundedBoxGeometry(1, 1, 1, 0.2, 6);
        this.materials = {
            body: new THREE.MeshPhysicalMaterial({
                color: options.bodyColor ?? 0xc18b75,
                roughness: 0.76,
                metalness: 0,
                clearcoat: 0.1,
                clearcoatRoughness: 0.5
            }),
            leftHand: new THREE.MeshPhysicalMaterial({
                color: options.leftHandColor ?? 0xd79a7b,
                roughness: 0.66,
                metalness: 0,
                clearcoat: 0.12,
                clearcoatRoughness: 0.48
            }),
            rightHand: new THREE.MeshPhysicalMaterial({
                color: options.rightHandColor ?? 0xd79a7b,
                roughness: 0.66,
                metalness: 0,
                clearcoat: 0.12,
                clearcoatRoughness: 0.48
            }),
            face: new THREE.MeshPhysicalMaterial({
                color: options.faceColor ?? 0xe0ad90,
                roughness: 0.7,
                metalness: 0,
                clearcoat: 0.12,
                clearcoatRoughness: 0.48
            })
        };

        this.staticBodyGroup = new THREE.Group();
        this.staticBodyGroup.name = "StaticLandmarkLowerBodyAndFace";
        this.root.add(this.staticBodyGroup);

        this.upperBodyGroup = new THREE.Group();
        this.upperBodyGroup.name = "DynamicLandmarkUpperBody";
        this.root.add(this.upperBodyGroup);

        this.leftHand = this.createHandRig("LEFT", this.materials.leftHand);
        this.rightHand = this.createHandRig("RIGHT", this.materials.rightHand);
        this.upperBody = this.createUpperBodyRig();
    }

    createHandRig(side, material) {
        const group = new THREE.Group();
        group.name = `${side}LandmarkHand`;
        this.root.add(group);

        const palm = new THREE.Mesh(this.palmGeometry, material);
        palm.name = `${side}Palm`;
        palm.castShadow = true;
        palm.receiveShadow = true;
        palm.visible = false;
        group.add(palm);

        const joints = Array.from({ length: 21 }, (_, index) => {
            const joint = new THREE.Mesh(this.jointGeometry, material);
            joint.name = `${side}LandmarkJoint${index}`;
            joint.castShadow = true;
            joint.receiveShadow = true;
            joint.visible = false;
            group.add(joint);
            return joint;
        });

        const segments = HAND_CONNECTIONS.map(([start, end], index) => {
            const segment = new THREE.Mesh(this.segmentGeometry, material);
            segment.name = `${side}LandmarkSegment${index}_${start}_${end}`;
            segment.castShadow = true;
            segment.receiveShadow = true;
            segment.visible = false;
            group.add(segment);
            return segment;
        });

        return { group, palm, joints, segments };
    }

    createUpperBodyRig() {
        const torso = this.createBodyVolume(this.materials.body, "DynamicLandmarkTorso");
        const segments = {
            shoulderBar: this.createBodySegment(this.materials.body, 0.07),
            neck: this.createBodySegment(this.materials.body, 0.055),
            leftUpperArm: this.createBodySegment(this.materials.body, 0.06),
            leftForearm: this.createBodySegment(this.materials.body, 0.05),
            rightUpperArm: this.createBodySegment(this.materials.body, 0.06),
            rightForearm: this.createBodySegment(this.materials.body, 0.05)
        };
        const joints = [
            this.createJointMesh(this.materials.body, "DynamicLandmarkShoulderCenter"),
            this.createJointMesh(this.materials.body, "DynamicLandmarkLeftShoulder"),
            this.createJointMesh(this.materials.body, "DynamicLandmarkLeftElbow"),
            this.createJointMesh(this.materials.body, "DynamicLandmarkLeftWrist"),
            this.createJointMesh(this.materials.body, "DynamicLandmarkRightShoulder"),
            this.createJointMesh(this.materials.body, "DynamicLandmarkRightElbow"),
            this.createJointMesh(this.materials.body, "DynamicLandmarkRightWrist")
        ];

        [torso, ...Object.values(segments), ...joints]
            .forEach((object) => this.upperBodyGroup.add(object));

        return { torso, segments, joints };
    }

    createBodyVolume(material, name) {
        const volume = new THREE.Mesh(this.bodyJointGeometry, material);
        volume.name = name;
        volume.castShadow = true;
        volume.receiveShadow = true;
        return volume;
    }

    createJointMesh(material, name) {
        const joint = new THREE.Mesh(this.bodyJointGeometry, material);
        joint.name = name;
        joint.castShadow = true;
        joint.receiveShadow = true;
        return joint;
    }

    async loadMotion(motion) {
        // Keep the neutral lower body and the previous pose visible while a
        // new gloss is loading. This prevents the Landmark view from popping
        // to a newly-built skeleton on every gloss change.
        this.clearMotion({ preserveBody: true });

        const landmarkPath = this.resolveLandmarkPath(motion);
        if (!landmarkPath) return null;

        const response = await fetch(landmarkPath);
        if (!response.ok) {
            throw new Error(`Failed to load landmark avatar data: ${landmarkPath}`);
        }

        const payload = await response.json();
        this.motion = {
            ...payload,
            body: Array.isArray(payload.body) ? payload.body : [],
            left_hand: Array.isArray(payload.left_hand) ? payload.left_hand : [],
            right_hand: Array.isArray(payload.right_hand) ? payload.right_hand : []
        };
        this.frameCount = Math.max(
            this.motion.body.length,
            this.motion.left_hand.length,
            this.motion.right_hand.length
        );
        this.staticBodyFrame = this.findStaticBodyFrame();
        this.referencePoint = this.getBodyAnchor(this.staticBodyFrame);

        if (!this.staticBodyBuilt) {
            this.bodyScale = this.estimateBodyScale();
            this.buildStaticBody();
            this.staticBodyBuilt = true;
        }
        this.updateFrame(0);
        this.root.visible = this.visible;

        return this.motion;
    }

    resolveLandmarkPath(motion) {
        if (!motion || typeof motion !== "object") return null;

        return motion.selectedLandmarkPath
            ?? motion.landmarkPath
            ?? motion.metadata?.landmarkPath
            ?? this.buildLandmarkPath(
                motion.selectedVideoId
                ?? motion.videoId
                ?? motion.metadata?.videoId
            );
    }

    buildLandmarkPath(videoId) {
        const normalizedVideoId = String(videoId ?? "").trim();
        return normalizedVideoId
            ? `/motion/landmarks/${normalizedVideoId}.json`
            : null;
    }

    findStaticBodyFrame() {
        return this.motion?.body.find((frame) => (
            Array.isArray(frame)
            && (isPointValid(frame[23]) || isPointValid(frame[24]) || isPointValid(frame[0]))
        )) ?? [];
    }

    getBodyAnchor(bodyFrame) {
        const leftHip = isPointValid(bodyFrame?.[23]) ? bodyFrame[23] : null;
        const rightHip = isPointValid(bodyFrame?.[24]) ? bodyFrame[24] : null;
        const anchor = leftHip && rightHip
            ? midpoint(asPoint(leftHip), asPoint(rightHip))
            : leftHip
                ? asPoint(leftHip)
                : rightHip
                    ? asPoint(rightHip)
                    : new THREE.Vector3();

        return [anchor.x, anchor.y, anchor.z];
    }

    toThreePoint(point) {
        return new THREE.Vector3(
            (Number(point[0] ?? 0) - this.referencePoint[0]) * this.bodyScale,
            -(Number(point[1] ?? 0) - this.referencePoint[1]) * this.bodyScale,
            -(Number(point[2] ?? 0) - this.referencePoint[2]) * this.bodyScale
        );
    }

    estimateBodyScale() {
        const leftShoulder = this.staticBodyFrame?.[11];
        const rightShoulder = this.staticBodyFrame?.[12];
        const leftHip = this.staticBodyFrame?.[23];
        const rightHip = this.staticBodyFrame?.[24];

        if (!isPointValid(leftShoulder) || !isPointValid(rightShoulder)) {
            return 1;
        }

        const shoulderWidth = asPoint(leftShoulder).distanceTo(asPoint(rightShoulder));
        const hipCenter = isPointValid(leftHip) && isPointValid(rightHip)
            ? midpoint(asPoint(leftHip), asPoint(rightHip))
            : null;
        const shoulderCenter = midpoint(asPoint(leftShoulder), asPoint(rightShoulder));
        const torsoLength = hipCenter?.distanceTo(shoulderCenter) ?? 0.58;
        const measuredLength = torsoLength > 0.08 ? torsoLength : shoulderWidth * 1.7;

        return clamp(measuredLength / 0.58, 0.82, 1.15);
    }

    buildStaticBody() {
        this.staticBodyGroup.clear();

        const scale = this.bodyScale;
        const point = (x, y, z = 0) => new THREE.Vector3(x * scale, y * scale, z * scale);
        const staticPoint = (index, fallback = null) => {
            const rawPoint = this.staticBodyFrame?.[index];
            return isPointValid(rawPoint)
                ? this.toThreePoint(rawPoint)
                : fallback?.clone() ?? null;
        };
        // The presentation Landmark avatar intentionally keeps the base pose
        // fixed. Lower-body landmarks are not part of the signing action and
        // rebuilding these from every gloss makes the avatar visibly switch
        // skeletons between words.
        const leftHip = point(0.14, 0, 0);
        const rightHip = point(-0.14, 0, 0);
        const hipCenter = point(0, 0.02, 0);
        const leftKnee = point(0.145, -0.47, 0.015);
        const rightKnee = point(-0.145, -0.47, 0.015);
        const leftAnkle = point(0.145, -0.96, 0.015);
        const rightAnkle = point(-0.145, -0.96, 0.015);
        const leftFootTip = point(0.145, -1.02, 0.18);
        const rightFootTip = point(-0.145, -1.02, 0.18);
        const leftWrist = point(0.37, 0.29, 0.075);
        const rightWrist = point(-0.37, 0.29, 0.075);
        const leftEar = staticPoint(7);
        const rightEar = staticPoint(8);
        const facePoints = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
            .map((index) => staticPoint(index))
            .filter(Boolean);
        const headCenter = midpoint(leftEar, rightEar) ?? average(facePoints) ?? point(0, 0.96, 0.025);
        const earDistance = leftEar && rightEar ? leftEar.distanceTo(rightEar) : 0;
        const headWidth = Math.max(
            0.14 * scale,
            earDistance
        );
        const headScale = [headWidth * 0.72, headWidth * 0.92, headWidth * 0.7];
        const headRadius = headScale[1];

        this.handAnchors = {
            left: leftWrist.clone(),
            right: rightWrist.clone()
        };
        this.staticBodyAnchors = {
            hipCenter: hipCenter.clone(),
            headCenter: headCenter.clone(),
            headRadius
        };

        const hipWidth = Math.max(0.16 * scale, leftHip.distanceTo(rightHip));
        const thighRadius = clamp(hipWidth * 0.25, 0.045 * scale, 0.08 * scale);
        const shinRadius = clamp(hipWidth * 0.21, 0.036 * scale, 0.068 * scale);
        const footRadius = clamp(hipWidth * 0.18, 0.03 * scale, 0.055 * scale);

        this.addStaticSegment(leftHip, rightHip, thighRadius * 0.92);
        this.addStaticSegment(leftHip, leftKnee, thighRadius);
        this.addStaticSegment(leftKnee, leftAnkle, shinRadius);
        this.addStaticSegment(leftAnkle, leftFootTip, footRadius);
        this.addStaticSegment(rightHip, rightKnee, thighRadius);
        this.addStaticSegment(rightKnee, rightAnkle, shinRadius);
        this.addStaticSegment(rightAnkle, rightFootTip, footRadius);

        this.addStaticVolume(
            hipCenter,
            [hipWidth * 0.72, hipWidth * 0.5, hipWidth * 0.62],
            this.materials.body,
            "StaticLandmarkPelvis"
        );
        this.addStaticVolume(headCenter, headScale, this.materials.face, "StaticLandmarkHead");
        this.addStaticJoint(hipCenter, hipWidth * 0.42, this.materials.body, "StaticLandmarkHipCenter");
        for (const [joint, name] of [
            [leftHip, "StaticLandmarkLeftHip"],
            [rightHip, "StaticLandmarkRightHip"],
            [leftKnee, "StaticLandmarkLeftKnee"],
            [rightKnee, "StaticLandmarkRightKnee"],
            [leftAnkle, "StaticLandmarkLeftAnkle"],
            [rightAnkle, "StaticLandmarkRightAnkle"],
            [leftFootTip, "StaticLandmarkLeftFoot"],
            [rightFootTip, "StaticLandmarkRightFoot"]
        ]) {
            this.addStaticJoint(joint, hipWidth * 0.25, this.materials.body, name);
        }
    }

    updateUpperBody(bodyFrame) {
        const leftShoulder = this.getSmoothedBodyPoint(bodyFrame, 11);
        const rightShoulder = this.getSmoothedBodyPoint(bodyFrame, 12);
        const leftElbow = this.getSmoothedBodyPoint(bodyFrame, 13);
        const rightElbow = this.getSmoothedBodyPoint(bodyFrame, 14);
        const leftWrist = this.getSmoothedBodyPoint(bodyFrame, 15);
        const rightWrist = this.getSmoothedBodyPoint(bodyFrame, 16);
        const shoulderCenter = midpoint(leftShoulder, rightShoulder);
        const staticHipCenter = this.staticBodyAnchors.hipCenter.clone();
        const staticHeadCenter = this.staticBodyAnchors.headCenter;

        if (!shoulderCenter) {
            this.currentBodyPose = null;
            return;
        }

        this.currentBodyPose = {
            leftWrist,
            rightWrist
        };

        const shoulderAcross = leftShoulder && rightShoulder
            ? leftShoulder.clone().sub(rightShoulder)
            : new THREE.Vector3(0.5 * this.bodyScale, 0, 0);
        if (shoulderAcross.lengthSq() < 1e-8) {
            shoulderAcross.set(0.5 * this.bodyScale, 0, 0);
        }
        const shoulderWidth = Math.max(0.2 * this.bodyScale, shoulderAcross.length());
        const acrossAxis = shoulderAcross.normalize();
        const leftShoulderPoint = leftShoulder ?? shoulderCenter.clone().addScaledVector(acrossAxis, shoulderWidth * 0.5);
        const rightShoulderPoint = rightShoulder ?? shoulderCenter.clone().addScaledVector(acrossAxis, -shoulderWidth * 0.5);
        const torsoDirection = shoulderCenter.clone().sub(staticHipCenter);
        const torsoLength = Math.max(0.25 * this.bodyScale, torsoDirection.length());
        const torsoAxis = torsoDirection.normalize();
        const normalAxis = acrossAxis.clone().cross(torsoAxis);
        if (normalAxis.lengthSq() < 1e-8) return;
        normalAxis.normalize();
        const torsoBasis = new THREE.Matrix4().makeBasis(
            acrossAxis,
            torsoAxis,
            normalAxis
        );
        this.setBodyVolume(
            this.upperBody.torso,
            staticHipCenter.clone().add(shoulderCenter).multiplyScalar(0.5),
            [shoulderWidth * 0.49, torsoLength * 0.53, shoulderWidth * 0.28],
            torsoBasis
        );
        this.updateSegment(
            this.upperBody.segments.shoulderBar,
            leftShoulderPoint,
            rightShoulderPoint,
            clamp(shoulderWidth * 0.11, 0.045, 0.075)
        );

        const upperArmRadius = clamp(shoulderWidth * 0.105, 0.045, 0.075);
        const forearmRadius = clamp(shoulderWidth * 0.09, 0.038, 0.065);
        const neckDirection = shoulderCenter.clone().sub(staticHeadCenter);
        const neckDistance = neckDirection.length();
        if (neckDistance > 1e-5) {
            const neckEnd = staticHeadCenter.clone().addScaledVector(
                neckDirection.normalize(),
                Math.min(this.staticBodyAnchors.headRadius * 0.92, neckDistance * 0.65)
            );
            this.updateSegment(
                this.upperBody.segments.neck,
                shoulderCenter,
                neckEnd,
                clamp(shoulderWidth * 0.06, 0.022, 0.038)
            );
        } else {
            this.updateSegment(this.upperBody.segments.neck, null, null, 0);
        }
        this.updateSegment(this.upperBody.segments.leftUpperArm, leftShoulderPoint, leftElbow, upperArmRadius);
        this.updateSegment(this.upperBody.segments.leftForearm, leftElbow, leftWrist, forearmRadius);
        this.updateSegment(this.upperBody.segments.rightUpperArm, rightShoulderPoint, rightElbow, upperArmRadius);
        this.updateSegment(this.upperBody.segments.rightForearm, rightElbow, rightWrist, forearmRadius);

        [shoulderCenter, leftShoulderPoint, leftElbow, leftWrist, rightShoulderPoint, rightElbow, rightWrist]
            .forEach((point, index) => {
                const joint = this.upperBody.joints[index];
                if (!point) {
                    joint.visible = false;
                    return;
                }

            joint.position.copy(point);
            joint.scale.setScalar(clamp(upperArmRadius * 1.18, 0.055, 0.09));
            joint.visible = this.showBodyLandmarks;
            });
    }

    getBodyPoint(bodyFrame, index) {
        const point = bodyFrame?.[index];
        return isPointValid(point) ? this.toThreePoint(point) : null;
    }

    getSmoothedBodyPoint(bodyFrame, index) {
        const target = this.getBodyPoint(bodyFrame, index);
        const previous = this.smoothedBodyPoints.get(index);
        if (!target) return previous?.clone() ?? null;

        if (!previous) {
            this.smoothedBodyPoints.set(index, target.clone());
            return target;
        }

        previous.lerp(target, this.bodySmoothing);
        return previous.clone();
    }

    setBodyVolume(volume, position, scale, basis) {
        volume.position.copy(position);
        volume.scale.set(...scale);
        volume.quaternion.setFromRotationMatrix(basis);
        volume.visible = true;
    }

    addStaticSegment(start, end, radius) {
        if (!start || !end) return;
        const segment = this.createBodySegment(this.materials.body, radius);
        this.updateSegment(segment, start, end, radius);
        this.staticBodyGroup.add(segment);
    }

    addStaticVolume(position, scale, material, name) {
        const volume = new THREE.Mesh(this.bodyJointGeometry, material);
        volume.name = name;
        volume.position.copy(position);
        volume.scale.set(...scale);
        volume.castShadow = true;
        volume.receiveShadow = true;
        this.staticBodyGroup.add(volume);
    }

    addStaticJoint(point, radius, material = this.materials.body, name = "StaticLandmarkJoint") {
        const joint = new THREE.Mesh(this.bodyJointGeometry, material);
        joint.name = name;
        joint.position.copy(point);
        joint.scale.setScalar(radius);
        joint.visible = this.showBodyLandmarks;
        joint.castShadow = true;
        joint.receiveShadow = true;
        this.staticBodyGroup.add(joint);
    }

    createSegment(material, radius) {
        const segment = new THREE.Mesh(this.segmentGeometry, material);
        segment.scale.set(radius, 1, radius);
        segment.castShadow = true;
        segment.receiveShadow = true;
        return segment;
    }

    createBodySegment(material, radius) {
        const segment = new THREE.Mesh(this.bodySegmentGeometry, material);
        segment.scale.set(radius, 1, radius);
        segment.castShadow = true;
        segment.receiveShadow = true;
        return segment;
    }

    alignHandPoints(handFrame, anchor) {
        if (!Array.isArray(handFrame) || handFrame.length === 0) return [];

        const rawPoints = handFrame.map((point) => (
            isPointValid(point) ? this.toThreePoint(point) : null
        ));
        const rawWrist = rawPoints[0];
        if (!rawWrist) return rawPoints;

        const offset = anchor.clone().sub(rawWrist);
        return rawPoints.map((point) => point ? point.clone().add(offset) : null);
    }

    updateFrame(frameIndex) {
        if (!this.motion || this.frameCount <= 0) return;

        this.frameIndex = ((frameIndex % this.frameCount) + this.frameCount) % this.frameCount;
        const bodyFrame = this.motion.body[this.frameIndex];
        const leftFrame = this.motion.left_hand[this.frameIndex];
        const rightFrame = this.motion.right_hand[this.frameIndex];
        this.updateUpperBody(bodyFrame);

        const leftWrist = this.currentBodyPose?.leftWrist ?? this.handAnchors.left;
        const rightWrist = this.currentBodyPose?.rightWrist ?? this.handAnchors.right;

        this.updateHand(this.leftHand, this.alignHandPoints(leftFrame, leftWrist));
        this.updateHand(this.rightHand, this.alignHandPoints(rightFrame, rightWrist));
    }

    updateHand(rig, points) {
        const wrist = points[0];
        const indexMcp = points[5];
        const middleMcp = points[9];
        const pinkyMcp = points[17];

        if (!wrist || !indexMcp || !middleMcp || !pinkyMcp) {
            this.hideHand(rig);
            return;
        }

        const across = indexMcp.clone().sub(pinkyMcp);
        const forward = middleMcp.clone().sub(wrist);
        const acrossLength = across.length();
        const forwardLength = forward.length();
        if (acrossLength < 1e-5 || forwardLength < 1e-5) {
            this.hideHand(rig);
            return;
        }

        const forwardAxis = forward.normalize();
        const acrossAxis = across.normalize();
        const normalAxis = forwardAxis.clone().cross(acrossAxis).normalize();
        const correctedAcross = normalAxis.clone().cross(forwardAxis).normalize();
        const palmCenter = average([wrist, indexMcp, middleMcp, pinkyMcp]);

        rig.palm.position.copy(palmCenter);
        rig.palm.quaternion.setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(forwardAxis, correctedAcross, normalAxis)
        );
        rig.palm.scale.set(
            clamp(forwardLength * 0.96, 0.035, 0.14),
            clamp(acrossLength * 0.88, 0.035, 0.14),
            clamp(Math.min(forwardLength, acrossLength) * 0.22, 0.018, 0.045)
        );
        rig.palm.visible = true;

        const jointRadius = clamp(acrossLength * 0.065, 0.009, 0.026);
        points.forEach((point, index) => {
            const joint = rig.joints[index];
            if (!point) {
                joint.position.copy(HIDDEN_POSITION);
                joint.visible = false;
                return;
            }

            joint.position.copy(point);
            joint.scale.setScalar(jointRadius);
            joint.visible = this.showHandLandmarks;
        });

        HAND_CONNECTIONS.forEach(([startIndex, endIndex], index) => {
            this.updateSegment(
                rig.segments[index],
                points[startIndex],
                points[endIndex],
                clamp(acrossLength * 0.05, 0.007, 0.022)
            );
        });
    }

    updateSegment(segment, start, end, radius) {
        if (!start || !end) {
            segment.position.copy(HIDDEN_POSITION);
            segment.visible = false;
            return;
        }

        const direction = end.clone().sub(start);
        const length = direction.length();
        if (length < 1e-5) {
            segment.position.copy(HIDDEN_POSITION);
            segment.visible = false;
            return;
        }

        segment.position.copy(start).add(end).multiplyScalar(0.5);
        segment.scale.set(radius, length, radius);
        segment.quaternion.setFromUnitVectors(UNIT_Y, direction.normalize());
        segment.visible = true;
    }

    hideHand(rig) {
        rig.palm.visible = false;
        rig.joints.forEach((joint) => {
            joint.visible = false;
            joint.position.copy(HIDDEN_POSITION);
        });
        rig.segments.forEach((segment) => {
            segment.visible = false;
            segment.position.copy(HIDDEN_POSITION);
        });
    }

    hideUpperBody() {
        this.upperBodyGroup?.children.forEach((object) => {
            object.visible = false;
            object.position.copy(HIDDEN_POSITION);
        });
    }

    clearMotion({ preserveBody = false } = {}) {
        this.motion = null;
        this.frameCount = 0;
        this.frameIndex = 0;
        this.staticBodyFrame = [];
        if (!preserveBody) {
            this.smoothedBodyPoints.clear();
            this.currentBodyPose = null;
            this.staticBodyGroup.clear();
            this.staticBodyBuilt = false;
            this.hideHand(this.leftHand);
            this.hideHand(this.rightHand);
            this.hideUpperBody();
            this.root.visible = false;
        }
    }

    setVisible(visible) {
        this.visible = Boolean(visible);
        this.root.visible = this.visible && Boolean(this.motion);
    }

    setRootPosition(position) {
        if (position) this.root.position.copy(position);
    }

    dispose() {
        this.scene?.remove(this.root);
        this.segmentGeometry.dispose();
        this.bodySegmentGeometry.dispose();
        this.jointGeometry.dispose();
        this.bodyJointGeometry.dispose();
        this.palmGeometry.dispose();
        Object.values(this.materials).forEach((material) => material.dispose());
        this.motion = null;
        this.root = null;
    }
}
