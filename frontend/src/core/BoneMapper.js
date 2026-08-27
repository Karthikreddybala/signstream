import { VRMHumanBoneName } from "@pixiv/three-vrm";

export default class BoneMapper {

    constructor(vrm) {

        this.vrm = vrm;

        this.bones = new Map();

        this.mapping = {

            PELVIS: VRMHumanBoneName.Hips,

            SPINE1: VRMHumanBoneName.Spine,
            SPINE2: VRMHumanBoneName.Chest,
            SPINE3: VRMHumanBoneName.UpperChest,

            NECK: VRMHumanBoneName.Neck,
            HEAD: VRMHumanBoneName.Head,

            LEFT_COLLAR: VRMHumanBoneName.LeftShoulder,
            RIGHT_COLLAR: VRMHumanBoneName.RightShoulder,

            LEFT_SHOULDER: VRMHumanBoneName.LeftUpperArm,
            RIGHT_SHOULDER: VRMHumanBoneName.RightUpperArm,

            LEFT_ELBOW: VRMHumanBoneName.LeftLowerArm,
            RIGHT_ELBOW: VRMHumanBoneName.RightLowerArm,

            LEFT_WRIST: VRMHumanBoneName.LeftHand,
            RIGHT_WRIST: VRMHumanBoneName.RightHand,

            LEFT_HIP: VRMHumanBoneName.LeftUpperLeg,
            RIGHT_HIP: VRMHumanBoneName.RightUpperLeg,

            LEFT_KNEE: VRMHumanBoneName.LeftLowerLeg,
            RIGHT_KNEE: VRMHumanBoneName.RightLowerLeg,

            LEFT_ANKLE: VRMHumanBoneName.LeftFoot,
            RIGHT_ANKLE: VRMHumanBoneName.RightFoot,

            LEFT_FOOT: VRMHumanBoneName.LeftToes,
            RIGHT_FOOT: VRMHumanBoneName.RightToes,

            LEFT_THUMB_METACARPAL: VRMHumanBoneName.LeftThumbMetacarpal,
            LEFT_THUMB_PROXIMAL: VRMHumanBoneName.LeftThumbProximal,
            LEFT_THUMB_DISTAL: VRMHumanBoneName.LeftThumbDistal,
            LEFT_INDEX_PROXIMAL: VRMHumanBoneName.LeftIndexProximal,
            LEFT_INDEX_INTERMEDIATE: VRMHumanBoneName.LeftIndexIntermediate,
            LEFT_INDEX_DISTAL: VRMHumanBoneName.LeftIndexDistal,
            LEFT_MIDDLE_PROXIMAL: VRMHumanBoneName.LeftMiddleProximal,
            LEFT_MIDDLE_INTERMEDIATE: VRMHumanBoneName.LeftMiddleIntermediate,
            LEFT_MIDDLE_DISTAL: VRMHumanBoneName.LeftMiddleDistal,
            LEFT_RING_PROXIMAL: VRMHumanBoneName.LeftRingProximal,
            LEFT_RING_INTERMEDIATE: VRMHumanBoneName.LeftRingIntermediate,
            LEFT_RING_DISTAL: VRMHumanBoneName.LeftRingDistal,
            LEFT_LITTLE_PROXIMAL: VRMHumanBoneName.LeftLittleProximal,
            LEFT_LITTLE_INTERMEDIATE: VRMHumanBoneName.LeftLittleIntermediate,
            LEFT_LITTLE_DISTAL: VRMHumanBoneName.LeftLittleDistal,

            RIGHT_THUMB_METACARPAL: VRMHumanBoneName.RightThumbMetacarpal,
            RIGHT_THUMB_PROXIMAL: VRMHumanBoneName.RightThumbProximal,
            RIGHT_THUMB_DISTAL: VRMHumanBoneName.RightThumbDistal,
            RIGHT_INDEX_PROXIMAL: VRMHumanBoneName.RightIndexProximal,
            RIGHT_INDEX_INTERMEDIATE: VRMHumanBoneName.RightIndexIntermediate,
            RIGHT_INDEX_DISTAL: VRMHumanBoneName.RightIndexDistal,
            RIGHT_MIDDLE_PROXIMAL: VRMHumanBoneName.RightMiddleProximal,
            RIGHT_MIDDLE_INTERMEDIATE: VRMHumanBoneName.RightMiddleIntermediate,
            RIGHT_MIDDLE_DISTAL: VRMHumanBoneName.RightMiddleDistal,
            RIGHT_RING_PROXIMAL: VRMHumanBoneName.RightRingProximal,
            RIGHT_RING_INTERMEDIATE: VRMHumanBoneName.RightRingIntermediate,
            RIGHT_RING_DISTAL: VRMHumanBoneName.RightRingDistal,
            RIGHT_LITTLE_PROXIMAL: VRMHumanBoneName.RightLittleProximal,
            RIGHT_LITTLE_INTERMEDIATE: VRMHumanBoneName.RightLittleIntermediate,
            RIGHT_LITTLE_DISTAL: VRMHumanBoneName.RightLittleDistal

        };

        this.build();
    }

    build() {

        const humanoid = this.vrm.humanoid;

        console.log("========== Bone Mapping ==========");

        for (const [jointName, vrmBoneName] of Object.entries(this.mapping)) {

            const node = humanoid.getNormalizedBoneNode(vrmBoneName);

            if (!node) {

                console.warn(
                    `Missing bone: ${jointName} -> ${vrmBoneName}`
                );

                continue;
            }

            this.bones.set(jointName, node);

            console.log({
                joint: jointName,
                vrmBone: vrmBoneName,
                position: node.position.toArray(),
                quaternion: node.quaternion.toArray()
            });
        }

        console.log(
            `Mapped ${this.bones.size} bones.`
        );
    }

    getBone(jointName) {

        return this.bones.get(jointName);

    }

    hasBone(jointName) {

        return this.bones.has(jointName);

    }

    getAllBones() {

        return this.bones;

    }

}
