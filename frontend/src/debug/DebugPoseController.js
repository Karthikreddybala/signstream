export default class DebugPoseController {

    constructor(boneMapper) {
        this.boneMapper = boneMapper;
    }

    rotateLeftArm() {

        const arm =
            this.boneMapper.getBone("LEFT_SHOULDER");

        if (!arm) return;

        arm.rotation.z = Math.PI / 4;
    }
}