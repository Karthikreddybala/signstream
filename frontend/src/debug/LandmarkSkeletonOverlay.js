import * as THREE from "three";

export const DEBUG_LANDMARKS = false;

const BODY_CONNECTIONS = [
    [0, 11], [0, 12], [11, 12], [11, 23], [12, 24], [23, 24],
    [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
    [23, 25], [25, 27], [27, 29], [29, 31],
    [24, 26], [26, 28], [28, 30], [30, 32],
    [0, 1], [1, 2], [2, 3],
    [0, 4], [4, 5], [5, 6],
    [0, 7], [0, 8], [7, 9], [8, 10]
];

const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20]
];

function isPointValid(point) {

    return Array.isArray(point)
        && point.length >= 3
        && point.some((component) => {
            const numericValue = Number(component);
            return Number.isFinite(numericValue) && Math.abs(numericValue) > 1e-6;
        });

}

function toThreePoint(point, scale) {

    return new THREE.Vector3(
        Number(point[0] ?? 0) * scale,
        -Number(point[1] ?? 0) * scale,
        -Number(point[2] ?? 0) * scale
    );

}

function clonePoint(point) {

    return [
        Number(point[0] ?? 0),
        Number(point[1] ?? 0),
        Number(point[2] ?? 0)
    ];

}

function applyOffset(point, offset) {

    return [
        Number(point[0] ?? 0) + offset[0],
        Number(point[1] ?? 0) + offset[1],
        Number(point[2] ?? 0) + offset[2]
    ];

}

export default class LandmarkSkeletonOverlay {

    constructor(scene, options = {}) {

        this.scene = scene;
        this.hiddenPosition = new THREE.Vector3(1e6, 1e6, 1e6);
        this.options = {
            scale: options.scale ?? 1.0,
            offset: options.offset ?? new THREE.Vector3(0, 0, 0),
            bodyColor: options.bodyColor ?? 0x6fe8ff,
            leftHandColor: options.leftHandColor ?? 0x75ff88,
            rightHandColor: options.rightHandColor ?? 0xff79d1,
            bodyLineColor: options.bodyLineColor ?? 0xffffff,
            handLineColor: options.handLineColor ?? 0xddeeff,
            pointSize: options.pointSize ?? 0.04
        };

        this.root = new THREE.Group();
        this.root.name = "LandmarkSkeletonOverlay";
        this.root.position.copy(this.options.offset);
        this.root.scale.setScalar(this.options.scale);
        this.root.renderOrder = 1000;
        this.debugVisible = options.visible ?? DEBUG_LANDMARKS;
        this.root.visible = this.debugVisible;

        this.scene.add(this.root);

        this.motion = null;
        this.referencePoint = [0, 0, 0];
        this.frameIndex = 0;
        this.frameCount = 0;

        this.bodyPoints = this.createPoints(33, this.options.bodyColor);
        this.leftHandPoints = this.createPoints(21, this.options.leftHandColor);
        this.rightHandPoints = this.createPoints(21, this.options.rightHandColor);

        this.bodyLines = this.createLines(BODY_CONNECTIONS.length, this.options.bodyLineColor);
        this.leftHandLines = this.createLines(HAND_CONNECTIONS.length, this.options.handLineColor);
        this.rightHandLines = this.createLines(HAND_CONNECTIONS.length, this.options.handLineColor);

        this.root.add(this.bodyPoints.object);
        this.root.add(this.leftHandPoints.object);
        this.root.add(this.rightHandPoints.object);
        this.root.add(this.bodyLines.object);
        this.root.add(this.leftHandLines.object);
        this.root.add(this.rightHandLines.object);

    }

    createPoints(count, color) {

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);

        geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(positions, 3)
        );
        geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);

        const material = new THREE.PointsMaterial({
            color,
            size: this.options.pointSize,
            sizeAttenuation: true,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 0.95
        });

        const object = new THREE.Points(geometry, material);
        object.frustumCulled = false;

        return { object, geometry, material, positions };

    }

    createLines(connectionCount, color) {

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(connectionCount * 2 * 3);

        geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(positions, 3)
        );
        geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);

        const material = new THREE.LineBasicMaterial({
            color,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 0.8
        });

        const object = new THREE.LineSegments(geometry, material);
        object.frustumCulled = false;

        return { object, geometry, material, positions };

    }

    async loadMotion(motion) {

        this.motion = null;
        this.frameIndex = 0;
        this.frameCount = 0;

        const landmarkPath = this.resolveLandmarkPath(motion);

        if (!landmarkPath) {
            this.clear();
            return null;
        }

        const response = await fetch(landmarkPath);

        if (!response.ok) {
            throw new Error(`Failed to load landmark debug file: ${landmarkPath}`);
        }

        const payload = await response.json();

        this.motion = {
            ...payload,
            body: Array.isArray(payload.body) ? payload.body : [],
            left_hand: Array.isArray(payload.left_hand) ? payload.left_hand : [],
            right_hand: Array.isArray(payload.right_hand) ? payload.right_hand : []
        };
        this.referencePoint = this.getBodyAnchor(this.motion.body[0]);
        this.frameCount = Math.max(
            this.motion.body.length,
            this.motion.left_hand.length,
            this.motion.right_hand.length
        );

        this.root.visible = this.debugVisible;
        this.updateFrame(0);

        return this.motion;

    }

    resolveLandmarkPath(motion) {

        if (!motion || typeof motion !== "object") {
            return null;
        }

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

        if (!normalizedVideoId) {
            return null;
        }

        return `/motion/landmarks/${normalizedVideoId}.json`;

    }

    clear() {

        this.motion = null;
        this.referencePoint = [0, 0, 0];
        this.frameIndex = 0;
        this.frameCount = 0;
        this.root.visible = false;
        this.resetGeometry();

    }

    resetGeometry() {

        this.fillPoints(this.bodyPoints, []);
        this.fillPoints(this.leftHandPoints, []);
        this.fillPoints(this.rightHandPoints, []);
        this.fillLines(this.bodyLines, BODY_CONNECTIONS, []);
        this.fillLines(this.leftHandLines, HAND_CONNECTIONS, []);
        this.fillLines(this.rightHandLines, HAND_CONNECTIONS, []);

    }

    setVisible(visible) {

        this.debugVisible = Boolean(visible);
        this.root.visible = this.debugVisible;

    }

    setRootPosition(position) {

        if (!this.root || !position) {
            return;
        }

        this.root.position.copy(position);

    }

    updateFrame(frameIndex) {

        if (!this.motion || this.frameCount <= 0) {
            return;
        }

        const normalizedFrameIndex = ((frameIndex % this.frameCount) + this.frameCount) % this.frameCount;

        this.frameIndex = normalizedFrameIndex;

        const bodyFrame = this.motion.body[normalizedFrameIndex] ?? null;
        const leftHandFrame = this.motion.left_hand[normalizedFrameIndex] ?? null;
        const rightHandFrame = this.motion.right_hand[normalizedFrameIndex] ?? null;

        this.fillPoints(this.bodyPoints, this.convertFrame(bodyFrame));
        this.fillLines(this.bodyLines, BODY_CONNECTIONS, this.convertFrame(bodyFrame));

        const alignedLeftHand = this.alignHandFrame(
            leftHandFrame,
            bodyFrame,
            15
        );
        const alignedRightHand = this.alignHandFrame(
            rightHandFrame,
            bodyFrame,
            16
        );

        this.fillPoints(this.leftHandPoints, this.convertFrame(alignedLeftHand));
        this.fillLines(this.leftHandLines, HAND_CONNECTIONS, this.convertFrame(alignedLeftHand));

        this.fillPoints(this.rightHandPoints, this.convertFrame(alignedRightHand));
        this.fillLines(this.rightHandLines, HAND_CONNECTIONS, this.convertFrame(alignedRightHand));

    }

    alignHandFrame(handFrame, bodyFrame, bodyWristIndex) {

        if (!Array.isArray(handFrame) || handFrame.length === 0) {
            return [];
        }

        const rawHandWrist = handFrame[0];
        const rawBodyWrist = Array.isArray(bodyFrame) ? bodyFrame[bodyWristIndex] : null;

        if (!isPointValid(rawHandWrist)) {
            return handFrame.map((point) => clonePoint(point));
        }

        const anchor = isPointValid(rawBodyWrist)
            ? rawBodyWrist
            : rawHandWrist;

        const offset = [
            Number(anchor[0] ?? 0) - Number(rawHandWrist[0] ?? 0),
            Number(anchor[1] ?? 0) - Number(rawHandWrist[1] ?? 0),
            Number(anchor[2] ?? 0) - Number(rawHandWrist[2] ?? 0)
        ];

        return handFrame.map((point) => {

            if (!isPointValid(point)) {
                return clonePoint(point);
            }

            return applyOffset(point, offset);

        });

    }

    getBodyAnchor(bodyFrame) {

        if (!Array.isArray(bodyFrame)) {
            return [0, 0, 0];
        }

        const leftHip = bodyFrame[23];
        const rightHip = bodyFrame[24];

        if (isPointValid(leftHip) && isPointValid(rightHip)) {
            return [
                (Number(leftHip[0]) + Number(rightHip[0])) / 2,
                (Number(leftHip[1]) + Number(rightHip[1])) / 2,
                (Number(leftHip[2]) + Number(rightHip[2])) / 2
            ];
        }

        return isPointValid(leftHip)
            ? clonePoint(leftHip)
            : isPointValid(rightHip)
                ? clonePoint(rightHip)
                : [0, 0, 0];

    }

    convertFrame(frame) {

        if (!Array.isArray(frame) || frame.length === 0) {
            return [];
        }

        return frame.map((point) => {

            if (!isPointValid(point)) {
                return null;
            }

            return toThreePoint([
                Number(point[0]) - this.referencePoint[0],
                Number(point[1]) - this.referencePoint[1],
                Number(point[2]) - this.referencePoint[2]
            ], 1);

        });

    }

    fillPoints(target, points) {

        const positionAttribute = target.geometry.attributes.position;

        for (let index = 0; index < target.positions.length / 3; index += 1) {

            const point = points[index];
            const offset = index * 3;

            if (!point) {
                target.positions[offset] = this.hiddenPosition.x;
                target.positions[offset + 1] = this.hiddenPosition.y;
                target.positions[offset + 2] = this.hiddenPosition.z;
                continue;
            }

            target.positions[offset] = point.x;
            target.positions[offset + 1] = point.y;
            target.positions[offset + 2] = point.z;

        }

        positionAttribute.needsUpdate = true;

    }

    fillLines(target, connections, points) {

        const positionAttribute = target.geometry.attributes.position;
        let writeIndex = 0;

        for (const [startIndex, endIndex] of connections) {

            const startPoint = points[startIndex];
            const endPoint = points[endIndex];

            if (!startPoint || !endPoint) {
                target.positions[writeIndex++] = this.hiddenPosition.x;
                target.positions[writeIndex++] = this.hiddenPosition.y;
                target.positions[writeIndex++] = this.hiddenPosition.z;
                target.positions[writeIndex++] = this.hiddenPosition.x;
                target.positions[writeIndex++] = this.hiddenPosition.y;
                target.positions[writeIndex++] = this.hiddenPosition.z;
                continue;
            }

            target.positions[writeIndex++] = startPoint.x;
            target.positions[writeIndex++] = startPoint.y;
            target.positions[writeIndex++] = startPoint.z;
            target.positions[writeIndex++] = endPoint.x;
            target.positions[writeIndex++] = endPoint.y;
            target.positions[writeIndex++] = endPoint.z;

        }

        positionAttribute.needsUpdate = true;

    }

    disposeObject(target) {

        if (!target) {
            return;
        }

        target.geometry?.dispose?.();
        target.material?.dispose?.();

    }

    dispose() {

        this.scene?.remove(this.root);

        this.disposeObject(this.bodyPoints);
        this.disposeObject(this.leftHandPoints);
        this.disposeObject(this.rightHandPoints);
        this.disposeObject(this.bodyLines);
        this.disposeObject(this.leftHandLines);
        this.disposeObject(this.rightHandLines);

        this.motion = null;
        this.root = null;

    }

}
