import * as THREE from "three";

export default class AnimationLoop {

    constructor(renderer, avatarLoader, motionPlayer, sceneManager) {

        this.renderer = renderer;
        this.avatarLoader = avatarLoader;
        this.motionPlayer = motionPlayer;
        this.sceneManager = sceneManager;

        this.clock = new THREE.Clock();

        this.running = false;

        this.animate = this.animate.bind(this);
    }

    start() {

        if (this.running) return;

        this.running = true;

        this.clock.start();

        requestAnimationFrame(this.animate);
    }

    stop() {

        this.running = false;

    }

    animate() {

        if (!this.running)
            return;

        const deltaTime = this.clock.getDelta();

        this.motionPlayer.update(deltaTime);

        this.avatarLoader.update(deltaTime);
        this.sceneManager?.update(deltaTime);

        this.renderer.render();

        requestAnimationFrame(this.animate);

    }

}
