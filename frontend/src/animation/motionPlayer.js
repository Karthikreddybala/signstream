import { Quaternion } from "three";

export default class MotionPlayer {

    constructor(motionLoader, poseApplier) {

        this.motionLoader = motionLoader;
        this.poseApplier = poseApplier;

        this.currentFrame = 0;
        this.elapsedTime = 0;
        this.lastAppliedFrameIndex = -1;

        this.playing = false;
        this.loop = true;
        this.playbackRate = 1;
        this.onFrameApplied = null;
        this.onMotionEnd = null;
    }

    play() {
        this.playing = true;
    }

    pause() {
        this.playing = false;
    }

    stop() {

        this.playing = false;
        this.currentFrame = 0;
        this.elapsedTime = 0;
        this.lastAppliedFrameIndex = -1;

        this.poseApplier.reset();

    }

    setFrameListener(listener) {
        this.onFrameApplied = typeof listener === "function" ? listener : null;
    }

    setEndListener(listener) {
        this.onMotionEnd = typeof listener === "function" ? listener : null;
    }

    setLoop(enabled) {
        this.loop = enabled;
    }

    setSpeed(speed) {
        const numericSpeed = Number(speed);

        if (!Number.isFinite(numericSpeed)) {
            return this.playbackRate;
        }

        this.playbackRate = Math.min(3, Math.max(0.1, numericSpeed));
        return this.playbackRate;
    }

    getSpeed() {
        return this.playbackRate;
    }

    update(deltaTime) {

        if (!this.playing)
            return;

        const fps = this.motionLoader.getFPS();
        const frameCount = this.motionLoader.getFrameCount();

        if (!fps || fps <= 0 || frameCount <= 0)
            return;

        const frameDuration = 1 / fps;

        this.elapsedTime += deltaTime * this.playbackRate;

        let reachedEnd = false;

        while (this.elapsedTime >= frameDuration) {

            this.elapsedTime -= frameDuration;

            this.currentFrame++;

            if (this.currentFrame >= frameCount) {

                if (this.loop) {
                    this.currentFrame = 0;
                } else {
                    this.currentFrame = frameCount - 1;
                    this.playing = false;
                    reachedEnd = true;
                    break;
                }
            }
        }

        const frame = this.motionLoader.getFrame(this.currentFrame);
        const nextFrameIndex = this.currentFrame + 1 < frameCount
            ? this.currentFrame + 1
            : this.loop
                ? 0
                : this.currentFrame;
        const nextFrame = this.motionLoader.getFrame(nextFrameIndex);
        const alpha = Math.min(1, Math.max(0, this.elapsedTime / frameDuration));

        if (frame) {
            this.poseApplier.apply(
                this.interpolateFrames(frame, nextFrame ?? frame, alpha)
            );

            if (this.onFrameApplied && this.lastAppliedFrameIndex !== this.currentFrame) {
                this.onFrameApplied(frame, this.currentFrame);
            }

            this.lastAppliedFrameIndex = this.currentFrame;
        }

        if (reachedEnd) {
            this.poseApplier.apply(frame);
            this.onMotionEnd?.();
        }
    }

    interpolateFrames(firstFrame, secondFrame, alpha) {
        if (!firstFrame || !secondFrame || alpha <= 0) {
            return firstFrame;
        }

        if (alpha >= 1) {
            return secondFrame;
        }

        const joints = {};
        const jointNames = new Set([
            ...Object.keys(firstFrame.joints ?? {}),
            ...Object.keys(secondFrame.joints ?? {})
        ]);

        for (const jointName of jointNames) {
            const firstJoint = firstFrame.joints?.[jointName] ?? {};
            const secondJoint = secondFrame.joints?.[jointName] ?? firstJoint;
            const firstTracked = firstJoint.tracked !== false;
            const secondTracked = secondJoint.tracked !== false;
            const firstRotation = this.readRotation(firstJoint);
            const secondRotation = this.readRotation(secondJoint);
            const joint = {};

            // Never slerp a valid hand pose into an identity placeholder from
            // a dropped landmark frame. That creates a visible finger twitch
            // during tracking loss and is especially obvious on distal bones.
            if (firstRotation && secondRotation && firstTracked && secondTracked) {
                const firstQuaternion = new Quaternion(
                    firstRotation.x,
                    firstRotation.y,
                    firstRotation.z,
                    firstRotation.w
                ).normalize();
                const secondQuaternion = new Quaternion(
                    secondRotation.x,
                    secondRotation.y,
                    secondRotation.z,
                    secondRotation.w
                ).normalize();

                if (firstQuaternion.dot(secondQuaternion) < 0) {
                    secondQuaternion.set(
                        -secondQuaternion.x,
                        -secondQuaternion.y,
                        -secondQuaternion.z,
                        -secondQuaternion.w
                    );
                }

                firstQuaternion.slerp(secondQuaternion, alpha).normalize();
                joint.rotation = {
                    x: firstQuaternion.x,
                    y: firstQuaternion.y,
                    z: firstQuaternion.z,
                    w: firstQuaternion.w
                };
            } else if (firstTracked && firstRotation) {
                joint.rotation = firstRotation;
            } else if (secondTracked && secondRotation) {
                joint.rotation = secondRotation;
            }

            const firstPosition = firstJoint.position;
            const secondPosition = secondJoint.position ?? firstPosition;

            if (firstPosition && secondPosition) {
                joint.position = {
                    x: firstPosition.x + (secondPosition.x - firstPosition.x) * alpha,
                    y: firstPosition.y + (secondPosition.y - firstPosition.y) * alpha,
                    z: firstPosition.z + (secondPosition.z - firstPosition.z) * alpha
                };
            } else if (firstPosition) {
                joint.position = firstPosition;
            } else if (secondPosition) {
                joint.position = secondPosition;
            }

            if (firstJoint.locked === true || secondJoint.locked === true) {
                joint.locked = true;
            }

            joint.tracked = firstTracked || secondTracked;

            joints[jointName] = joint;
        }

        return { joints };
    }

    readRotation(joint) {
        const rotation = joint?.rotation;

        if (!rotation) {
            return null;
        }

        return {
            x: Number(rotation.x ?? 0),
            y: Number(rotation.y ?? 0),
            z: Number(rotation.z ?? 0),
            w: Number(rotation.w ?? 1)
        };
    }

    getLastAppliedFrameIndex() {
        return this.lastAppliedFrameIndex;
    }
}
