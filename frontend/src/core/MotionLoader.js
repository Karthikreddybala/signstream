import { Euler, Quaternion } from "three";

const JOINT_ALIASES = {

    hips: "PELVIS",
    pelvis: "PELVIS",
    spine: "SPINE1",
    chest: "SPINE2",
    upperChest: "SPINE3",
    neck: "NECK",
    head: "HEAD",

    leftShoulder: "LEFT_COLLAR",
    rightShoulder: "RIGHT_COLLAR",
    leftUpperArm: "LEFT_SHOULDER",
    rightUpperArm: "RIGHT_SHOULDER",
    leftLowerArm: "LEFT_ELBOW",
    rightLowerArm: "RIGHT_ELBOW",
    leftHand: "LEFT_WRIST",
    rightHand: "RIGHT_WRIST",

    leftUpperLeg: "LEFT_HIP",
    rightUpperLeg: "RIGHT_HIP",
    leftLowerLeg: "LEFT_KNEE",
    rightLowerLeg: "RIGHT_KNEE",
    leftFoot: "LEFT_ANKLE",
    rightFoot: "RIGHT_ANKLE",
    leftToes: "LEFT_FOOT",
    rightToes: "RIGHT_FOOT"

};

function cloneData(value) {

    return JSON.parse(JSON.stringify(value));

}

function toStringArray(value) {

    if (Array.isArray(value)) {
        return value
            .map((item) => String(item).trim())
            .filter(Boolean);
    }

    if (value === null || value === undefined) {
        return [];
    }

    const text = String(value).trim();

    return text ? [text] : [];

}

function slugify(value) {

    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

}

function normalizeLookupValue(value) {

    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");

}

function normalizeMotionVariant(variant) {

    if (!variant || typeof variant !== "object") {
        return null;
    }

    const videoId = String(
        variant.videoId ?? variant.video_id ?? ""
    ).trim() || null;
    const motionPath = String(
        variant.motionPath ?? variant.motion_path ?? ""
    ).trim() || null;
    const landmarkPath = String(
        variant.landmarkPath ?? variant.landmark_path ?? ""
    ).trim() || null;

    if (!videoId && !motionPath) {
        return null;
    }

    return {
        videoId,
        motionPath,
        landmarkPath,
        status: String(variant.status ?? (motionPath ? "ready" : "pending")),
        sourceVideoPath: String(
            variant.sourceVideoPath ?? variant.source_video_path ?? ""
        ).trim() || null
    };

}

function toQuaternionComponents(value) {

    if (!value) return null;

    if (Array.isArray(value)) {

        const [x = 0, y = 0, z = 0, w = 1] = value;

        return { x, y, z, w };

    }

    if (typeof value === "object") {

        if ("rotation" in value) {
            return toQuaternionComponents(value.rotation);
        }

        const x = Number(value.x ?? 0);
        const y = Number(value.y ?? 0);
        const z = Number(value.z ?? 0);
        const w = Number(value.w ?? 1);

        return { x, y, z, w };

    }

    return null;

}

function toPositionComponents(value) {

    if (!value) return null;

    if (Array.isArray(value)) {

        const [x = 0, y = 0, z = 0] = value;

        return { x, y, z };

    }

    if (typeof value === "object") {

        if ("position" in value) {
            return toPositionComponents(value.position);
        }

        const x = Number(value.x ?? 0);
        const y = Number(value.y ?? 0);
        const z = Number(value.z ?? 0);

        return { x, y, z };

    }

    return null;

}

function canonicalJointName(name) {

    return JOINT_ALIASES[name] ?? name;

}

export default class MotionLoader {

    constructor() {
        this.motion = null;
        this.manifest = null;
        this.manifestPath = null;
        this.previewMotionPath = "/motion/frame_0000.json";
    }

    async load(path, options = {}) {

        const response = await fetch(path, { cache: "no-store" });

        if (!response.ok) {
            throw new Error(
                `Failed to load motion file: ${path}`
            );
        }

        const motion = await response.json();
        const normalizedMotion = this.normalizeMotion(motion, options);

        this.validate(normalizedMotion);

        this.motion = normalizedMotion;

        return normalizedMotion;
    }

    async loadManifest(path = "/motion/manifest.json") {

        const response = await fetch(path, { cache: "no-store" });

        if (!response.ok) {
            throw new Error(
                `Failed to load motion manifest: ${path}`
            );
        }

        const manifest = await response.json();
        const normalizedManifest = this.normalizeManifest(manifest);

        this.manifest = normalizedManifest;
        this.manifestPath = path;

        return normalizedManifest;
    }

    normalizeManifest(manifest) {

        const source = manifest && typeof manifest === "object"
            ? cloneData(manifest)
            : {};

        let entries = [];

        if (Array.isArray(source.clips)) {
            entries = source.clips;
        } else if (Array.isArray(source.glosses)) {
            entries = source.glosses;
        } else if (Array.isArray(source.entries)) {
            entries = source.entries;
        }

        const normalizedClips = entries
            .map((entry) => this.normalizeManifestEntry(entry))
            .filter(Boolean);

        return {
            version: source.version ?? 1,
            name: source.name ?? "gloss_manifest",
            dataset: source.dataset ?? null,
            sourceJson: source.sourceJson ?? null,
            generatedAt: source.generatedAt ?? null,
            defaultMotionPath: source.defaultMotionPath ?? this.previewMotionPath,
            clipCount: normalizedClips.length,
            clips: normalizedClips
        };

    }

    normalizeManifestEntry(entry) {

        if (!entry || typeof entry !== "object") {
            return null;
        }

        const gloss = String(
            entry.gloss ?? entry.name ?? entry.label ?? ""
        ).trim();

        if (!gloss) {
            return null;
        }

        const videoIds = toStringArray(
            entry.videoIds ?? entry.videoId ?? entry.video_id
        );
        const slug = String(entry.slug ?? slugify(gloss));
        const previewMotionPath = typeof entry.previewMotionPath === "string" && entry.previewMotionPath.trim()
            ? entry.previewMotionPath.trim()
            : this.previewMotionPath;
        const motionPath = typeof entry.motionPath === "string" && entry.motionPath.trim()
            ? entry.motionPath.trim()
            : null;
        const primaryMotionPath = typeof entry.primaryMotionPath === "string" && entry.primaryMotionPath.trim()
            ? entry.primaryMotionPath.trim()
            : null;
        const landmarkPath = typeof entry.landmarkPath === "string" && entry.landmarkPath.trim()
            ? entry.landmarkPath.trim()
            : null;
        const primaryLandmarkPath = typeof entry.primaryLandmarkPath === "string" && entry.primaryLandmarkPath.trim()
            ? entry.primaryLandmarkPath.trim()
            : null;
        const motionVariantSources = Array.isArray(entry.motionVariants)
            ? entry.motionVariants
            : Array.isArray(entry.variants)
                ? entry.variants
                : [];
        const normalizedMotionVariants = motionVariantSources
            .map((variant) => normalizeMotionVariant(variant))
            .filter(Boolean);
        const motionPathsFromEntry = toStringArray(entry.motionPaths);
        const landmarkPathsFromEntry = toStringArray(entry.landmarkPaths);

        if (normalizedMotionVariants.length === 0 && motionPathsFromEntry.length > 0) {
            motionPathsFromEntry.forEach((motionVariantPath, index) => {
                normalizedMotionVariants.push({
                    videoId: videoIds[index] ?? videoIds[0] ?? null,
                    motionPath: motionVariantPath,
                    landmarkPath: landmarkPathsFromEntry[index] ?? landmarkPathsFromEntry[0] ?? null,
                    status: String(entry.status ?? "ready"),
                    sourceVideoPath: null
                });
            });
        }

        if (normalizedMotionVariants.length === 0 && motionPath) {
            normalizedMotionVariants.push({
                videoId: String(entry.primaryVideoId ?? videoIds[0] ?? "").trim() || null,
                motionPath,
                landmarkPath,
                status: String(entry.status ?? "ready"),
                sourceVideoPath: null
            });
        }

        const motionPaths = [
            primaryMotionPath,
            motionPath,
            ...normalizedMotionVariants.map((variant) => variant.motionPath)
        ].filter(Boolean);
        const landmarkPaths = [
            primaryLandmarkPath,
            landmarkPath,
            ...normalizedMotionVariants.map((variant) => variant.landmarkPath)
        ].filter(Boolean);
        const readyMotionVariant = normalizedMotionVariants.find((variant) => variant.status === "ready" && variant.motionPath) ?? null;
        const primaryResolvedMotionPath = primaryMotionPath
            ?? readyMotionVariant?.motionPath
            ?? motionPaths[0]
            ?? previewMotionPath;
        const primaryResolvedLandmarkPath = primaryLandmarkPath
            ?? readyMotionVariant?.landmarkPath
            ?? landmarkPaths[0]
            ?? null;
        const primaryResolvedVideoId = String(
            entry.primaryVideoId ?? readyMotionVariant?.videoId ?? videoIds[0] ?? ""
        ).trim() || null;
        const readyVideoCount = normalizedMotionVariants.filter((variant) => variant.status === "ready").length;
        const sourceVideoCount = Number.isFinite(Number(entry.sourceVideoCount))
            ? Number(entry.sourceVideoCount)
            : videoIds.length || normalizedMotionVariants.length;
        const status = String(
            entry.status ?? (
                readyVideoCount >= sourceVideoCount && sourceVideoCount > 0
                    ? "ready"
                    : readyVideoCount > 0
                        ? "partial"
                        : "pending"
            )
        );

        return {
            gloss,
            slug,
            videoIds,
            primaryVideoId: primaryResolvedVideoId,
            motionPath: primaryResolvedMotionPath,
            primaryMotionPath: primaryResolvedMotionPath,
            motionPaths,
            landmarkPath: primaryResolvedLandmarkPath,
            primaryLandmarkPath: primaryResolvedLandmarkPath,
            landmarkPaths,
            motionVariants: normalizedMotionVariants,
            previewMotionPath,
            status,
            sourceVideoCount,
            readyVideoCount
        };

    }

    findClip(identifier) {

        if (!this.manifest || !identifier) {
            return null;
        }

        const target = normalizeLookupValue(identifier);

        if (!target) {
            return null;
        }

        return (
            this.manifest.clips.find((clip) => {

                const gloss = normalizeLookupValue(clip.gloss);
                const slug = normalizeLookupValue(clip.slug);
                const primaryVideoId = normalizeLookupValue(clip.primaryVideoId);
                const videoIds = (clip.videoIds ?? []).map((videoId) => normalizeLookupValue(videoId));
                const motionPaths = [
                    clip.motionPath,
                    clip.primaryMotionPath,
                    ...(clip.motionPaths ?? [])
                ].map((motionPath) => normalizeLookupValue(motionPath));
                const variantVideoIds = (clip.motionVariants ?? []).map((variant) => normalizeLookupValue(variant.videoId));
                const variantMotionPaths = (clip.motionVariants ?? []).map((variant) => normalizeLookupValue(variant.motionPath));

                return (
                    gloss === target ||
                    slug === target ||
                    primaryVideoId === target ||
                    videoIds.includes(target) ||
                    motionPaths.includes(target) ||
                    variantVideoIds.includes(target) ||
                    variantMotionPaths.includes(target)
                );

            }) ?? null
        );

    }

    getAvailableClips() {

        return this.manifest?.clips ?? [];

    }

    getAvailableGlosses() {

        return this.getAvailableClips().map((clip) => clip.gloss);

    }

    async loadGloss(identifier, options = {}) {

        if (!this.manifest) {
            if (typeof identifier === "string" && identifier.trim().toLowerCase().endsWith(".json")) {
                return this.load(identifier, options);
            }

            throw new Error("Motion manifest not loaded.");
        }

        const clip = this.findClip(identifier);

        if (!clip) {
            if (typeof identifier === "string" && identifier.trim().toLowerCase().endsWith(".json")) {
                return this.load(identifier, options);
            }

            throw new Error(
                `Gloss '${identifier}' not found in manifest.`
            );
        }

        const selectedVariant = this.selectMotionVariant(clip, identifier);
        const preferredPath = selectedVariant?.motionPath
            ?? clip.primaryMotionPath
            ?? clip.motionPath
            ?? clip.previewMotionPath
            ?? this.manifest.defaultMotionPath
            ?? this.previewMotionPath;
        let loadedPath = preferredPath;

        let motion;

        try {
            motion = await this.load(preferredPath, {
                ...options,
                previewIdleFallback: options.previewIdleFallback ?? true
            });
        } catch (error) {

            loadedPath = clip.previewMotionPath ?? this.previewMotionPath;

            if (preferredPath !== loadedPath) {
                motion = await this.load(loadedPath, {
                    ...options,
                    previewIdleFallback: true
                });
            } else {
                throw error;
            }

        }

        motion.name = clip.gloss;
        motion.gloss = clip.gloss;
        motion.slug = clip.slug;
        motion.videoIds = clip.videoIds;
        motion.primaryVideoId = clip.primaryVideoId;
        motion.motionVariants = clip.motionVariants;
        motion.motionPaths = clip.motionPaths;
        motion.landmarkPaths = clip.landmarkPaths;
        motion.primaryMotionPath = clip.primaryMotionPath;
        motion.selectedVideoId = selectedVariant?.videoId ?? clip.primaryVideoId ?? null;
        motion.selectedMotionPath = selectedVariant?.motionPath ?? preferredPath;
        motion.selectedLandmarkPath = selectedVariant?.landmarkPath
            ?? clip.primaryLandmarkPath
            ?? clip.landmarkPath
            ?? this.buildLandmarkPath(motion.selectedVideoId ?? motion.metadata?.videoId ?? null);
        motion.sourceVideoPath = selectedVariant?.sourceVideoPath ?? null;
        motion.motionPath = motion.motionPath ?? preferredPath;
        motion.landmarkPath = motion.metadata?.landmarkPath ?? motion.selectedLandmarkPath ?? null;
        motion.clipStatus = loadedPath === (clip.previewMotionPath ?? this.previewMotionPath)
            ? "preview"
            : (selectedVariant?.status ?? clip.status);
        motion.isPreview = loadedPath === (clip.previewMotionPath ?? this.previewMotionPath);

        this.motion = motion;

        return motion;

    }

    buildLandmarkPath(videoId) {

        const normalizedVideoId = String(videoId ?? "").trim();

        if (!normalizedVideoId) {
            return null;
        }

        return `/motion/landmarks/${normalizedVideoId}.json`;

    }

    normalizeMotion(motion, options = {}) {

        const source = cloneData(motion);
        const frames = Array.isArray(source.frames) ? source.frames : [];

        const normalizedFrames = frames.map((frame) => {
            return this.normalizeFrame(frame);
        });

        const normalizedMotion = {
            version: source.version ?? "1.0",
            name: source.name ?? "motion",
            fps: Number.isFinite(Number(source.fps))
                ? Number(source.fps)
                : 30,
            frame_count: normalizedFrames.length,
            frames: normalizedFrames,
            metadata: source.metadata ?? null,
            videoId: source.videoId ?? source.metadata?.videoId ?? null,
            sourceVideoPath: source.sourceVideoPath ?? source.metadata?.sourceVideoPath ?? null,
            landmarkPath: source.landmarkPath ?? source.metadata?.landmarkPath ?? null,
            landmarkPaths: Array.isArray(source.landmarkPaths)
                ? cloneData(source.landmarkPaths)
                : []
        };

        if (options.previewIdleFallback && normalizedFrames.length === 1) {
            return this.buildPreviewLoop(normalizedMotion);
        }

        return normalizedMotion;

    }

    normalizeFrame(frame) {

        const joints = {};

        if (frame && typeof frame.joints === "object" && !Array.isArray(frame.joints)) {

            for (const [jointName, jointData] of Object.entries(frame.joints)) {
                this.assignJoint(joints, jointName, jointData);
            }

        }

        for (const [sourceJointName, canonicalName] of Object.entries(JOINT_ALIASES)) {

            if (joints[canonicalName]) {
                continue;
            }

            if (!frame || !(sourceJointName in frame)) {
                continue;
            }

            this.assignJoint(joints, canonicalName, frame[sourceJointName]);

        }

        return {
            joints
        };

    }

    assignJoint(target, jointName, jointData) {

        if (!jointData) return;

        const canonicalName = canonicalJointName(jointName);
        const rotation = toQuaternionComponents(
            jointData.rotation ?? jointData
        );
        const position = toPositionComponents(
            jointData.position
        );

        const normalizedJoint = {};

        if (rotation) {
            normalizedJoint.rotation = rotation;
        }

        if (position) {
            normalizedJoint.position = position;
        }

        if (jointData.locked === true) {
            normalizedJoint.locked = true;
        }

        if (jointData.tracked === false) {
            normalizedJoint.tracked = false;
        } else if (jointData.tracked === true) {
            normalizedJoint.tracked = true;
        }

        if (Object.keys(normalizedJoint).length > 0) {
            target[canonicalName] = normalizedJoint;
        }

    }

    buildPreviewLoop(motion) {

        const previewFrameCount = 90;
        const frames = [];
        const baseFrame = motion.frames[0];

        for (let index = 0; index < previewFrameCount; index += 1) {

            const phase = (index / previewFrameCount) * Math.PI * 2;
            const frame = cloneData(baseFrame);

            this.offsetJointRotation(frame, "PELVIS", {
                x: 0,
                y: 0,
                z: 0.015 * Math.sin(phase * 2)
            });

            this.offsetJointPosition(frame, "PELVIS", {
                x: 0,
                y: 0.015 * Math.sin(phase * 2),
                z: 0
            });

            this.offsetJointRotation(frame, "SPINE1", {
                x: 0.02 * Math.sin(phase * 0.5),
                y: 0,
                z: 0.01 * Math.sin(phase)
            });

            this.offsetJointRotation(frame, "SPINE2", {
                x: 0.015 * Math.sin(phase * 0.5 + 0.35),
                y: 0,
                z: 0.012 * Math.sin(phase + 0.2)
            });

            this.offsetJointRotation(frame, "NECK", {
                x: 0,
                y: 0.015 * Math.sin(phase * 0.75),
                z: 0.008 * Math.sin(phase * 0.5)
            });

            this.offsetJointRotation(frame, "HEAD", {
                x: 0,
                y: 0.02 * Math.sin(phase * 0.5 + 0.4),
                z: 0.01 * Math.sin(phase * 0.75)
            });

            this.offsetJointRotation(frame, "LEFT_SHOULDER", {
                x: 0.015 * Math.sin(phase + 0.2),
                y: 0,
                z: 0.08 * Math.sin(phase)
            });

            this.offsetJointRotation(frame, "LEFT_ELBOW", {
                x: 0.02 * Math.sin(phase + 0.5),
                y: 0,
                z: -0.04 * Math.sin(phase + 0.6)
            });

            this.offsetJointRotation(frame, "RIGHT_SHOULDER", {
                x: -0.015 * Math.sin(phase + 0.2),
                y: 0,
                z: -0.08 * Math.sin(phase)
            });

            this.offsetJointRotation(frame, "RIGHT_ELBOW", {
                x: -0.02 * Math.sin(phase + 0.5),
                y: 0,
                z: 0.04 * Math.sin(phase + 0.6)
            });

            frames.push(frame);

        }

        return {
            ...motion,
            name: "preview_idle",
            frame_count: frames.length,
            frames
        };

    }

    offsetJointRotation(frame, jointName, eulerOffset) {

        const joint = frame.joints[jointName];

        if (!joint || !joint.rotation) return;

        const base = toQuaternionComponents(joint.rotation);
        const baseQuaternion = new Quaternion(
            base.x,
            base.y,
            base.z,
            base.w
        );
        const offsetQuaternion = new Quaternion().setFromEuler(
            new Euler(
                eulerOffset.x ?? 0,
                eulerOffset.y ?? 0,
                eulerOffset.z ?? 0,
                "XYZ"
            )
        );

        baseQuaternion.multiply(offsetQuaternion);

        joint.rotation = {
            x: baseQuaternion.x,
            y: baseQuaternion.y,
            z: baseQuaternion.z,
            w: baseQuaternion.w
        };

    }

    offsetJointPosition(frame, jointName, positionOffset) {

        const joint = frame.joints[jointName];

        if (!joint || !joint.position) return;

        const base = toPositionComponents(joint.position);

        joint.position = {
            x: base.x + (positionOffset.x ?? 0),
            y: base.y + (positionOffset.y ?? 0),
            z: base.z + (positionOffset.z ?? 0)
        };

    }

    validate(motion) {

        if (!Array.isArray(motion.frames)) {
            throw new Error("motion.json missing frames");
        }

        if (motion.frames.length === 0) {
            throw new Error("motion.json has no frames");
        }

        if (!Number.isFinite(Number(motion.fps)) || Number(motion.fps) <= 0) {
            throw new Error("motion.json missing fps");
        }

        for (const frame of motion.frames) {

            if (!frame.joints || typeof frame.joints !== "object") {
                throw new Error("Frame missing joints.");
            }

        }
    }

    getMotion() {
        return this.motion;
    }

    getFrame(index) {

        if (!this.motion) {
            return null;
        }

        return this.motion.frames[index];
    }

    getFrameCount() {

        if (!this.motion) {
            return 0;
        }

        return this.motion.frame_count;
    }

    getFPS() {

        if (!this.motion) {
            return 30;
        }

        return this.motion.fps;
    }

    selectMotionVariant(clip, identifier = null) {

        if (!clip) {
            return null;
        }

        const variants = clip.motionVariants ?? [];

        if (variants.length === 0) {
            return null;
        }

        const target = normalizeLookupValue(identifier);

        if (target) {
            const byVideoId = variants.find((variant) => normalizeLookupValue(variant.videoId) === target);

            if (byVideoId) {
                return byVideoId;
            }

            const byMotionPath = variants.find((variant) => normalizeLookupValue(variant.motionPath) === target);

            if (byMotionPath) {
                return byMotionPath;
            }
        }

        const readyVariant = variants.find((variant) => variant.status === "ready" && variant.motionPath);

        if (readyVariant) {
            return readyVariant;
        }

        const primaryMotionPath = normalizeLookupValue(clip.primaryMotionPath ?? clip.motionPath);

        if (primaryMotionPath) {
            const primaryVariant = variants.find((variant) => normalizeLookupValue(variant.motionPath) === primaryMotionPath);

            if (primaryVariant) {
                return primaryVariant;
            }
        }

        return variants.find((variant) => variant.motionPath) ?? null;

    }

}
