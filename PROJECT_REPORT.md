# SignStream — Complete Project Report

**Snapshot covered:** 3 September 2026  
**Repository state:** branch `bala`, commit `423de93` (`working proto`)  
**Project type:** browser-based sign-language translation workspace with a local 3D avatar motion engine

## 1. Executive summary

SignStream accepts written text and several media inputs, converts language into an ordered sequence of sign glosses, and plays the corresponding prerecorded motion clips on a VRM avatar in the browser. The project is split into four cooperating systems:

1. a React/Vite product interface;
2. a Three.js + VRM runtime that loads avatars and applies motion;
3. a FastAPI service for translation, uploads, authentication, status, history, and media conversion;
4. an offline computer-vision pipeline that converts videos into reusable motion and landmark JSON assets.

### Branch context

This report describes the checked-out `bala` branch at commit `423de93`. A sibling `main` branch in the repository contains additional motion-review, finger-retargeting, and IK work that is not part of this documented snapshot. Those changes are useful reference material, but should not be described as shipped features of this version.

The project is a strong working prototype and a useful engineering foundation. It is not yet a fully production-ready sign-language translator. In particular, the current language layer is gloss retrieval/selection rather than a complete linguistic ISL translation system, generated motion data is local and ignored by Git, and the frontend authentication/history UI is not connected to the backend database path.

## 2. What exists today

| Area | Current implementation | Status |
|---|---|---|
| Landing, login, register, dashboard, settings, history, help, status pages | React routes in `frontend/src/pages` | Implemented UI |
| Text translation | FastAPI endpoint, local manifest matcher, optional Gemini/OpenAI provider | Working |
| Document input | TXT, DOCX, PDF validation and extraction | Working when dependencies are installed |
| Image input | Image validation plus provider-backed OCR | Implemented for Gemini/OpenAI; local mode reports unavailable |
| Speech input | Browser recognition while recording plus uploaded-audio transcription | Implemented; depends on browser/provider |
| VRM avatar playback | Three.js, `@pixiv/three-vrm`, quaternion retargeting | Working in the local build |
| Motion variants | Per-gloss, per-video manifest entries with ready/pending status | Working |
| Landmark display | Optional landmark skin and debug skeleton | Working in the local build |
| Browser video export | Canvas `captureStream()` + `MediaRecorder`, WebM | Browser-dependent |
| MP4 conversion | Server-side `ffmpeg` endpoint | Implemented; environment-dependent |
| Authentication | Bcrypt password hashes, JWT access tokens, protected backend routes | Backend implemented |
| Persistent history | SQLAlchemy models and API routes | Backend implemented; frontend currently uses localStorage instead |
| Database migration | Alembic initial migration, automatic startup migration | Local path works; Docker path needs correction |
| Offline conversion | MediaPipe pose/hands → canonical quaternions → motion JSON | Implemented |
| Automated validation | Python tests, Node tests, Oxlint, Vite build | Passing in this workspace |

## 3. Product behavior

### Text-to-avatar flow

```text
User types text
    ↓
TranslatePage previews words already present in the local catalog
    ↓
POST /api/translate/text
    ↓
FastAPI loads the motion manifest
    ↓
Manifest matcher or Gemini/OpenAI returns ordered glosses
    ↓
Each gloss is resolved against an actual manifest clip
    ↓
API returns glosses, motion paths, provider, and unknown glosses
    ↓
AvatarViewport asks AnimationEngine to play the sequence
    ↓
MotionLoader fetches each JSON clip
    ↓
MotionPlayer advances frames
    ↓
PoseApplier maps each frame to VRM bones
```

The backend intentionally resolves the provider output against the manifest after the provider responds. This prevents an LLM from making the browser request a motion file that does not exist.

### Document and image flow

The browser sends a multipart upload to `/api/translate/document` or `/api/translate/image`. The backend:

1. sanitizes the filename;
2. enforces an extension allowlist;
3. streams the upload to a generated server filename;
4. enforces the byte limit;
5. validates file signatures/content;
6. extracts text from TXT, DOCX, or PDF, or sends an image to the configured remote OCR provider;
7. normalizes the resulting text;
8. sends that text through the same gloss-to-motion translation pipeline.

The frontend then navigates to `/translate?text=...` when normalized text is returned.

### Speech flow

`WorkflowPage` requests microphone permission through `getUserMedia()`. If the browser supports `SpeechRecognition`, final recognition results are translated sequentially through a promise queue so phrases do not overtake one another. The audio is also recorded with `MediaRecorder`; when the user stops, the recording is uploaded for provider-backed transcription when available. The avatar can simultaneously be recorded by combining its canvas video track with the microphone track.

### Motion-conversion flow

```text
Indexed source video metadata
    ↓
OpenCV reads local video frames
    ↓
MediaPipe Pose + Hands extract 33 body and 21 hand landmarks
    ↓
Missing data, hand identity, smoothing, and geometry checks are handled
    ↓
MotionBuilder derives canonical joint directions and quaternions
    ↓
Body/hand motion JSON and raw landmark JSON are written
    ↓
manifest.json is refreshed with variants and readiness
    ↓
Frontend loads the generated assets at runtime
```

The original FreeMoCap route remains available through `process_single.py` and `export_landmarks.py`, but the current batch path can process videos directly with MediaPipe and is the more important route.

## 4. Repository map

| Path | Responsibility |
|---|---|
| `backend/app/main.py` | FastAPI application, CORS, startup lifecycle |
| `backend/app/api/routes.py` | HTTP endpoints and orchestration |
| `backend/app/core/config.py` | Environment-backed settings and paths |
| `backend/app/core/database.py` | SQLAlchemy engine/session/base |
| `backend/app/core/migrations.py` | Startup Alembic migration runner |
| `backend/app/core/security.py` | Bcrypt and JWT helpers |
| `backend/app/dependencies.py` | Database and current-user dependencies |
| `backend/app/models.py` | `users` and `history` tables |
| `backend/app/schemas.py` | Pydantic request/response contracts |
| `backend/app/services.py` | Manifest loading and gloss matching |
| `backend/app/input_processing.py` | Upload validation and text extraction |
| `backend/app/llm.py` | Local, Gemini, and OpenAI provider adapters |
| `backend/migrations` | Alembic environment and initial schema |
| `backend/tests` | API/provider/input tests |
| `converter/skeleton.py` | MediaPipe landmark indexes and coordinate conversion |
| `converter/video_landmarks.py` | OpenCV/MediaPipe extraction |
| `converter/motion_builder.py` | Landmark-to-motion mathematics and JSON generation |
| `converter/convert_motion.py` | Batch conversion and manifest refresh |
| `converter/quality_gate.py` | Offline clip quality metrics and statuses |
| `converter/rebuild_motion_from_landmarks.py` | Rebuild motion without rereading source video |
| `converter/tests` | Converter regression tests |
| `frontend/src/App.jsx` | Route table and lazy page loading |
| `frontend/src/pages` | Product screens and workflows |
| `frontend/src/services` | API, avatar catalog, and local history access |
| `frontend/src/core` | Avatar and motion loading plus bone mapping |
| `frontend/src/rendering` | Three.js renderer, camera, lighting, stage |
| `frontend/src/animation` | Frame playback, retargeting, hand correction, recording |
| `frontend/src/components/avatar` | React wrapper around the animation engine |
| `frontend/src/components/landmark-avatar` | Landmark-based 3D representation |
| `frontend/src/debug` | Optional skeleton overlay and debug helpers |
| `frontend/public/avatar*.vrm` | Runtime avatars |
| `frontend/public/motion` | Generated motion and landmark assets |
| `frontend/public/avatars/manifest.json` | Generated VRM avatar catalog |
| `docker-compose.yml` | PostgreSQL, API, and Nginx services |

## 5. Frontend architecture

### React application structure

`main.jsx` creates a React root, wraps it in `BrowserRouter`, and imports global CSS. `App.jsx` lazy-loads pages and places the authenticated-looking workspace pages inside `AppShell`. Lazy loading keeps the initial JavaScript smaller and allows page chunks to be generated by Vite.

The route table includes:

```text
/                 landing page
/login            login form
/register         registration form
/dashboard        workspace overview
/translate        text translation studio
/speech           live speech workflow
/documents        document workflow
/images           image/OCR workflow
/history          local history screen
/saved            local saved-history filter
/status           API/provider diagnostics
/profile          profile-shaped settings screen
/settings         local preferences
/help             help workflow screen
```

`AppShell` provides navigation, theme switching, responsive sidebar behavior, page titles, and accessibility affordances such as a skip link and labels.

### API client and runtime validation

`services/apiClient.js` uses Axios for API requests and Zod for validating translation and status responses. This is useful because the frontend does not blindly trust server-shaped JSON. The client stores the JWT returned by login/register, but it does not currently install an Axios interceptor to send that token on later requests.

`services/motionCatalog.js` loads `/motion/manifest.json` and manages a separate localStorage history. `services/avatarCatalog.js` loads a generated catalog of `.vrm` files and remembers the selected avatar path.

### 3D rendering

The runtime is deliberately separated into layers:

1. `Renderer` owns `THREE.WebGLRenderer`, pixel ratio, shadows, color space, tone mapping, resize handling, and the render loop.
2. `SceneManager` owns the scene, camera, OrbitControls, stage themes, background canvas, lighting, floor, camera presets, zoom, and auto-rotation.
3. `AvatarLoader` uses `GLTFLoader` plus `VRMLoaderPlugin` to load a VRM file, normalize VRM 0 orientation when needed, place the avatar, enable shadows, and dispose resources.
4. `BoneMapper` maps project joint names such as `LEFT_ELBOW` to VRM humanoid bone names and logs missing bones.
5. `MotionLoader` loads/normalizes the manifest and motion JSON, resolves variants, supports legacy field aliases, validates frames, and creates an idle preview loop when only a one-frame preview is available.
6. `MotionPlayer` advances frames according to motion FPS and playback speed, interpolates positions linearly, and interpolates valid rotations with quaternion slerp.
7. `PoseApplier` converts motion-space rotations into the loaded avatar’s local bone space while respecting rest transforms, locked body joints, tracked flags, and the pelvis position.
8. `AnimationEngine` wires all components together and exposes a small controls object to React.

This separation is valuable: UI code can request “play these glosses” without knowing how a quaternion is applied to a VRM hand bone.

### Animation and hand correctness

The motion format has 33 body landmarks and 21 landmarks per hand at the extraction stage. The builder outputs 22 body joints plus 30 finger joints, for 52 canonical joint names. The motion JSON records:

- FPS and frame count;
- canonical joint names;
- quaternion rotations as `{x, y, z, w}`;
- optional pelvis positions;
- `tracked` flags for wrists/finger segments;
- `locked` flags for body joints;
- coordinate-system metadata;
- avatar-specific finger rest directions.

The project treats the body and hands differently:

- pelvis, spine, neck, head, hips, knees, ankles, feet, and collars are locked to the avatar rest pose in the current builder;
- shoulders and elbows are driven from body landmark segment directions;
- wrists use palm basis orientation;
- fingers use a full local basis, not only a single direction vector, so roll/twist is retained;
- wrist/finger tracking loss is explicitly held rather than converted to an identity pose;
- valid quaternions are slerped only when both adjacent samples are tracked;
- the converter calibrates source finger directions from the default avatar, while the runtime captures loaded-avatar rest geometry for its hand logic. The current branch does not yet pass the clip’s `fingerRestForwards` metadata through a complete source-to-target retargeting path, so switching avatars should be treated as a feature requiring visual validation.

`HandPoseCorrector` contains optional rest-pose, finger-limit, and torso-collision logic. The current default is intentionally conservative: tracked signing hands are left untouched, while correction is allowed after an explicit rest/tracking condition. This choice protects authored signing motion from a generic “cleanup” algorithm.

### Landmark representations

The runtime can show either the VRM avatar or a `LandmarkAvatar` generated from the raw landmark arrays. The older line/point `LandmarkSkeletonOverlay` remains available for debugging but is disabled by default through `DEBUG_LANDMARKS = false`.

## 6. Backend architecture

### HTTP endpoints

All application endpoints use the `/api` prefix.

| Endpoint | Purpose | Authentication |
|---|---|---|
| `GET /api/health` | Basic liveness and active provider | Public |
| `GET /api/status` | Environment, provider, token counters, motion counts | Public |
| `POST /api/status/llm-check` | Exercises the selected provider, then reports status | Public |
| `POST /api/auth/register` | Create user and return JWT | Public |
| `POST /api/auth/login` | Verify password and return JWT | Public |
| `GET /api/auth/me` | Return the current user | Bearer token |
| `GET /api/motions` | Return the server-side motion manifest | Public |
| `POST /api/translate/text` | Translate text to glosses and motion paths | Public |
| `POST /api/translate/document` | Upload/extract/translate PDF, DOCX, or TXT | Public |
| `POST /api/translate/image` | Validate/OCR/translate image | Public |
| `POST /api/translate/speech` | Validate/transcribe/translate audio | Public |
| `POST /api/media/convert-mp4` | Convert browser recording to MP4 with ffmpeg | Public |
| `GET /api/history` | List user history | Bearer token |
| `POST /api/history` | Create user history entry | Bearer token |
| `DELETE /api/history/{entry_id}` | Delete the user’s own entry | Bearer token |

### Translation service

`services.py` provides a deliberately small matching layer. It normalizes words, recognizes a few common inflections (`raining → rain`, `crying → cry`, plural forms, and similar cases), prefers longer phrases, preserves order and repeats, and caps local matching at 20 items.

`llm.py` defines three provider modes:

- `manifest`: deterministic local matching; no network or API key;
- `gemini`: Google Gemini structured JSON output for gloss translation, plus image/audio capabilities;
- `openai`: OpenAI Responses structured JSON output for gloss translation, plus image OCR and audio transcription.

`LLM_PROVIDER=auto` selects Gemini first, OpenAI second, and local matching last. Provider errors are converted into typed application errors with codes such as `missing_api_key`, `timeout`, `rate_limited`, `malformed_response`, and `capability_unavailable`.

The structured response contract is intentionally narrow:

```json
{
  "glosses": ["HELLO", "WATER"]
}
```

The provider instruction says to copy only glosses present in the available manifest. The backend still performs its own resolution, because prompts are not a security or correctness boundary.

Provider statistics are protected by a thread lock and include request count, success/failure count, latency, last error, and token usage. These counters are process-local and reset when the API restarts. Provider account quota is correctly reported as unavailable rather than guessed.

### Database and security

SQLAlchemy models define:

- `users`: id, name, unique email, bcrypt password hash, creation time;
- `history`: optional user id, title, selected gloss, source type, content, saved flag, creation time.

Alembic contains one initial migration. Startup runs migrations automatically and contains a compatibility path that stamps an existing schema if it predates the Alembic version table.

Passwords are hashed with bcrypt. JWTs use HS256, contain a subject and expiry, and are decoded by a FastAPI dependency. The backend scopes history queries and deletes to the authenticated user.

### Upload safety

The upload implementation has several good properties:

- allowed extensions are explicit;
- filenames are reduced to a safe basename and generated tokenized destination;
- uploads are streamed in 1 MiB chunks;
- size limits are enforced while writing;
- basic magic-byte checks reject empty/fake files;
- ffmpeg receives generated paths and a fixed argument list, not shell text;
- failed processing removes the stored file.

Remaining production work includes content scanning, retention/deletion policy, stronger format parsing, rate limiting, and background jobs for expensive OCR/transcription/conversion.

## 7. Offline computer-vision pipeline

### Extraction

`video_landmarks.py` uses OpenCV to sample local videos and MediaPipe Pose/Hands to produce world-space landmarks. A source bounding box can crop the signer before detection. The extractor records source FPS, effective FPS, frame size, detection counts, frame stride, and raw landmark arrays.

### Coordinate conversion

MediaPipe coordinates are transformed into the Three.js convention with:

```text
Three.js x = source x
Three.js y = -source y
Three.js z = -source z
```

The reason is that the runtime uses a right-handed 3D space with `+Y` up, while the extracted source coordinates need the project’s chosen orientation.

### Motion building

`MotionBuilder` computes body directions from landmarks, constructs palm bases from wrist/MCP points, and creates rotations with quaternion math. It avoids Euler-angle storage because quaternions do not suffer from Euler gimbal-lock behavior and interpolate naturally with slerp.

The builder includes:

- finite-value handling;
- shape validation for `(33, 3)` body and `(21, 3)` hand frames;
- hand landmark smoothing with a weighted seven-frame window;
- complete-chain validation for each finger;
- hold behavior for temporary tracking loss;
- explicit `tracked` flags;
- conservative finger bend limits;
- quaternion sign/continuity handling;
- a 1.2° deadband;
- a 16° maximum hand step;
- five-frame hand-loss hold;
- JSON-safe finite numbers;
- avatar rest-axis calibration from the GLB/VRM JSON chunk when possible.

### Manifest and variants

`convert_motion.py` starts from `converter/output/video_gloss_index.json`, converts each indexed video, writes:

- `/motion/clips/<video-id>.json` for avatar motion;
- `/motion/landmarks/<video-id>.json` for inspection/debugging;
- updated `frontend/public/motion/manifest.json` for runtime lookup;
- a conversion report under `converter/output`.

A gloss can have several source videos. Each is retained as a `motionVariant` with video id, motion path, landmark path, source provenance, and readiness. This preserves dataset information instead of collapsing every gloss to a single opaque file.

### Quality gate

`quality_gate.py` calculates detection percentages, finger-missing percentages, palm-basis stability, quaternion jumps, finger bend ranges, wrist-to-torso clearance, rejected frames, and identity-change events. It classifies variants as `ready`, `needs-review`, or `rejected` and writes quality fields into the manifest.

This is a useful pattern: a preprocessing pipeline should produce measurable artifacts and metadata, not only files that happen to render.

## 8. Current asset inventory

The local workspace currently reports:

| Metric | Value |
|---|---:|
| Manifest gloss entries | 1,886 |
| Manifest video variants | 2,350 |
| Motion clip JSON files | 2,283 |
| Landmark JSON files | 2,283 |
| Ready variants | 2,283 |
| Pending variants | 67 |
| Manifest statuses | 1,819 ready, 1 partial, 66 pending |
| Motion JSON size | about 1.62 GB |
| Landmark JSON size | about 1.00 GB |
| VRM avatars | 2 |

The generated motion data is ignored by Git through `.gitignore`. The source video-to-gloss index and converter output are also ignored. A fresh clone therefore does not contain the local motion library unless it is restored from a separate artifact store or regenerated from the original videos.

The application’s dataset metadata says `WLASL_top2`, while the product UI and prompts call the target language “ISL”. That language/dataset relationship must be explicitly verified before presenting the system as an Indian Sign Language translator.

## 9. Engineering problems and how the project addressed them

### Problem: a language model can return unavailable signs

**Response:** constrain provider output with a structured JSON schema, include the available gloss list in the instruction, then resolve every returned gloss against the local manifest and report `unknown_glosses`.

**Lesson:** external AI output must be treated as untrusted input and checked against application-owned state.

### Problem: simple word matching loses order and repetition

**Response:** scan the input from left to right, prefer longer phrases, append each match in order, and do not deduplicate. Tests cover `book drink book` and common inflections.

**Lesson:** preserve user-visible sequence semantics in the domain layer, not only in UI state.

### Problem: raw hand landmarks are noisy and intermittently missing

**Response:** smooth valid samples, validate complete finger chains, hold the last complete chain for short dropouts, mark invalid samples untracked, avoid interpolating across tracking loss, and limit sudden quaternion changes.

**Lesson:** missing data and zero-valued data are not equivalent. Carry tracking state explicitly.

### Problem: direction-only finger rotations discard twist

**Response:** construct a three-axis basis for each finger segment and derive a quaternion from source and target bases.

**Lesson:** a 3D bone orientation needs enough basis information to determine roll, not just a forward vector.

### Problem: one hard-coded avatar rest axis does not fit every VRM

**Response:** calibrate source finger directions from the default conversion avatar and derive rest geometry for the loaded target avatar. A complete general source-to-target use of the clip’s `fingerRestForwards` metadata remains a follow-up task.

**Lesson:** retargeting is a calibration problem. The source skeleton and target skeleton must share a well-defined rest pose.

### Problem: generic runtime cleanup can destroy the sign

**Response:** make hand correction conservative and keep tracked signing hands untouched by default. Rest/collision correction only activates under explicit conditions.

**Lesson:** a “visually smoother” algorithm can be semantically worse. Protect authored data first.

### Problem: users need the app to work without a paid API key

**Response:** add a deterministic manifest matcher and use `auto` provider selection with local fallback.

**Lesson:** build a useful vertical slice that works offline before adding expensive dependencies.

### Problem: large motion libraries need provenance and partial readiness

**Response:** keep per-video variants, source paths, readiness, landmarks, and quality metadata in the manifest.

**Lesson:** a dataset manifest is an API contract, not a convenience file.

### Problem: uploaded media can be malformed or dangerous

**Response:** use extension allowlists, filename sanitization, byte limits, signatures, generated paths, and fixed ffmpeg arguments.

**Lesson:** validate at the boundary and keep external tools isolated.

### Problem: browser recording formats vary

**Response:** probe supported `MediaRecorder` MIME types, prefer WebM, and provide an ffmpeg-backed MP4 conversion route.

**Lesson:** browser media APIs need capability detection and a format fallback strategy.

## 10. Technology decisions and alternatives

The code does not contain a formal architecture decision record, so the “why chosen” explanations below are engineering inferences from the implementation and project constraints.

| Chosen technology/pattern | Why it fits this project | Alternatives left off and trade-off |
|---|---|---|
| React | Component model fits many screens and stateful controls | Vue/Svelte could be smaller; Angular would add more framework structure |
| Vite | Fast dev server, simple static build, good Three.js support | Next.js would add SSR/routing conventions that are not needed for a mostly client-rendered studio; CRA is less current |
| JavaScript/JSX | Fast iteration while the project is exploratory | TypeScript would catch motion/manifest shape errors earlier and should be the next migration |
| Three.js | Direct control of scene, bones, cameras, shaders, and render loop | Babylon.js is a valid alternative; Unity/Unreal would be heavier and harder to ship as a normal web app |
| VRM | Humanoid avatar standard with a usable Three.js loader and normalized humanoid bones | Raw GLTF lacks a standard humanoid mapping; Ready Player Me is more opinionated; custom skeletal rigs cost more integration work |
| Precomputed JSON motion | No user GPU/MediaPipe requirement at playback time; deterministic and cacheable | Runtime pose inference would support live camera input but costs CPU/GPU and introduces latency; BVH/glTF animation is more compact but less convenient for custom hand metadata |
| MediaPipe Pose/Hands | Practical pretrained landmark extraction for an offline pipeline | OpenPose, MoveNet, Holistic, or a custom model could improve coverage but change performance/licensing/implementation complexity |
| Offline preprocessing | Heavy vision work happens once, not on every user request | A server queue can regenerate on demand but requires workers, job state, and storage |
| FastAPI | Typed request validation, automatic OpenAPI docs, straightforward file uploads and dependencies | Flask is simpler but provides less structure; Django is stronger for a large database product but heavier; Node could unify language but would not remove the CV Python requirement |
| Pydantic schemas | Documents the API contract and rejects bad request shapes | Manual dictionaries are faster initially but fail later and drift more easily |
| SQLAlchemy + Alembic | Portable ORM and migration workflow for SQLite/PostgreSQL | Prisma, SQLModel, Django ORM, or raw SQL are possible; raw SQL gives control but more application code |
| SQLite locally / PostgreSQL in Compose | Low-friction local development with a production-capable relational database | PostgreSQL everywhere is more consistent but less convenient for a first local setup; MongoDB does not naturally improve these relational user/history records |
| JWT bearer tokens | Stateless API authentication and easy FastAPI integration | Cookie sessions are safer against token theft in some browser deployments; OAuth/identity providers reduce password responsibility but add external setup |
| Direct provider adapters | Keeps the LLM boundary small, testable, and transparent | LangChain/LlamaIndex could add abstractions, but this use case needs only a few direct HTTP calls |
| Gemini/OpenAI structured JSON | Reduces parsing ambiguity and provides optional OCR/transcription | A local model improves privacy/cost control but raises deployment and quality complexity; a dedicated translation model may be linguistically better |
| Local manifest matcher | Deterministic offline fallback and no API cost | Stemming/lemmatization libraries or a real NLP model improve language handling; neither replaces sign-language grammar modeling |
| `pypdf` plus minimal DOCX XML extraction | Few dependencies for basic text extraction | `python-docx`, Apache Tika, LibreOffice, or cloud document APIs may handle more formats but add weight or operational cost |
| Browser `MediaRecorder` | Immediate canvas/video capture with no render server | Headless Chromium/WebCodecs/server rendering offers more control but increases complexity |
| Nginx static serving | Small, conventional production container for Vite output | CDN/object storage is better at scale; an application server can proxy APIs but is unnecessary for the current static frontend |

## 11. Known gaps and risks

### High priority

1. **Docker path layout is inconsistent.** The backend image copies `backend/app` into `/app/app`, but `config.py` computes paths as if the repository were mounted at a different root. The image also does not copy `migrations` or `alembic.ini`, while startup expects them. Compose mounts motion at `/app/frontend/public/motion`, but the default setting resolves to `/frontend/public/motion`. Fix the image layout or pass explicit `MOTION_MANIFEST_PATH`, `UPLOAD_DIRECTORY`, and migration paths.
2. **Generated assets are not reproducible from Git alone.** Motion JSON, landmarks, index files, raw videos, and some images are ignored. Add a documented artifact-release process, object-storage sync, or a small deterministic fixture set for clones and CI.
3. **Frontend auth/history is disconnected from backend auth/history.** Login stores a token but no later Axios request sends it. History screens read localStorage and never call `/api/history`. Decide whether history is local-only or complete the server-backed flow.
4. **Language/domain correctness needs verification.** The product calls the target language ISL but the data field is `WLASL_top2`. Also, word-level clips plus simple matching do not model sign-language grammar, facial expression, classifiers, or context.

### Medium priority

5. `frontend/requirements.txt` contains a stale editable install pointing to `C:\Users\saket\major_project\signavatars\visualizer` and should be removed or moved into a separately documented legacy environment.
6. Converter dependencies such as NumPy, OpenCV, and MediaPipe are available in the current virtual environment but are not listed in `backend/requirements.txt`. Add a dedicated `converter/requirements.txt` or optional dependency group.
7. The Axios timeout is 5 seconds while provider calls may wait 30 seconds. This causes the browser to fall back before a slow provider responds. Use separate timeouts for local status, translation, upload, and long-running operations.
8. There is no CI workflow, API integration test suite for every endpoint, browser end-to-end test, visual regression test, load test, or accessibility audit.
9. The motion library is around 2.6 GB of uncompressed JSON and is copied into the frontend Docker build context. Use compressed/binary assets, lazy CDN/object storage, or a smaller shipped subset.
10. Upload retention, authorization for uploaded files, virus/content scanning, and background processing are not yet designed for multi-user production use.

### Documentation drift

`data.txt` says OCR and speech-to-text are not implemented, but the current backend contains provider-backed OCR/transcription methods. `MOTION_AVATAR_FINISH_CHECKLIST.md` still describes the full clip batch as unfinished even though the local workspace contains 2,283 pairs. Treat code, generated reports, and fresh validation output as the current source of truth, then update or archive stale notes.

## 12. Validation evidence from this workspace

The following commands were run successfully on the snapshot:

```powershell
.\bs\Scripts\python.exe -m pytest -q backend converter\tests
# 22 passed

Set-Location frontend
npm test
# 7 passed

npm run lint
# passed

npm run build
# passed; Vite production build completed
```

The Vite build warns that the `AvatarViewport` chunk is large after minification. That is a performance signal, not a failed build.

## 13. Recommended improvement sequence

1. Repair Docker path assumptions and add a Compose smoke test.
2. Add a small checked-in motion fixture and a documented artifact restore command.
3. Separate runtime, converter, and legacy FreeMoCap dependencies.
4. Choose and implement one history/auth model; preferably add a token interceptor, protected route behavior, and API-backed history.
5. Add TypeScript or at least shared generated schemas for manifest and motion JSON.
6. Replace the simple word matcher with a versioned translation layer that separates language normalization, sign-language grammar, gloss selection, and clip lookup.
7. Confirm the dataset/language identity and add human review by fluent signers.
8. Add full-library quality reports, golden clips, visual browser tests, and a review workflow.
9. Compress/split motion assets and move large artifacts to release storage/CDN.
10. Add rate limits, structured logs, request IDs, provider retries/backoff, background jobs, retention policies, and monitoring.

## 14. How to run the current local project

From the repository root:

```powershell
.\bs\Scripts\python.exe -m uvicorn app.main:app --reload --app-dir backend --port 8000
```

In another terminal:

```powershell
Set-Location frontend
npm run dev
```

Useful URLs:

- frontend: the Vite URL printed by the dev server, normally `http://localhost:5173`;
- API root: `http://localhost:8000/`;
- API docs: `http://localhost:8000/docs`;
- status page: frontend `/status`;
- API health: `http://localhost:8000/api/health`.

For remote providers, copy `.env.example` to `.env` in the repository root and configure only the server-side key. Never put provider secrets in a `VITE_` variable or frontend `.env`.

## 15. Final assessment

SignStream has already crossed the “toy demo” boundary: it has a real product shell, a reusable rendering engine, a nontrivial offline motion compiler, provider abstraction, validation, storage models, and automated tests. The next engineering step is not simply adding more screens. It is making the existing system reproducible, linguistically trustworthy, operationally observable, and internally consistent across the frontend, backend, generated assets, and deployment environment.
