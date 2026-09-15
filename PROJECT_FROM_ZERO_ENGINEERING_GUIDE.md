# SignStream From Zero — Software Engineering Learning Guide

This guide explains how to build a project like SignStream from the beginning and, more importantly, how to think while building it. Read it together with [PROJECT_REPORT.md](PROJECT_REPORT.md), which describes the exact current snapshot.

## 1. The central idea

Do not think of SignStream as “a React app with an avatar.” It is four systems joined by contracts:

```text
Product UI  ──HTTP/JSON──  Translation API  ──manifest──  Motion assets
                                    ↑                          ↓
                              LLM/OCR/STT                 VRM player
                                    ↑                          ↓
                              Uploaded media          Three.js scene

Offline computer-vision pipeline ──generates───────────────┘
```

Each system can be learned and tested separately. The project becomes manageable when the boundaries are explicit:

- text enters the API as text;
- the translation layer returns an ordered gloss sequence;
- the manifest maps glosses to real motion files;
- a motion file contains time-series joint rotations;
- the renderer applies rotations to a known humanoid skeleton.

That is the engineering pattern to remember: define a stable data contract before implementing the next layer.

## 2. What you need to learn first

You do not need to master everything before starting. Learn enough of each topic to build a thin vertical slice, then deepen the topic when the slice exposes a real problem.

### Core foundations

- Python: functions, classes, exceptions, typing, virtual environments, file I/O;
- JavaScript: modules, promises, async/await, arrays/objects, browser APIs;
- React: components, props, state, effects, refs, controlled inputs;
- HTTP: requests, responses, JSON, status codes, multipart uploads, CORS;
- SQL basics: tables, primary keys, foreign keys, indexes, transactions;
- Git: commits, branches, diff, status, merge/rebase concepts;
- 3D basics: vectors, coordinate systems, transforms, quaternions, skeletal hierarchies;
- testing: unit tests, fixtures, boundary tests, integration tests, smoke tests.

### The correct learning order

1. Build a static page.
2. Build a backend health endpoint.
3. Call the endpoint from the page.
4. Load one hard-coded motion file.
5. Play one motion on one avatar.
6. Add a manifest and multiple clips.
7. Add text-to-gloss selection.
8. Add the offline video pipeline.
9. Add uploads, auth, history, and deployment.

This order gives you a working result at every stage and makes failures local.

## 3. Phase 0 — Define the problem correctly

Before writing code, answer:

- Who is the user?
- What input do they have?
- What output is useful to them?
- Is the output real-time or prerecorded?
- What must work without internet?
- What counts as “correct” for a sign-language clip?
- What data can be stored, and for how long?
- Which language/dataset are you actually targeting?

For this project, the practical first product requirement is:

> Given a sentence composed of supported concepts, play an ordered sequence of local avatar clips in the browser.

That requirement is much narrower than “translate any language to fluent ISL.” The narrower requirement is buildable and testable. It also exposes where a true translation system must later be added.

### Engineering output of Phase 0

Write a one-page specification containing:

- supported input types;
- supported gloss vocabulary;
- response shape;
- latency target;
- offline behavior;
- success/failure examples;
- privacy assumptions;
- a five-clip golden test set.

## 4. Phase 1 — Create the smallest repository

Start with a clean layout:

```text
project/
  backend/
  frontend/
  converter/
  tests/
  README.md
  .env.example
  .gitignore
```

The current project follows this general structure. The purpose of the split is ownership:

- `frontend` handles interaction and rendering;
- `backend` handles network and persistence boundaries;
- `converter` handles expensive offline data preparation.

Do not begin by adding every library. Start with only:

- FastAPI + Uvicorn;
- React + Vite;
- Three.js + VRM loader;
- a test runner in each language.

Add database, LLM, OCR, MediaPipe, and ffmpeg support only when the first simple path works.

### First milestone

The backend should return:

```json
{"status":"ok"}
```

The frontend should render a button that calls it. This teaches the complete frontend/API/CORS loop before 3D complexity appears.

## 5. Phase 2 — Design the data contracts

### Translation contract

Keep the first contract small:

```json
{
  "text": "book drink book",
  "glosses": ["book", "drink", "book"],
  "motion_paths": [
    "/motion/clips/book.json",
    "/motion/clips/drink.json",
    "/motion/clips/book.json"
  ],
  "status": "ready",
  "unknown_glosses": [],
  "provider": "manifest"
}
```

Important invariants:

- order is preserved;
- repetition is preserved;
- every ready motion path exists;
- unknown glosses are visible to the user;
- provider identity is diagnostic metadata, not a correctness claim.

### Motion contract

The current motion format is conceptually:

```json
{
  "version": "1.0",
  "name": "book",
  "fps": 30,
  "frame_count": 75,
  "coordinateSystem": {
    "name": "threejs",
    "rotationSpace": "world_delta"
  },
  "frames": [
    {
      "joints": {
        "LEFT_ELBOW": {
          "rotation": {"x": 0, "y": 0, "z": 0, "w": 1}
        },
        "LEFT_WRIST": {
          "rotation": {"x": 0, "y": 0, "z": 0, "w": 1},
          "tracked": true
        }
      }
    }
  ]
}
```

Do not hide coordinate-system assumptions in code. Store them in the asset metadata and validate them when loading.

### Manifest contract

A manifest is the index between language and files:

```json
{
  "gloss": "computer",
  "slug": "computer",
  "videoIds": ["12315", "12314"],
  "motionVariants": [
    {
      "videoId": "12315",
      "motionPath": "/motion/clips/12315.json",
      "landmarkPath": "/motion/landmarks/12315.json",
      "status": "ready"
    }
  ]
}
```

Without this index, the UI would need to guess filenames and the API would not know which glosses are actually available.

## 6. Phase 3 — Build one avatar and one motion

### Load the VRM

`frontend/src/core/AvatarLoader.js` uses `GLTFLoader` with `VRMLoaderPlugin`. Learn the load sequence:

1. fetch a binary asset;
2. parse GLTF/VRM metadata;
3. get `gltf.userData.vrm`;
4. add `vrm.scene` to a Three.js scene;
5. call `vrm.update(deltaTime)` each frame;
6. dispose geometry/materials when replacing the avatar.

The important engineering habit is lifecycle ownership. If you load a new avatar, remove and dispose the old scene or GPU memory accumulates.

### Map project joints to humanoid bones

The source motion data should not use arbitrary VRM node names. Use canonical project names such as `LEFT_SHOULDER`, then map them in one place through `BoneMapper`.

Why this matters:

- the converter does not need to know every avatar’s internal node name;
- the player can support multiple compatible avatars;
- missing bones can be logged and handled gracefully;
- tests can target canonical names.

### Apply a hard-coded pose

Before reading a file, rotate the left upper arm by a known amount. This isolates skeleton mapping from file loading and landmark math. `DebugPoseController.js` demonstrates this kind of small diagnostic tool.

If the hard-coded arm does not move correctly, do not debug MediaPipe or LLMs yet. Fix the skeleton mapping first.

## 7. Phase 4 — Understand the render loop

The animation loop is a repeated time step:

```text
requestAnimationFrame
    ↓
delta = clock.getDelta()
    ↓
motionPlayer.update(delta)
    ↓
vrm.update(delta)
    ↓
sceneManager.update(delta)
    ↓
renderer.render(scene, camera)
```

The current project separates this in `animationLoop.js`.

### Why delta time matters

If you advance one frame per browser callback, the motion speed changes with monitor refresh rate and system load. Instead:

```text
elapsed += deltaSeconds × playbackRate
frameDuration = 1 / motionFPS
while elapsed >= frameDuration:
    elapsed -= frameDuration
    currentFrame += 1
```

This keeps a 30 FPS motion at the same real-world speed on a 60 Hz or 144 Hz display.

### Why interpolation matters

At most browser frames, the current time lies between two motion samples. Interpolate:

- positions with linear interpolation;
- rotations with quaternion slerp.

Never linearly interpolate quaternion components without normalizing and accounting for the double-cover sign. The current player flips the second quaternion when its dot product is negative before slerping.

## 8. Phase 5 — Learn coordinate systems and retargeting

This is the hardest technical part of the project.

### A landmark is not a bone rotation

MediaPipe gives points. An avatar needs bone transforms. For an arm:

```text
upper-arm direction = elbow - shoulder
forearm direction   = wrist - elbow
```

For a finger segment:

```text
segment direction = end landmark - start landmark
```

You then need a rotation that takes the avatar’s rest direction to the observed direction.

### Coordinate conversion

The project converts input coordinates with `x, -y, -z`. If you forget this, motion may appear mirrored, upside down, or rotated 180 degrees.

Debug coordinate systems with a synthetic pose:

- a straight arm along +X;
- a palm facing +Z;
- a known 90-degree rotation;
- a known identity quaternion.

### Direction quaternion

For normalized source vector `a` and target vector `b`, a quaternion can be built from the cross product and dot product. Handle these edge cases explicitly:

- vectors already aligned → identity quaternion;
- vectors opposite → choose a stable perpendicular axis;
- zero-length vectors → use a documented fallback.

That is why `motion_builder.py` contains robust normalization and opposite-vector handling.

### Why bases are better than directions

A single direction does not define roll around that direction. Build an orthonormal basis:

```text
forward = finger direction
across  = palm-across vector, projected perpendicular to forward
normal  = forward × across
```

Compute the rotation from the source basis to the target basis. This retains twist. The project’s regression test specifically catches the bug where a middle finger would incorrectly lose roll.

### Rest pose calibration

Every avatar may have different bone orientation conventions. The current branch calibrates source finger directions from the default conversion avatar and derives rest geometry for the loaded target avatar, but it does not yet complete a general source-to-target use of the clip’s stored `fingerRestForwards` metadata. Treat multi-avatar retargeting as a follow-up engineering task and visually validate each avatar.

This is the general retargeting recipe:

1. define source rest frame;
2. define target rest frame;
3. express motion as a delta from source rest;
4. apply that delta to target rest;
5. convert world target back into local bone space.

## 9. Phase 6 — Build the offline vision pipeline

Do not run expensive landmark extraction in the browser for prerecorded clips. Convert once and ship the result.

### Extraction steps

1. Load an indexed video path.
2. Open it with OpenCV.
3. Read source FPS and frame count.
4. Sample to a target FPS.
5. Run MediaPipe Pose and Hands.
6. Store raw world landmarks and detection counts.
7. Release the video capture in a `finally` block.

### Why save raw landmarks?

If you save only final quaternions, every builder change requires rerunning MediaPipe. Saving raw landmarks lets you rebuild motion quickly after changing:

- rest axes;
- smoothing;
- hand-loss logic;
- bend constraints;
- coordinate transforms;
- metadata.

That is the reason for both `clips` and `landmarks` folders.

### Stabilization strategies

Use separate concepts:

- smoothing reduces measurement noise;
- tracking state says whether a sample is trustworthy;
- hold logic bridges short gaps;
- rejection logic removes impossible geometry;
- a step limit prevents visible pops.

Do not use smoothing as a substitute for tracking state. Averaging a valid hand with a missing hand can invent a pose.

### Batch processing

`convert_motion.py` supports limits, workers, overwrite behavior, video roots, incremental timestamps, and a report. Start with one clip, then five golden clips, then a small batch, then the full library.

The correct progression is:

```text
one clip → five golden clips → 25 clips → full dataset
```

At each stage inspect both metrics and actual playback.

## 10. Phase 7 — Add a manifest and deterministic translation

Start with local matching before an LLM. A local matcher provides:

- a no-key development path;
- deterministic tests;
- no network latency;
- an offline fallback when the provider is down.

The current matcher normalizes words and common inflections, prefers phrases, and preserves repeated matches.

Then add a provider interface:

```python
class Provider:
    def translate(text, available_glosses, language="en") -> list[str]: ...
```

Implement providers behind that interface. The route should not know whether the result came from a manifest matcher, Gemini, or OpenAI.

### Why structured output?

Free-form model text forces you to parse prose, code fences, punctuation, and hallucinated labels. A strict JSON schema makes the expected shape explicit. It does not make the model trustworthy by itself; manifest resolution remains mandatory.

### What this is not

Word matching and LLM gloss selection are not full sign-language translation. A real system needs:

- language-specific grammar;
- temporal/aspectual meaning;
- signer variation;
- non-manual markers such as face/head/body movement;
- classifiers and spatial reference;
- human evaluation by fluent signers.

Treat the current language layer as a versioned prototype boundary that can later be replaced.

## 11. Phase 8 — Add the FastAPI service

Create routes around domain operations, not UI screens:

- health/status;
- translate text;
- upload and normalize documents/media;
- auth;
- history;
- media conversion.

Use Pydantic models at the HTTP boundary and plain service functions beneath them. This makes it possible to unit-test translation and input processing without starting a web server.

### Error design

Return stable error codes, not only English strings:

```json
{
  "detail": {
    "code": "unknown_gloss",
    "message": "No motion clip was found for ..."
  }
}
```

Map provider timeouts, invalid keys, malformed output, unsupported uploads, and missing clips to intentional status codes.

### Boundary validation

Validate:

- request lengths;
- file extensions;
- file bytes/signatures;
- upload size while streaming;
- extracted text length;
- provider response shapes;
- manifest paths before returning them.

Validation is cheaper and safer at the boundary than after bad data reaches the renderer.

## 12. Phase 9 — Add persistence and authentication

The current backend uses:

```text
User 1 ─────── * HistoryEntry
```

Use a password hash, never a plaintext password. Put only a user id and expiry in a short-lived JWT. Protect user-scoped database queries with a dependency that resolves the current user.

Before shipping, make one deliberate choice:

### Option A: local-first prototype

- keep history and preferences in localStorage;
- remove or clearly label backend history/auth as future work;
- do not pretend settings are synchronized.

### Option B: account-backed product

- install an Axios interceptor that sends `Authorization: Bearer ...`;
- fetch `/api/auth/me` on app start;
- protect workspace routes or show an intentional guest mode;
- replace local history operations with `/api/history` calls;
- define token expiry/logout behavior.

The current project is between these two options. Resolving that ambiguity is a high-value engineering task.

## 13. Phase 10 — Add uploads and browser media

### Documents

For TXT, decode UTF-8. For DOCX, remember that it is a ZIP package containing XML. For PDF, use a real parser. Always normalize whitespace and enforce a maximum extracted text size.

### Images

Separate image validation from OCR. A valid PNG/JPEG is not proof that OCR succeeded. In local manifest mode, report that OCR is unavailable instead of returning a fake result.

### Speech

Use browser speech recognition as an enhancement, not the only source of truth. The browser may not support it, may lose permission, or may stop unexpectedly. Record audio separately and provide provider-backed transcription when configured.

### Video recording

Canvas video capture is a browser capability. Probe supported MIME types and give the user a WebM fallback. Server-side MP4 conversion should run with a fixed argument list, timeout, size limit, and cleanup task.

## 14. Phase 11 — Build a real product shell

Only after the core path works, add:

- routes and navigation;
- input workflows;
- status diagnostics;
- camera presets;
- avatar selector;
- background themes;
- local preferences;
- reduced-motion support;
- empty/error/loading states;
- mobile layouts.

The product shell is not decoration. It communicates system state. A user should know:

- whether the API is reachable;
- which provider answered;
- whether a gloss has a clip;
- whether an avatar is loading;
- whether a recording is complete;
- whether the current result is partial.

## 15. Phase 12 — Test like an engineer

### Unit tests

Test pure functions first:

- word normalization and inflection matching;
- provider selection;
- structured response parsing;
- upload signatures;
- quaternion edge cases;
- frame interpolation;
- tracking-loss behavior;
- manifest resolution.

### Integration tests

Use FastAPI `TestClient` and mocked HTTP transports. Verify:

- health/status;
- auth registration/login;
- translation response shape;
- unknown gloss reporting;
- upload rejection;
- mocked Gemini/OpenAI response parsing;
- protected history ownership.

### Golden motion tests

Keep five representative clips:

- one-handed sign;
- two-handed sign;
- crossing hands;
- occlusion/dropout;
- a clip with multiple variants.

Measure quaternion jumps, valid detection percentage, missing finger rate, and torso clearance. Then open the browser and inspect them visually. Numeric metrics cannot detect every semantic or visual error.

### End-to-end tests

Automate:

1. open the app;
2. enter a sentence;
3. click Translate;
4. wait for a sequence;
5. check that the avatar stage becomes ready;
6. switch camera/avatar/display modes;
7. save and reopen history;
8. export a short recording where the browser supports it.

## 16. Phase 13 — Package and deploy safely

Before Docker:

- make paths configurable;
- do not depend on the source repository layout inside the image;
- copy migrations explicitly;
- include only runtime dependencies in the API image;
- keep converter dependencies separate;
- decide how generated motion assets are restored;
- add a healthcheck that tests the actual app;
- run a Compose smoke test in CI.

The current Docker files reveal a classic packaging lesson: code can work locally because the repository root and virtual environment hide path assumptions. A container exposes those assumptions immediately. Test the container, not only the source tree.

## 17. A practical debugging method

When something fails, locate the first broken contract.

### Avatar is blank

1. Is the VRM request HTTP 200?
2. Does `gltf.userData.vrm` exist?
3. Is the scene added to the current Three.js scene?
4. Is the camera aimed at the avatar?
5. Are materials/lights visible?
6. Is the avatar scene hidden because display mode is landmark?

### Avatar loads but does not move

1. Did the manifest load?
2. Did the motion JSON load?
3. Is `frame_count > 0` and FPS valid?
4. Is `MotionPlayer.playing` true?
5. Does `BoneMapper` find the arm/hand bones?
6. Is the motion quaternion being interpreted in the correct space?

### Fingers twitch

1. Inspect raw landmarks.
2. Check handedness and coordinate transforms.
3. Check tracking flags.
4. Check quaternion sign continuity.
5. Check interpolation across dropouts.
6. Compare source rest axes with the loaded avatar.
7. Change one stabilizer at a time and rerun the golden tests.

### Translation works only sometimes

1. Check `/api/health` and `/api/status`.
2. Inspect selected provider and key configuration.
3. Test local `manifest` mode.
4. Check frontend timeout versus provider timeout.
5. Inspect `unknown_glosses`.
6. Verify the motion file exists, not only the gloss name.

### Docker works differently from local

1. Print resolved settings inside the container.
2. List the expected manifest and migration paths.
3. Confirm volume mount paths.
4. Confirm the image contains `migrations` and `alembic.ini`.
5. Confirm the browser can reach the API hostname/port.

## 18. How to improve yourself as a software engineer

### Stop thinking only in features

For every feature, ask:

- What is the input contract?
- What is the output contract?
- What can fail?
- How is failure shown?
- How is it tested?
- What data is stored?
- What happens on retry?
- What happens when the dependency is unavailable?

### Read code by tracing one request

For SignStream, read in this order:

1. `frontend/src/pages/TranslatePage.jsx` — user intent;
2. `frontend/src/services/apiClient.js` — network call;
3. `backend/app/api/routes.py` — endpoint;
4. `backend/app/llm.py` — provider boundary;
5. `backend/app/services.py` — manifest resolution;
6. `frontend/src/components/avatar/AvatarViewport.jsx` — bridge back into rendering;
7. `frontend/src/animation/AnimationEngine.js` — orchestration;
8. `frontend/src/core/MotionLoader.js` — asset contract;
9. `frontend/src/animation/motionPlayer.js` — time;
10. `frontend/src/animation/PoseApplier.js` — transforms.

This teaches you to follow data across languages and processes.

### Keep an engineering notebook

For every bug record:

```text
Symptom:
Minimal reproduction:
Broken invariant:
Root cause:
Fix:
Regression test:
What I would redesign next time:
```

The project’s hand-motion history demonstrates this style: identify noisy rotations, investigate handedness, stabilize quaternions, add arm targets, gate quality, and preserve provenance.

### Prefer measurements to impressions

Instead of “the motion seems smoother,” record:

- mean and p95 angular step;
- max angular step;
- percentage of valid hand frames;
- number of dropouts;
- number of unknown glosses;
- API latency;
- provider error rate;
- asset load time;
- frame rate.

Then still perform human visual review. Measurements guide you; they do not replace judgment.

### Make one change at a time in difficult math

If you change coordinate conversion, smoothing, rest axes, interpolation, and hand correction in one commit, you cannot know which change helped. Use small commits and synthetic tests.

### Build fallback paths intentionally

The local manifest provider is a good pattern. For every external dependency, decide:

- can the feature be disabled?
- can the user continue with a local path?
- what status is shown?
- what data is safe to retain?

## 19. Recommended learning exercises

Do these in order:

1. Add a `GET /api/motions/{gloss}` endpoint that returns one manifest entry.
2. Add a frontend motion search box that finds a gloss without an LLM.
3. Write a test for a repeated phrase with punctuation.
4. Add a synthetic quaternion test for aligned and opposite vectors.
5. Add an FPS-independent playback test with fake delta times.
6. Add a checked-in three-frame motion fixture.
7. Add an Axios bearer-token interceptor and a logout button.
8. Replace local history with the backend history API.
9. Add a converter requirements file and document a fresh environment install.
10. Repair the Dockerfile and write a Compose health smoke test.
11. Add a quality-gate report page for one selected variant.
12. Convert the manifest and motion types to TypeScript/Zod shared schemas.

Each exercise teaches a real engineering boundary and produces a visible improvement.

## 20. Suggested four-week study plan

### Week 1: Web foundation

Learn HTTP, FastAPI routes, React state/effects, Axios, CORS, and Git. Build a text input that calls a health/translation endpoint.

### Week 2: 3D foundation

Learn Three.js scenes, cameras, lights, render loops, vectors, local/world transforms, and quaternions. Load the VRM and apply a synthetic arm pose.

### Week 3: Data and computer vision

Learn landmark arrays, OpenCV frame sampling, MediaPipe outputs, smoothing, missing-data handling, and manifest generation. Convert and play five clips.

### Week 4: Product engineering

Learn uploads, JWTs, SQLAlchemy/Alembic, testing layers, Docker paths, observability, and CI. Integrate one provider, then verify local fallback and failure behavior.

## 21. Alternatives you should evaluate when the prototype grows

### If motion quality is the priority

Invest in better landmark tracking, temporal models, full-body/face landmarks, avatar-specific calibration, signer review, and compact animation formats before adding more UI.

### If linguistic quality is the priority

Replace word matching with a versioned language pipeline: normalization → language identification → grammar/semantic analysis → sign gloss generation → variant selection. Use fluent-signers’ evaluation data.

### If privacy is the priority

Use local OCR/STT/translation models, avoid sending media to remote providers, encrypt uploads, and define deletion policies.

### If scale is the priority

Move motion assets to object storage/CDN, use compressed/binary formats, queue OCR/conversion, add provider rate limits, use PostgreSQL everywhere, and add structured observability.

### If maintainability is the priority

Adopt TypeScript, shared schemas, smaller modules, ADRs, CI, contract tests, and a checked-in minimal fixture set.

## 22. Final mental model

When you look at this project, see the following layers:

```text
User experience
    ↓
React state and HTTP client
    ↓
FastAPI boundary and validation
    ↓
Translation/manifest domain logic
    ↓
Motion JSON contract
    ↓
Time-based playback
    ↓
Coordinate conversion and retargeting
    ↓
VRM skeleton and GPU rendering
```

The strongest next step for you is to trace one sentence through every layer, then rebuild that path yourself in a tiny branch with one avatar, three clips, and no LLM. Once you can explain and reproduce that vertical slice, the rest of SignStream becomes a set of understandable engineering expansions rather than a wall of files.
