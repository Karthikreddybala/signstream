import * as THREE from "three";

export default class Renderer {

    constructor(container) {

        this.container = container;

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(1, 1, false);

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;

        this.container.appendChild(
            this.renderer.domElement
        );

        this.onResize = this.onResize.bind(this);
        this.animate = this.animate.bind(this);
        this.running = false;

        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(this.onResize);
            this.resizeObserver.observe(this.container);
        } else {
            window.addEventListener("resize", this.onResize);
        }

        this.onResize();
    }

    setScene(scene) {
        this.scene = scene;
    }

    setCamera(camera) {
        this.camera = camera;
        this.onResize();
    }

    getCanvas() {
        return this.renderer.domElement;
    }

    start() {

        if (this.running) return;

        this.running = true;

        this.animate();
    }

    stop() {

        this.running = false;

    }

    render() {

        if (!this.scene || !this.camera)
            return;

        this.renderer.render(
            this.scene,
            this.camera
        );

    }

    animate() {

        if (!this.running)
            return;

        requestAnimationFrame(this.animate);

        this.render();
    }

    onResize() {

        if (!this.camera || !this.container)
            return;

        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);

        this.camera.aspect = width / height;

        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    }

    dispose() {

        this.stop();
        this.resizeObserver?.disconnect();
        window.removeEventListener("resize", this.onResize);
        this.renderer.dispose();

    }

}
