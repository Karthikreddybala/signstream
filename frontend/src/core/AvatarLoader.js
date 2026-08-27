import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
    VRMLoaderPlugin,
    VRMUtils
} from "@pixiv/three-vrm";

export default class AvatarLoader {

    constructor() {

        this.loader = new GLTFLoader();

        this.loader.register(
            (parser) => new VRMLoaderPlugin(parser)
        );

        this.vrm = null;

    }

    async load(path) {

        return new Promise((resolve, reject) => {

            this.loader.load(

                path,

                (gltf) => {

                    const vrm = gltf.userData.vrm;

                    if (!vrm) {
                        reject(new Error("VRM avatar not found."));
                        return;
                    }

                    if (vrm.meta?.metaVersion === "0") {
                        VRMUtils.rotateVRM0(vrm);
                    }

                    // Place avatar on the ground
                    vrm.scene.position.set(0, 0, 0);

                    // Reset rotation
                    vrm.scene.rotation.set(0, 0, 0);

                    // Reset scale
                    vrm.scene.scale.set(1, 1, 1);


                    vrm.scene.traverse((obj) => {

                        if (obj.isMesh) {

                            obj.castShadow = true;
                            obj.receiveShadow = true;

                        }

                    });


                    this.vrm = vrm;

                    resolve(vrm);

                },

                undefined,

                reject

            );

        });

    }

    update(deltaTime) {

        if (!this.vrm) return;

        this.vrm.update(deltaTime);

    }

    getVRM() {

        return this.vrm;

    }

    disposeVRM(vrm) {
        if (!vrm) return;

        if (typeof VRMUtils.deepDispose === "function") {
            VRMUtils.deepDispose(vrm.scene);
        }
    }

    dispose() {

        if (!this.vrm) return;

        this.disposeVRM(this.vrm);
        this.vrm = null;

    }

}
