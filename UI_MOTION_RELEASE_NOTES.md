# SignStream UI + motion release notes

## Shipped

- Replaced the pre-login CSS silhouette with a polished human signing portrait at `frontend/public/signstream-interpreter.png`.
- Reworked the landing and login surfaces with a calmer, more premium visual hierarchy and responsive image treatment.
- Added accessible avatar camera presets: Front, 3/4, and Profile. Presets transition smoothly and can still be fine-tuned with OrbitControls.
- Fixed the 3D renderer sizing to follow the avatar card, including responsive resize handling and a capped pixel ratio for predictable performance.
- Removed production debug grid/axes, added a controlled studio floor, and improved avatar lighting, fog, tone mapping, and shadow softness.
- Restored motion coordination by making hand cleanup conservative: authored hand/finger motion remains untouched while signing, and idle/collision correction only activates after a confirmed rest state.
- Added `prefers-reduced-motion` coverage and accessible labels/states for the new camera controls.

## Hand-motion rebuild

- Rebuilt the available motion library from the supplied raw videos in `C:\Users\saket\major_project\videos` using the indexed video-to-gloss records.
- Processed 2,350 indexed records: 1,799 clips were newly extracted, 524 already-current clip/landmark pairs were retained, and 27 records were skipped because their source files are 114-byte HTML placeholders rather than decodable MP4 video. No indexed path was missing. The folder also contains 106 extra MP4 files that are not present in the index and were left untouched.
- Added a 7-frame hand landmark filter, quaternion-aware hand/finger smoothing, a 16-degree per-frame safety guard, and a five-frame hold for temporary tracking loss.
- Reset the hand limiter at tracking dropouts so re-entry cannot reuse a stale pose.
- Across 2,323 readable clips, continuous hand motion measures mean 7.26 degrees, p95 16.01 degrees, and max 16.01 degrees; re-entry motion also stays below 16.01 degrees.
- Raw landmark payloads remain in `frontend/public/motion/landmarks/` for inspection and reproducible future rebuilds.

## Verification

- `npm run lint` - passed
- `npm run build` - passed
- `python -m pytest converter/tests -q` - 3 passed
- Raw-video conversion report - 1,799 generated, 524 already current, 0 missing, 27 unavailable placeholder sources
- Local HTTP smoke check - `/`, `/login`, and the new image asset returned `200`

## Deployment note

The frontend production build is ready. Before a public release, manually open `/translate` on one desktop and one mobile viewport and confirm the avatar loads from the deployed asset path, then click all three camera presets while a multi-clip sequence is playing. The automated visual browser was unavailable in this environment, so that final visual pass could not be performed here.
