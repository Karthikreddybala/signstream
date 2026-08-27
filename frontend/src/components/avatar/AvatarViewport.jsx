import { useEffect, useRef, useState } from "react";
import {
    Camera,
    Maximize2,
    Minimize2,
    Palette,
    Pause,
    Play,
    RotateCcw,
    RotateCw,
    SlidersHorizontal
} from "lucide-react";
import AnimationEngine from "../../animation/AnimationEngine";
import { BACKGROUND_THEMES } from "../../rendering/SceneManager";
import { getStoredAvatarPath, loadAvatarCatalog, storeAvatarPath } from "../../services/avatarCatalog";

function getStoredBackgroundTheme() {
    try {
        const storedTheme = window.localStorage.getItem("signstream-avatar-background");
        return BACKGROUND_THEMES.some((theme) => theme.id === storedTheme)
            ? storedTheme
            : "midnight";
    } catch {
        return "midnight";
    }
}

function AvatarViewport({ selectedGloss, sequenceGlosses = [], sequenceLoop = true, streamSequence = false, onReady, onSequenceChange }) {
    const DEFAULT_ZOOM = 3.4;
    const containerRef = useRef(null);
    const fullscreenRef = useRef(null);
    const engineRef = useRef(null);
    const [status, setStatus] = useState("Preparing avatar");
    const [ready, setReady] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [cameraView, setCameraView] = useState("threeQuarter");
    const [zoom, setZoom] = useState(DEFAULT_ZOOM);
    const [avatarPosition, setAvatarPosition] = useState({ x: 0, y: 0, z: 0 });
    const [backgroundTheme, setBackgroundTheme] = useState(() => getStoredBackgroundTheme());
    const [backgroundMenuOpen, setBackgroundMenuOpen] = useState(false);
    const [autoRotate, setAutoRotate] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [avatarCatalog, setAvatarCatalog] = useState([]);
    const [selectedAvatarPath, setSelectedAvatarPath] = useState("");
    const [avatarSwitching, setAvatarSwitching] = useState(false);
    const [avatarError, setAvatarError] = useState("");
    const initialBackgroundRef = useRef(backgroundTheme);
    const initialAvatarPathRef = useRef(getStoredAvatarPath());
    const streamedSequenceRef = useRef([]);

    useEffect(() => {
        let mounted = true;
        let engine = null;

        async function start() {
            const catalog = await loadAvatarCatalog();
            if (!mounted) return;

            const preferredAvatar = catalog.find((avatar) => avatar.path === initialAvatarPathRef.current)
                ?? catalog[0];
            setAvatarCatalog(catalog);
            setSelectedAvatarPath(preferredAvatar?.path ?? "/avatar.vrm");

            engine = new AnimationEngine(containerRef.current, setStatus, {
                avatarPath: preferredAvatar?.path ?? "/avatar.vrm"
            });
            engineRef.current = engine;
            const started = await engine.start();
            if (!mounted) return;
            if (!started) {
                setReady(false);
                return;
            }
            const glosses = engine.getAvailableGlosses();
            const controls = engine.getControls();
            const initialZoom = Number(controls?.getCameraZoom?.());
            const initialPosition = controls?.getAvatarPosition?.();
            const initialAutoRotate = controls?.getAutoRotate?.();
            if (Number.isFinite(initialZoom) && initialZoom > 0) setZoom(initialZoom);
            controls?.setBackgroundTheme?.(initialBackgroundRef.current);
            if (typeof initialAutoRotate === "boolean") setAutoRotate(initialAutoRotate);
            if (initialPosition) {
                setAvatarPosition({
                    x: Number(initialPosition.x) || 0,
                    y: Number(initialPosition.y) || 0,
                    z: Number(initialPosition.z) || 0
                });
            }
            controls?.setSequenceListener?.(onSequenceChange);
            setReady(true);
            onReady?.({
                engine,
                glosses,
                exportVideo: (sequence) => engine.exportSequenceVideo(sequence),
                startRecording: (audioStream, options) => engine.startSessionRecording(audioStream, options),
                stopRecording: () => engine.stopSessionRecording(),
                setCameraView: (viewName) => engine.getControls()?.setCameraView?.(viewName),
                getCameraView: () => engine.getControls()?.getCameraView?.() ?? "threeQuarter",
                setCameraZoom: (distance) => engine.getControls()?.setCameraZoom?.(distance),
                setAvatarPosition: (position) => engine.getControls()?.setAvatarPosition?.(position),
                setBackgroundTheme: (themeId) => engine.getControls()?.setBackgroundTheme?.(themeId),
                setAutoRotate: (enabled) => engine.getControls()?.setAutoRotate?.(enabled),
                setAvatar: (avatarPath) => engine.getControls()?.setAvatar?.(avatarPath),
                toggleFullscreen
            });
        }

        void start();

        return () => {
            mounted = false;
            engine?.dispose();
            engineRef.current = null;
        };
    }, [onReady, onSequenceChange]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === fullscreenRef.current);
        };

        document.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
    }, []);

    useEffect(() => {
        if (!engineRef.current || !ready) return;

        const controls = engineRef.current.getControls();
        if (streamSequence) {
            const previous = streamedSequenceRef.current;
            const isReset = sequenceGlosses.length < previous.length
                || previous.some((gloss, index) => sequenceGlosses[index] !== gloss);

            if (isReset) {
                if (sequenceGlosses.length === 0) {
                    controls?.stopSequence?.();
                } else {
                    void controls?.playSequence?.(sequenceGlosses, { loop: false });
                }
            } else {
                const additions = sequenceGlosses.slice(previous.length);
                if (additions.length > 0) {
                    void controls?.appendSequence?.(additions);
                }
            }
            streamedSequenceRef.current = [...sequenceGlosses];
            return;
        }

        streamedSequenceRef.current = [];
        if (sequenceGlosses.length === 0) return;
        void controls?.playSequence?.(sequenceGlosses, { loop: sequenceLoop });
    }, [sequenceGlosses, sequenceLoop, streamSequence, ready]);

    useEffect(() => {
        if (!selectedGloss || sequenceGlosses.length > 0 || !engineRef.current) return;
        void engineRef.current.getControls()?.loadGloss(selectedGloss);
    }, [selectedGloss, sequenceGlosses.length, ready]);

    const runControl = (name) => {
        engineRef.current?.getControls()?.[name]?.();
    };

    const handleCameraView = (viewName) => {
        setCameraView(viewName);
        engineRef.current?.getControls()?.setCameraView?.(viewName);
    };

    const handleSpeed = (event) => {
        const value = Number(event.target.value);
        setSpeed(value);
        engineRef.current?.getControls()?.setSpeed?.(value);
    };

    const handleZoom = (event) => {
        const value = Number(event.target.value);
        setZoom(value);
        engineRef.current?.getControls()?.setCameraZoom?.(value);
    };

    const handleAvatarPosition = (axis, event) => {
        const value = Number(event.target.value);
        const nextPosition = { ...avatarPosition, [axis]: value };
        setAvatarPosition(nextPosition);
        engineRef.current?.getControls()?.setAvatarPosition?.(nextPosition);
    };

    const handleBackgroundTheme = (themeId) => {
        setBackgroundTheme(themeId);
        setBackgroundMenuOpen(false);
        engineRef.current?.getControls()?.setBackgroundTheme?.(themeId);
        try {
            window.localStorage.setItem("signstream-avatar-background", themeId);
        } catch {
            // Private browsing can deny storage; the in-memory selection remains active.
        }
    };

    const handleAutoRotate = () => {
        const nextValue = !autoRotate;
        setAutoRotate(nextValue);
        engineRef.current?.getControls()?.setAutoRotate?.(nextValue);
    };

    const handleAvatarChange = async (event) => {
        const nextPath = event.target.value;
        if (!nextPath || nextPath === selectedAvatarPath || avatarSwitching) return;

        const previousPath = selectedAvatarPath;
        setAvatarSwitching(true);
        setAvatarError("");

        try {
            const loadedPath = await engineRef.current?.getControls()?.setAvatar?.(nextPath);
            if (loadedPath && loadedPath !== previousPath) {
                setSelectedAvatarPath(loadedPath);
                storeAvatarPath(loadedPath);
            } else {
                setSelectedAvatarPath(previousPath);
            }
        } catch {
            setSelectedAvatarPath(previousPath);
            setAvatarError("This avatar could not be loaded. Choose another VRM file.");
        } finally {
            setAvatarSwitching(false);
        }
    };

    async function toggleFullscreen() {
        if (document.fullscreenElement) {
            await document.exitFullscreen?.();
            return;
        }

        if (fullscreenRef.current?.requestFullscreen) {
            try {
                await fullscreenRef.current.requestFullscreen();
            } catch {
                setIsFullscreen(true);
            }
            return;
        }

        setIsFullscreen((current) => !current);
    }

    const resetFraming = () => {
        const controls = engineRef.current?.getControls();
        controls?.setCameraView?.("threeQuarter");
        controls?.setCameraZoom?.(DEFAULT_ZOOM);
        controls?.resetAvatarPosition?.();
        setCameraView("threeQuarter");
        setZoom(DEFAULT_ZOOM);
        setAvatarPosition({ x: 0, y: 0, z: 0 });
        setAutoRotate(false);
        controls?.setAutoRotate?.(false);
    };

    return (
        <section ref={fullscreenRef} className={`avatar-panel panel-card ${isFullscreen ? "avatar-panel-fullscreen" : ""}`}>
            <div className="avatar-panel-header">
                <div>
                    <span className="eyebrow">Live avatar</span>
                    <h2>SignStream studio</h2>
                </div>
                <span className={`status-pill ${ready && !avatarSwitching ? "status-ready" : "status-loading"}`}>
                    <span className="status-dot" />
                    {avatarSwitching ? "Switching avatar" : ready ? "Ready" : status}
                </span>
            </div>
            <div className={`avatar-stage-wrap stage-theme-${backgroundTheme}`}>
                <div ref={containerRef} className="avatar-stage" />
                {!ready && (
                    <div className="avatar-loading">
                        <div className="loading-orb"><SparkleMark /></div>
                        <strong>Loading your avatar</strong>
                        <span>Preparing the motion studio…</span>
                    </div>
                )}
                {avatarSwitching && (
                    <div className="avatar-switching-overlay" aria-live="polite">
                        <div className="avatar-switching-orb"><RotateCw size={18} /></div>
                        <strong>Loading selected avatar</strong>
                        <span>Reconnecting the motion rig...</span>
                    </div>
                )}
                <div className="avatar-stage-tools" aria-label="Avatar stage controls">
                    <div className="avatar-stage-view-control">
                        <span className="avatar-stage-label"><Camera size={13} /> View</span>
                        <div className="avatar-view-buttons">
                            {[
                                ["front", "Front"],
                                ["threeQuarter", "3/4"],
                                ["profile", "Profile"]
                            ].map(([value, label]) => (
                                <button
                                    className={`avatar-view-button ${cameraView === value ? "active" : ""}`}
                                    key={value}
                                    type="button"
                                    aria-pressed={cameraView === value}
                                    onClick={() => handleCameraView(value)}
                                    disabled={!ready}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="avatar-stage-actions">
                        <button className={`stage-icon-button ${autoRotate ? "active" : ""}`} type="button" aria-label="Toggle auto rotate" aria-pressed={autoRotate} onClick={handleAutoRotate} disabled={!ready} title="Auto rotate">
                            <RotateCw size={14} />
                        </button>
                        <button className={`stage-icon-button ${backgroundMenuOpen ? "active" : ""}`} type="button" aria-label="Choose background" aria-expanded={backgroundMenuOpen} onClick={() => setBackgroundMenuOpen((current) => !current)} disabled={!ready} title="Choose background">
                            <Palette size={14} />
                        </button>
                        <button className="stage-icon-button" type="button" aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"} onClick={toggleFullscreen} title={isFullscreen ? "Exit full screen" : "Full screen"}>
                            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        </button>
                    </div>
                    {backgroundMenuOpen && (
                        <div className="avatar-background-menu" role="group" aria-label="Background options">
                            <span className="avatar-background-menu-title">Stage background</span>
                            {BACKGROUND_THEMES.map((theme) => (
                                <button className={`avatar-background-option ${backgroundTheme === theme.id ? "active" : ""}`} key={theme.id} type="button" onClick={() => handleBackgroundTheme(theme.id)}>
                                    <span className="avatar-background-swatch" style={{ background: theme.swatch }} />
                                    <span>{theme.label}</span>
                                    {backgroundTheme === theme.id && <span className="avatar-background-check">✓</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="avatar-stage-hint"><span className="status-dot status-dot-green" /> Drag to orbit <span>•</span> Scroll to zoom</div>
                <div className="avatar-stage-badge">
                    <span className="status-dot status-dot-green" />
                    {selectedGloss || "Preview motion"}
                </div>
            </div>
            <div className="avatar-library-control">
                <div className="avatar-library-copy">
                    <span className="eyebrow">Avatar library</span>
                    <strong>{avatarCatalog.find((avatar) => avatar.path === selectedAvatarPath)?.name ?? "Loading avatars..."}</strong>
                    <small>{avatarCatalog.length} avatar{avatarCatalog.length === 1 ? "" : "s"} available in your folder</small>
                </div>
                <label className="avatar-select-wrap" htmlFor="avatar-library-select">
                    <span>Choose avatar</span>
                    <select id="avatar-library-select" value={selectedAvatarPath} onChange={handleAvatarChange} disabled={!ready || avatarSwitching || avatarCatalog.length === 0}>
                        {avatarCatalog.map((avatar) => (
                            <option value={avatar.path} key={avatar.id}>{avatar.name}</option>
                        ))}
                    </select>
                </label>
            </div>
            {avatarError && <div className="avatar-library-error" role="alert">{avatarError}</div>}
            <div className="avatar-controls">
                <div className="control-group">
                    <button className="control-button primary" onClick={() => runControl("play")} disabled={!ready}>
                        <Play size={15} fill="currentColor" /> Play
                    </button>
                    <button className="control-button" onClick={() => runControl("pause")} disabled={!ready}>
                        <Pause size={15} fill="currentColor" /> Pause
                    </button>
                    <button className="icon-button" onClick={() => runControl("restart")} disabled={!ready} aria-label="Restart motion">
                        <RotateCcw size={16} />
                    </button>
                </div>
                <label className="speed-control">
                    <span><SlidersHorizontal size={15} /> Speed <strong>{speed.toFixed(2)}x</strong></span>
                    <input type="range" min="0.1" max="3" step="0.05" value={speed} onChange={handleSpeed} disabled={!ready} />
                </label>
            </div>
            <div className="avatar-framing-controls" aria-label="Avatar framing controls">
                <div className="avatar-framing-heading">
                    <span><SlidersHorizontal size={14} /> Frame avatar</span>
                    <button className="text-button" type="button" onClick={resetFraming} disabled={!ready}>Reset</button>
                </div>
                <div className="avatar-framing-grid">
                    <label className="framing-control framing-control-wide">
                        <span>Zoom <strong>{zoom.toFixed(2)}×</strong></span>
                        <input type="range" min="1.7" max="5.8" step="0.05" value={zoom} onChange={handleZoom} disabled={!ready} />
                    </label>
                    {[
                        ["x", "Horizontal", -0.7, 0.7],
                        ["y", "Vertical", -0.35, 0.45],
                        ["z", "Depth", -0.45, 0.45]
                    ].map(([axis, label, minimum, maximum]) => (
                        <label className="framing-control" key={axis}>
                            <span>{label} <strong>{avatarPosition[axis].toFixed(2)}</strong></span>
                            <input type="range" min={minimum} max={maximum} step="0.01" value={avatarPosition[axis]} onChange={(event) => handleAvatarPosition(axis, event)} disabled={!ready} />
                        </label>
                    ))}
                </div>
            </div>
        </section>
    );
}

function SparkleMark() {
    return <span className="sparkle-mark">✦</span>;
}

export default AvatarViewport;
