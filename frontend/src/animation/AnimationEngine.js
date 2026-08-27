import Renderer from "../rendering/renderer";
import SceneManager from "../rendering/SceneManager";

import AvatarLoader from "../core/AvatarLoader";
import BoneMapper from "../core/BoneMapper";
import MotionLoader from "../core/MotionLoader";
import PoseApplier from "./PoseApplier";
import MotionPlayer from "./motionPlayer";
import AnimationLoop from "./animationLoop";
import LandmarkSkeletonOverlay from "../debug/LandmarkSkeletonOverlay";
import { Vector3 } from "three";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export default class AnimationEngine {

    constructor(container, setStatus = () => {}, options = {}) {

        const normalizedOptions = typeof options === "string"
            ? { motionPath: options }
            : options;

        this.container = container;
        this.setStatus = setStatus;
        this.motionPath = normalizedOptions.motionPath ?? "/motion/frame_0000.json";
        this.manifestPath = normalizedOptions.manifestPath ?? "/motion/manifest.json";
        this.defaultGloss = normalizedOptions.defaultGloss ?? null;
        this.playbackRate = Number.isFinite(Number(normalizedOptions.playbackRate))
            ? Number(normalizedOptions.playbackRate)
            : 1;
        this.avatarPath = normalizedOptions.avatarPath ?? "/avatar.vrm";
        this.currentAvatarPath = this.avatarPath;
        this.avatarSwitching = false;
        this.handCorrection = normalizedOptions.handCorrection;
        this.currentGloss = null;
        this.availableGlosses = [];
        this.sequence = [];
        this.sequenceIndex = -1;
        this.sequenceLoop = true;
        this.sequenceToken = 0;
        this.sequenceLoading = false;
        this.sequencePlaying = false;
        this.sequenceListener = null;
        this.sessionRecording = null;
        this.avatarPosition = new Vector3();

        this.controls = {
            play: () => {},
            pause: () => {},
            restart: () => {},
            setCameraView: () => {},
            getCameraView: () => "threeQuarter",
            setCameraZoom: () => 0,
            getCameraZoom: () => 0,
            setAvatar: async () => null,
            getAvatarPath: () => this.currentAvatarPath,
            setBackgroundTheme: () => "midnight",
            getBackgroundTheme: () => "midnight",
            setAutoRotate: () => false,
            getAutoRotate: () => false,
            setAvatarPosition: () => this.avatarPosition.clone(),
            getAvatarPosition: () => this.avatarPosition.clone(),
            resetAvatarPosition: () => this.avatarPosition.clone(),
            loadGloss: async () => {},
            playSequence: async () => [],
            appendSequence: async () => [],
            stopSequence: () => {},
            setSequenceListener: () => {},
            startRecording: () => false,
            stopRecording: async () => null
        };

    }

    async start() {

        try {

            this.setStatus("Creating renderer...");

            this.renderer = new Renderer(this.container);

            this.sceneManager = new SceneManager(this.renderer);
            this.landmarkOverlay = new LandmarkSkeletonOverlay(
                this.sceneManager.scene
            );

            this.setStatus("Loading avatar...");

            this.avatarLoader = new AvatarLoader();

            const vrm = await this.avatarLoader.load(this.avatarPath);

            console.log("VRM Loaded:", vrm);

            this.sceneManager.scene.add(vrm.scene);
            this.avatarPosition.copy(vrm.scene.position);
            this.currentAvatarPath = this.avatarPath;
            console.log("Avatar added to scene.");

            this.setStatus("Loading motion manifest...");

            this.motionLoader = new MotionLoader();

            try {
                await this.motionLoader.loadManifest(this.manifestPath);
            } catch (error) {
                console.warn(error);
                this.motionLoader.manifest = {
                    clips: [],
                    defaultMotionPath: this.motionPath
                };
            }

            this.availableGlosses = this.motionLoader.getAvailableGlosses();

            const initialGloss = this.defaultGloss
                ?? this.availableGlosses[0]
                ?? null;

            if (initialGloss) {
                this.setStatus(`Loading motion for ${initialGloss}...`);
                await this.motionLoader.loadGloss(initialGloss, {
                    previewIdleFallback: true
                });
                this.currentGloss = initialGloss;
            } else {
                this.setStatus("Loading default motion...");
                await this.motionLoader.load(this.motionPath, {
                    previewIdleFallback: true
                });
            }

            this.setStatus("Building bone map...");

            this.boneMapper = new BoneMapper(vrm);
            this.alignLandmarkOverlay();
            this.poseApplier = new PoseApplier(this.boneMapper, {
                handCorrection: this.handCorrection
            });
            this.motionPlayer = new MotionPlayer(
                this.motionLoader,
                this.poseApplier
            );
            this.motionPlayer.setSpeed(this.playbackRate);
            this.motionPlayer.setLoop(true);
            this.motionPlayer.setFrameListener((frame, frameIndex) => {
                this.landmarkOverlay?.updateFrame(frameIndex);
            });
            this.motionPlayer.setEndListener(() => {
                void this.advanceSequence();
            });

            this.animationLoop = new AnimationLoop(
                this.renderer,
                this.avatarLoader,
                this.motionPlayer,
                this.sceneManager
            );

            this.controls = {
                play: () => this.motionPlayer?.play(),
                pause: () => this.motionPlayer?.pause(),
                restart: () => {

                    if (!this.motionPlayer) return;

                    if (this.sequence.length > 0) {
                        void this.playGlossSequence(this.sequence, {
                            loop: this.sequenceLoop
                        });
                        return;
                    }

                    this.motionPlayer.stop();
                    this.motionPlayer.play();
                    this.landmarkOverlay?.updateFrame(0);

                },
                setSpeed: (speed) => {
                    this.playbackRate = this.motionPlayer?.setSpeed(speed) ?? this.playbackRate;
                    return this.playbackRate;
                },
                getSpeed: () => this.motionPlayer?.getSpeed() ?? this.playbackRate,
                setCameraView: (viewName) => this.sceneManager?.setView(viewName),
                getCameraView: () => this.sceneManager?.getActiveView() ?? "threeQuarter",
                setCameraZoom: (distance) => this.sceneManager?.setZoom(distance) ?? 0,
                getCameraZoom: () => this.sceneManager?.getZoom() ?? 0,
                setAvatar: (avatarPath) => this.setAvatar(avatarPath),
                getAvatarPath: () => this.currentAvatarPath,
                setBackgroundTheme: (themeId) => this.sceneManager?.setBackgroundTheme(themeId) ?? "midnight",
                getBackgroundTheme: () => this.sceneManager?.getBackgroundTheme() ?? "midnight",
                setAutoRotate: (enabled) => this.sceneManager?.setAutoRotate(enabled) ?? false,
                getAutoRotate: () => this.sceneManager?.getAutoRotate() ?? false,
                setAvatarPosition: (position = {}) => {
                    const avatarScene = this.avatarLoader?.getVRM()?.scene;
                    if (!avatarScene) {
                        return this.avatarPosition.clone();
                    }

                    const nextPosition = {
                        x: clamp(Number(position.x ?? this.avatarPosition.x), -0.7, 0.7),
                        y: clamp(Number(position.y ?? this.avatarPosition.y), -0.35, 0.45),
                        z: clamp(Number(position.z ?? this.avatarPosition.z), -0.45, 0.45)
                    };

                    if (!Object.values(nextPosition).every(Number.isFinite)) {
                        return this.avatarPosition.clone();
                    }

                    avatarScene.position.set(
                        nextPosition.x,
                        nextPosition.y,
                        nextPosition.z
                    );
                    this.avatarPosition.set(
                        nextPosition.x,
                        nextPosition.y,
                        nextPosition.z
                    );
                    this.alignLandmarkOverlay();
                    return this.avatarPosition.clone();
                },
                getAvatarPosition: () => this.avatarPosition.clone(),
                resetAvatarPosition: () => {
                    const avatarScene = this.avatarLoader?.getVRM()?.scene;
                    avatarScene?.position.set(0, 0, 0);
                    this.avatarPosition.set(0, 0, 0);
                    this.alignLandmarkOverlay();
                    return this.avatarPosition.clone();
                },
                setHandCorrectionEnabled: (enabled) => {
                    this.poseApplier?.setHandCorrectionEnabled(enabled);
                },
                getHandCorrectionDebug: () => this.poseApplier?.getHandCorrectionDebug() ?? null,
                loadGloss: async (gloss) => {
                    return this.loadGloss(gloss);
                },
                playSequence: (glosses, options) => this.playGlossSequence(glosses, options),
                appendSequence: (glosses) => this.appendGlossSequence(glosses),
                stopSequence: () => this.cancelSequence(),
                setSequenceListener: (listener) => {
                    this.sequenceListener = typeof listener === "function" ? listener : null;
                    this.notifySequence();
                },
                startRecording: (audioStream, options) => this.startSessionRecording(audioStream, options),
                stopRecording: () => this.stopSessionRecording()
            };

            await this.syncLandmarkOverlay(this.motionLoader.getMotion());

            this.motionPlayer.play();
            this.animationLoop.start();

            const activeMotion = this.motionLoader.getMotion();
            const motionName = this.currentGloss
                ?? activeMotion?.name
                ?? "motion";
            const frameCount = activeMotion?.frame_count ?? 0;
            const previewSuffix = activeMotion?.isPreview ? " (preview)" : "";

            console.log("Bone Mapper Ready");

            this.setStatus(
                `Loaded ${motionName} (${frameCount} frames${previewSuffix})`
            );

            return true;

        }
        catch (error) {

            console.error(error);

            this.setStatus("Error");

            return false;

        }

    }

    async loadGloss(gloss, options = {}) {

        if (!this.motionLoader) {
            throw new Error("MotionLoader is not ready.");
        }

        if (!gloss) {
            return null;
        }

        if (!options.preserveSequence) {
            this.cancelSequence({ notify: false });
        }

        try {

            const wasPlaying = this.motionPlayer?.playing ?? true;

            this.setStatus(`Loading motion for ${gloss}...`);

            const motion = await this.motionLoader.loadGloss(gloss, {
                previewIdleFallback: true
            });

            this.currentGloss = motion.gloss ?? gloss;
            await this.syncLandmarkOverlay(motion);

            if (this.motionPlayer) {
                this.motionPlayer.stop();

                const shouldResume = options.autoplay ?? wasPlaying;

                if (shouldResume) {
                    this.motionPlayer.play();
                }
            }

            this.landmarkOverlay?.updateFrame(0);

            const previewSuffix = motion.isPreview ? " (preview)" : "";

            this.setStatus(
                `Loaded ${motion.name} (${motion.frame_count} frames${previewSuffix})`
            );

            return motion;

        }
        catch (error) {

            console.error(error);
            this.setStatus(`Failed to load ${gloss}`);
            this.landmarkOverlay?.clear();

            return null;

        }

    }

    async playGlossSequence(glosses, options = {}) {

        const requestedSequence = Array.isArray(glosses)
            ? glosses.filter((gloss) => typeof gloss === "string" && gloss.trim())
            : [];
        const sequence = requestedSequence
            .map((gloss) => this.motionLoader?.findClip(gloss)?.gloss)
            .filter(Boolean);

        if (!this.motionPlayer || sequence.length === 0) {
            return [];
        }

        this.cancelSequence({ notify: false });
        this.sequence = sequence;
        this.sequenceIndex = 0;
        this.sequenceLoop = options.loop !== false;
        this.sequencePlaying = true;
        this.motionPlayer.setLoop(false);
        const token = this.sequenceToken;
        this.notifySequence();

        await this.loadGloss(sequence[0], {
            autoplay: true,
            preserveSequence: true
        });

        if (token !== this.sequenceToken) {
            return [];
        }

        return sequence;
    }

    async appendGlossSequence(glosses) {
        const requestedSequence = Array.isArray(glosses)
            ? glosses.filter((gloss) => typeof gloss === "string" && gloss.trim())
            : [];
        const sequence = requestedSequence
            .map((gloss) => this.motionLoader?.findClip(gloss)?.gloss)
            .filter(Boolean);

        if (!this.motionPlayer || sequence.length === 0) {
            return [];
        }

        if (!this.sequencePlaying || this.sequence.length === 0) {
            return this.playGlossSequence(sequence, { loop: false });
        }

        this.sequence = [...this.sequence, ...sequence];
        this.sequenceLoop = false;
        this.motionPlayer.setLoop(false);
        this.notifySequence();
        return sequence;
    }

    async advanceSequence() {

        if (
            !this.sequencePlaying
            || this.sequenceLoading
            || this.sequence.length === 0
        ) {
            return;
        }

        const token = this.sequenceToken;
        let nextIndex = this.sequenceIndex + 1;

        if (nextIndex >= this.sequence.length) {
            if (!this.sequenceLoop) {
                this.sequencePlaying = false;
                this.motionPlayer?.setLoop(false);
                this.notifySequence();
                return;
            }

            nextIndex = 0;
        }

        this.sequenceIndex = nextIndex;
        this.notifySequence();
        this.sequenceLoading = true;

        try {
            await this.loadGloss(this.sequence[nextIndex], {
                autoplay: true,
                preserveSequence: true
            });
        }
        finally {
            if (token === this.sequenceToken) {
                this.sequenceLoading = false;
            }
        }
    }

    cancelSequence({ notify = true } = {}) {

        this.sequenceToken += 1;
        this.sequence = [];
        this.sequenceIndex = -1;
        this.sequencePlaying = false;
        this.sequenceLoading = false;
        this.motionPlayer?.setLoop(true);

        if (notify) {
            this.notifySequence();
        }
    }

    notifySequence() {

        this.sequenceListener?.({
            gloss: this.sequence[this.sequenceIndex] ?? null,
            index: this.sequenceIndex,
            total: this.sequence.length,
            playing: this.sequencePlaying,
            loop: this.sequenceLoop
        });
    }

    async syncLandmarkOverlay(motion) {

        if (!this.landmarkOverlay) {
            return null;
        }

        try {
            return await this.landmarkOverlay.loadMotion(motion);
        }
        catch (error) {

            console.warn(error);
            this.landmarkOverlay.clear();
            return null;

        }

    }

    alignLandmarkOverlay() {

        const pelvis = this.boneMapper?.getBone("PELVIS");

        if (!pelvis || !this.landmarkOverlay) {
            return;
        }

        pelvis.updateWorldMatrix(true, false);

        this.landmarkOverlay.setRootPosition(
            pelvis.getWorldPosition(new Vector3())
        );

    }

    getAvailableGlosses() {

        return this.availableGlosses.length > 0
            ? this.availableGlosses
            : this.motionLoader?.getAvailableGlosses() ?? [];

    }

    getCurrentGloss() {

        return this.currentGloss;

    }

    async setAvatar(avatarPath) {
        const normalizedPath = typeof avatarPath === "string"
            ? avatarPath.trim()
            : "";

        if (
            !normalizedPath
            || normalizedPath === this.currentAvatarPath
            || !this.avatarLoader
            || !this.sceneManager
            || !this.motionPlayer
            || this.avatarSwitching
        ) {
            return this.currentAvatarPath;
        }

        const previousVRM = this.avatarLoader.getVRM();
        const wasPlaying = this.motionPlayer.playing;
        this.avatarSwitching = true;
        this.motionPlayer.pause();
        this.setStatus("Loading avatar...");

        try {
            const nextVRM = await this.avatarLoader.load(normalizedPath);
            nextVRM.scene.position.copy(this.avatarPosition);
            this.sceneManager.scene.remove(previousVRM?.scene);
            this.sceneManager.scene.add(nextVRM.scene);
            this.avatarLoader.disposeVRM(previousVRM);

            this.boneMapper = new BoneMapper(nextVRM);
            this.poseApplier = new PoseApplier(this.boneMapper, {
                handCorrection: this.handCorrection
            });
            this.motionPlayer.poseApplier = this.poseApplier;
            this.motionPlayer.stop();

            const firstFrame = this.motionLoader?.getFrame(0);
            if (firstFrame) {
                this.poseApplier.apply(firstFrame);
            }

            this.currentAvatarPath = normalizedPath;
            this.alignLandmarkOverlay();
            if (wasPlaying) {
                this.motionPlayer.play();
            }

            const avatarName = normalizedPath.split("/").pop()?.replace(/\.vrm$/i, "") || "avatar";
            this.setStatus(`Loaded ${avatarName}`);
            return this.currentAvatarPath;
        }
        catch (error) {
            console.error(error);
            this.setStatus("Avatar could not be loaded");
            throw error;
        }
        finally {
            this.avatarSwitching = false;
        }
    }

    async exportSequenceVideo(glosses, options = {}) {
        const canvas = this.renderer?.getCanvas?.();
        const sequence = Array.isArray(glosses)
            ? glosses.filter((gloss) => this.motionLoader?.findClip(gloss))
            : [];

        if (!canvas?.captureStream || !window.MediaRecorder) {
            throw new Error("This browser does not support WebM video export.");
        }

        if (sequence.length === 0) {
            throw new Error("There are no motion clips available to export.");
        }

        const mimeType = [
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm"
        ].find((candidate) => MediaRecorder.isTypeSupported?.(candidate));
        const stream = canvas.captureStream(Number(options.fps) || 30);
        const recorder = new MediaRecorder(
            stream,
            mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined
        );
        const chunks = [];
        const recording = new Promise((resolve, reject) => {
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunks.push(event.data);
            };
            recorder.onerror = () => reject(new Error("Video recording failed."));
            recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
        });

        try {
            recorder.start(250);
            await this.playGlossSequence(sequence, { loop: false });
            const deadline = performance.now() + (Number(options.timeoutMs) || 120_000);

            while (this.sequencePlaying && performance.now() < deadline) {
                await new Promise((resolve) => window.setTimeout(resolve, 50));
            }

            if (this.sequencePlaying) {
                throw new Error("Video export timed out before the motion sequence finished.");
            }

            await new Promise((resolve) => window.setTimeout(resolve, 150));
            recorder.stop();
            return await recording;
        } finally {
            stream.getTracks().forEach((track) => track.stop());
            if (recorder.state !== "inactive") {
                recorder.stop();
            }
        }
    }

    startSessionRecording(audioStream, options = {}) {
        const canvas = this.renderer?.getCanvas?.();
        if (!canvas?.captureStream || !window.MediaRecorder) {
            throw new Error("This browser does not support live session recording.");
        }

        if (this.sessionRecording && this.sessionRecording.recorder.state !== "inactive") {
            return true;
        }

        const canvasStream = canvas.captureStream(Number(options.fps) || 30);
        const canvasTracks = [...canvasStream.getVideoTracks()];
        const tracks = [...canvasTracks];
        if (audioStream?.getAudioTracks) {
            tracks.push(...audioStream.getAudioTracks().map((track) => track.clone?.() ?? track));
        }
        const stream = new MediaStream(tracks);
        const mimeType = [
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm"
        ].find((candidate) => MediaRecorder.isTypeSupported?.(candidate));
        const recorder = new MediaRecorder(
            stream,
            mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined
        );
        const chunks = [];
        const recording = new Promise((resolve, reject) => {
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunks.push(event.data);
            };
            recorder.onerror = () => reject(new Error("Live session recording failed."));
            recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
        });

        recorder.start(250);
        this.sessionRecording = { recorder, stream, recording, ownedTracks: tracks };
        return true;
    }

    async stopSessionRecording() {
        const session = this.sessionRecording;
        if (!session) {
            return null;
        }

        if (session.recorder.state !== "inactive") {
            session.recorder.stop();
        }

        try {
            return await session.recording;
        }
        finally {
            session.ownedTracks.forEach((track) => track.stop());
            this.sessionRecording = null;
        }
    }

    dispose() {

        if (this.animationLoop) {
            this.animationLoop.stop();
        }

        if (this.motionPlayer) {
            this.motionPlayer.setEndListener(null);
            this.motionPlayer.stop();
        }

        this.cancelSequence({ notify: false });

        if (this.sessionRecording && this.sessionRecording.recorder.state !== "inactive") {
            this.sessionRecording.recorder.stop();
        }
        this.sessionRecording?.ownedTracks?.forEach((track) => track.stop());
        this.sessionRecording = null;

        if (this.sceneManager) {
            this.sceneManager.dispose();
        }

        if (this.avatarLoader) {
            this.avatarLoader.dispose();
        }

        if (this.landmarkOverlay) {
            this.landmarkOverlay.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
        }

    }

    getControls() {

        return this.controls;

    }

}
