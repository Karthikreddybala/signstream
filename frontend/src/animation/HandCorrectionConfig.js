export const HAND_CORRECTION_CONFIG = {
    enabled: true,
    restDetection: {
        velocityThreshold: 0.03,
        poseThreshold: 0.08,
        blendIn: 0.18,
        blendOut: 0.28,
        // Tracked signing frames are never relaxed by default. Enabling this
        // is an explicit product choice for clips that carry trusted idle
        // annotations.
        allowTrackedIdleCorrection: false
    },
    relaxedPose: {
        // Keep authored signing motion intact. Relaxation is only used after
        // the rest detector confirms the avatar is idle.
        wristBlend: 0.32,
        curlDegrees: {
            THUMB_METACARPAL: 8,
            THUMB_PROXIMAL: 12,
            THUMB_DISTAL: 8,
            INDEX_PROXIMAL: 13,
            INDEX_INTERMEDIATE: 20,
            INDEX_DISTAL: 12,
            MIDDLE_PROXIMAL: 16,
            MIDDLE_INTERMEDIATE: 24,
            MIDDLE_DISTAL: 14,
            RING_PROXIMAL: 20,
            RING_INTERMEDIATE: 29,
            RING_DISTAL: 17,
            LITTLE_PROXIMAL: 24,
            LITTLE_INTERMEDIATE: 34,
            LITTLE_DISTAL: 20
        }
    },
    fingerLimits: {
        thumb: { bend: 2.35, spread: 0.75, twist: 0.65 },
        proximal: { bend: 2.75, spread: 0.65, twist: 0.55 },
        intermediate: { bend: 2.45, spread: 0.4, twist: 0.35 },
        distal: { bend: 2.15, spread: 0.3, twist: 0.3 }
    },
    collision: {
        enabled: true,
        margin: 0.025,
        // Collision cleanup must never rewrite an active sign.
        minimumRestWeight: 0.72,
        maxHandCorrection: 0.08,
        maxForearmCorrection: 0.05,
        blend: 0.16
    }
};

export default HAND_CORRECTION_CONFIG;
