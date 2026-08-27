import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export const BACKGROUND_THEMES = [
    {
        id: "midnight",
        label: "Midnight",
        color: 0x17283a,
        fog: 0x17283a,
        floor: 0x24364a,
        swatch: "#17283a",
        top: "#1c3550",
        bottom: "#0d1726",
        glow: "#7da9d6",
        style: "grid"
    },
    {
        id: "aurora",
        label: "Aurora",
        color: 0x173b43,
        fog: 0x173b43,
        floor: 0x22545a,
        swatch: "#1b5961",
        top: "#1f6469",
        bottom: "#0b292f",
        glow: "#79ead4",
        style: "aurora"
    },
    {
        id: "sunset",
        label: "Sunset",
        color: 0x412b3b,
        fog: 0x412b3b,
        floor: 0x5b3b4c,
        swatch: "#8f5261",
        top: "#8f5261",
        bottom: "#241a2d",
        glow: "#ffd19e",
        style: "spotlight"
    },
    {
        id: "studio",
        label: "Studio",
        color: 0x302c42,
        fog: 0x302c42,
        floor: 0x4a435c,
        swatch: "#645881",
        top: "#5b507f",
        bottom: "#211e35",
        glow: "#d0b8ff",
        style: "stars"
    },
    {
        id: "paper",
        label: "Paper",
        color: 0xdce8f1,
        fog: 0xdce8f1,
        floor: 0xb7c9d7,
        swatch: "#dce8f1",
        top: "#f3f8fb",
        bottom: "#b4c9d8",
        glow: "#ffffff",
        style: "paper"
    }
];

export default class SceneManager {

    constructor(renderer) {

        this.scene = new THREE.Scene();
        // A slightly lifted blue-grey background keeps dark sleeves and skin
        // tones readable without washing out the avatar silhouette.
        this.scene.background = new THREE.Color(0x17283a);
        // Room themes must never tint the avatar. Fog is intentionally off so
        // changing the room cannot blend a theme colour into avatar materials.
        this.scene.fog = null;

        this.views = {
            front: {
                position: new THREE.Vector3(0, 1.28, 3.35),
                target: new THREE.Vector3(0, 1.02, 0)
            },
            threeQuarter: {
                position: new THREE.Vector3(1.25, 1.32, 3.15),
                target: new THREE.Vector3(0, 1.02, 0)
            },
            profile: {
                position: new THREE.Vector3(3.2, 1.28, 0.5),
                target: new THREE.Vector3(0, 1.02, 0)
            }
        };
        this.activeView = "threeQuarter";
        this.viewTransition = null;
        this.zoomDistance = this.views.threeQuarter.position.distanceTo(this.views.threeQuarter.target);
        this.userZoomed = false;
        this.backgroundTheme = "midnight";
        this.autoRotate = false;
        this.backdropCanvas = document.createElement("canvas");
        this.backdropCanvas.width = 1024;
        this.backdropCanvas.height = 720;
        this.backdropTexture = new THREE.CanvasTexture(this.backdropCanvas);
        this.backdropTexture.colorSpace = THREE.SRGBColorSpace;
        this.backdrop = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this.backdropTexture,
            depthTest: true,
            depthWrite: true,
            toneMapped: false
        }));
        this.backdrop.position.set(0, 1.35, -5);
        this.backdrop.scale.set(24, 18, 1);
        this.backdrop.renderOrder = -1000;
        this.scene.add(this.backdrop);

        this.camera = new THREE.PerspectiveCamera(
            32,
            1,
            0.1,
            100
        );

        this.camera.position.copy(this.views.threeQuarter.position);

        renderer.setScene(this.scene);
        renderer.setCamera(this.camera);

        this.controls = new OrbitControls(
            this.camera,
            renderer.renderer.domElement
        );

        this.controls.target.copy(this.views.threeQuarter.target);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 1.7;
        this.controls.maxDistance = 5.8;
        this.controls.minPolarAngle = Math.PI * 0.28;
        this.controls.maxPolarAngle = Math.PI * 0.62;
        this.controls.autoRotateSpeed = 0.65;
        this.controls.update();

        this.addLights();
        this.setBackgroundTheme(this.backgroundTheme);
        this.addHelpers();
    }

    addLights() {

        const hemi = new THREE.HemisphereLight(
            0xaed6ff,
            0x172638,
            2.55
        );

        this.scene.add(hemi);

        const dir = new THREE.DirectionalLight(
            0xffd6bd,
            2.8
        );

        dir.position.set(3, 5, 4);
        dir.castShadow = true;
        dir.shadow.mapSize.set(1024, 1024);
        dir.shadow.camera.near = 0.5;
        dir.shadow.camera.far = 12;

        this.scene.add(dir);

        const rim = new THREE.DirectionalLight(0x8ab8ff, 2.55);
        rim.position.set(-4, 3, -2);
        this.scene.add(rim);

        const cameraFill = new THREE.PointLight(0xf1f6ff, 1.35, 7, 2);
        cameraFill.position.set(0, 2.35, 3.4);
        this.scene.add(cameraFill);

        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(5, 64),
            new THREE.MeshStandardMaterial({
                color: 0x24364a,
                roughness: 0.92,
                metalness: 0.04,
                transparent: true,
                opacity: 0.68
            })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.015;
        floor.receiveShadow = true;
        this.floor = floor;
        this.scene.add(floor);
    }

    addHelpers() {
        // Debug helpers stay out of the production avatar stage.
    }

    setView(viewName) {
        const view = this.views[viewName];

        if (!view) {
            return this.activeView;
        }

        this.activeView = viewName;
        const viewDistance = view.position.distanceTo(view.target);
        const targetDistance = this.userZoomed
            ? clamp(this.zoomDistance, this.controls.minDistance, this.controls.maxDistance)
            : viewDistance;
        const viewDirection = view.position.clone().sub(view.target).normalize();
        this.viewTransition = {
            startedAt: performance.now(),
            duration: 420,
            fromPosition: this.camera.position.clone(),
            fromTarget: this.controls.target.clone(),
            toPosition: view.target.clone().add(viewDirection.multiplyScalar(targetDistance)),
            toTarget: view.target.clone()
        };
        this.zoomDistance = targetDistance;

        return this.activeView;
    }

    setZoom(distance) {
        const nextDistance = clamp(
            Number(distance),
            this.controls.minDistance,
            this.controls.maxDistance
        );

        if (!Number.isFinite(nextDistance)) {
            return this.zoomDistance;
        }

        const transitionTarget = this.viewTransition?.toTarget?.clone();
        const transitionDirection = this.viewTransition
            ? this.viewTransition.toPosition.clone().sub(transitionTarget)
            : null;

        if (this.viewTransition && transitionDirection?.lengthSq() > 1e-8) {
            this.viewTransition.toPosition.copy(
                transitionTarget.add(transitionDirection.normalize().multiplyScalar(nextDistance))
            );
            this.zoomDistance = nextDistance;
            this.userZoomed = true;
            return this.zoomDistance;
        }

        this.viewTransition = null;
        const direction = this.camera.position.clone().sub(this.controls.target);
        if (direction.lengthSq() < 1e-8) {
            direction.set(0, 0, 1);
        }

        this.camera.position.copy(
            this.controls.target.clone().add(direction.normalize().multiplyScalar(nextDistance))
        );
        this.zoomDistance = nextDistance;
        this.userZoomed = true;
        this.controls.update();
        return this.zoomDistance;
    }

    getZoom() {
        return this.zoomDistance;
    }

    setBackgroundTheme(themeId) {
        const theme = BACKGROUND_THEMES.find((candidate) => candidate.id === themeId)
            ?? BACKGROUND_THEMES[0];

        this.backgroundTheme = theme.id;
        this.scene.background.setHex(theme.color);
        this.floor?.material?.color.setHex(theme.floor);
        this.drawBackdrop(theme);
        return this.backgroundTheme;
    }

    drawBackdrop(theme) {
        const context = this.backdropCanvas?.getContext("2d");
        if (!context) return;

        const width = this.backdropCanvas.width;
        const height = this.backdropCanvas.height;
        const gradient = context.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, theme.top);
        gradient.addColorStop(1, theme.bottom);
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);

        const glow = context.createRadialGradient(width * 0.52, height * 0.2, 10, width * 0.52, height * 0.2, width * 0.58);
        glow.addColorStop(0, `${theme.glow}aa`);
        glow.addColorStop(1, `${theme.glow}00`);
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);

        if (theme.style === "grid") {
            context.strokeStyle = "rgba(205, 229, 255, .1)";
            context.lineWidth = 2;
            for (let x = 0; x < width; x += 64) {
                context.beginPath();
                context.moveTo(x, 0);
                context.lineTo(x, height);
                context.stroke();
            }
            for (let y = 0; y < height; y += 64) {
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(width, y);
                context.stroke();
            }
        } else if (theme.style === "aurora") {
            context.save();
            context.globalAlpha = 0.2;
            context.filter = "blur(24px)";
            for (let index = 0; index < 4; index += 1) {
                context.fillStyle = theme.glow;
                context.beginPath();
                context.ellipse(width * (0.18 + index * 0.23), height * (0.32 + (index % 2) * 0.2), 120, 260, index * 0.4, 0, Math.PI * 2);
                context.fill();
            }
            context.restore();
        } else if (theme.style === "stars") {
            context.fillStyle = "rgba(255, 255, 255, .34)";
            for (let index = 0; index < 60; index += 1) {
                const x = (index * 173) % width;
                const y = (index * 97) % (height * 0.72);
                const radius = index % 4 === 0 ? 3 : 1.5;
                context.beginPath();
                context.arc(x, y, radius, 0, Math.PI * 2);
                context.fill();
            }
        } else if (theme.style === "paper") {
            context.strokeStyle = "rgba(49, 83, 105, .1)";
            context.lineWidth = 1;
            for (let y = 40; y < height; y += 34) {
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(width, y);
                context.stroke();
            }
        } else {
            context.fillStyle = "rgba(255, 216, 180, .12)";
            context.beginPath();
            context.arc(width * 0.5, height * 0.3, 170, 0, Math.PI * 2);
            context.fill();
        }

        this.backdropTexture.needsUpdate = true;
    }

    getBackgroundTheme() {
        return this.backgroundTheme;
    }

    setAutoRotate(enabled) {
        this.autoRotate = Boolean(enabled);
        this.controls.autoRotate = this.autoRotate;
        return this.autoRotate;
    }

    getAutoRotate() {
        return this.autoRotate;
    }

    update() {
        if (this.viewTransition) {
            const elapsed = performance.now() - this.viewTransition.startedAt;
            const progress = Math.min(1, elapsed / this.viewTransition.duration);
            const eased = progress * progress * (3 - 2 * progress);

            this.camera.position.lerpVectors(
                this.viewTransition.fromPosition,
                this.viewTransition.toPosition,
                eased
            );
            this.controls.target.lerpVectors(
                this.viewTransition.fromTarget,
                this.viewTransition.toTarget,
                eased
            );

            if (progress >= 1) {
                this.viewTransition = null;
            }
        }

        this.controls.update();
    }

    getActiveView() {
        return this.activeView;
    }

    dispose() {

        this.controls.dispose();
        this.scene.remove(this.backdrop);
        this.backdropTexture.dispose();
        this.backdrop.material.dispose();
        this.backdropCanvas = null;

    }
}
