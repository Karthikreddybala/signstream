# Motion-to-Avatar Finish Checklist

## Wired
- [x] `converter/video_landmarks.py` — extract pose and hand landmarks offline from each local MP4 with MediaPipe.
- [x] `converter/motion_builder.py` — turn body/hand landmark arrays into canonical VRM-ready joint rotations and root motion.
- [x] `converter/convert_motion.py` — batch-convert each local video into `frontend/public/motion/clips/<videoId>.json` and refresh manifest variant status.
- [x] `WLASL/start_kit/build_gloss_manifest.py` — build the local-only gloss manifest with per-video motion variants and statuses.
- [x] `frontend/src/core/MotionLoader.js` — resolve gloss/video ID to the right motion variant, normalize legacy and variant-rich JSON, and fall back to preview when needed.
- [x] `frontend/src/animation/AnimationEngine.js` — start the avatar, load the manifest, expose live gloss swapping, and keep the player controls wired.
- [x] `frontend/src/App.jsx` — show the gloss dropdown and playback controls in the UI.
- [x] `converter/output/video_gloss_index.json` — local video-to-gloss index generated from `WLASL_top2.json` and the videos already in `videos/`.
- [x] `frontend/public/motion/manifest.json` — runtime gloss manifest consumed by the frontend.

## Still To Finish
- [ ] `frontend/public/motion/clips/` — run the batch converter for the full local set so every mapped video has its own motion JSON clip.
- [ ] `frontend/requirements.txt` — remove the stale editable install path to the old external visualizer project.
- [ ] `motion_viewer/src/vrm/retargeter.js` — either finish the quaternion retargeting prototype or retire it once the new pipeline is the source of truth.

## Next Run
- Process the existing local `videos/` set only; do not download anything new yet.
- Run `python converter/convert_motion.py --overwrite` to populate `frontend/public/motion/clips/` from the offline MediaPipe extractor.

## Legacy / Optional
- `process_single.py` and `export_landmarks.py` — keep only if you want the old FreeMoCap recording-based route; the offline batch path no longer depends on them.
