# SignStream

SignStream is a browser-based sign language workspace built around the existing Three.js VRM animation engine.

## Learning documents

- [Complete project report](PROJECT_REPORT.md)
- [From-zero engineering guide](PROJECT_FROM_ZERO_ENGINEERING_GUIDE.md)

## Local development

Start the API from the project root:

```powershell
.\bs\Scripts\python.exe -m uvicorn app.main:app --reload --app-dir backend --port 8000
```

Start the frontend in a second terminal:

```powershell
Set-Location frontend
npm run dev
```

The API exposes interactive documentation at `http://localhost:8000/docs`.

## LLM configuration

The default `LLM_PROVIDER=auto` mode uses Gemini or OpenAI when its server-side key is configured and otherwise falls back to deterministic local matching. To enable semantic gloss translation, copy `.env.example` to `.env` and place the key only in the root `.env` file:

```powershell
Copy-Item .env.example .env
notepad .env
```

Use `LLM_PROVIDER=gemini` with `GEMINI_API_KEY` and `GEMINI_MODEL`, or `LLM_PROVIDER=openai` with `OPENAI_API_KEY` and `OPENAI_MODEL`. The API reads these server-side; never add them to `frontend/.env` or a `VITE_` variable.

Open `/status` in the web app to inspect the active provider, model, key configuration, response state, latency, request counts, and token usage. Set `LLM_TOKEN_BUDGET` to a positive local session budget if you want the page to calculate a local “tokens left” value. OpenAI and Gemini do not expose account quota remaining through these translation requests, so provider quota is shown as unavailable.

Provider smoke tests use mocked responses and require no network or API key:

```powershell
.\bs\Scripts\python.exe -m pytest -q backend/tests/test_llm.py
```

## Database

Local development defaults to SQLite at `backend/signstream.db`; migrations run automatically on API startup. The migration files are in `backend/migrations` and can also be applied manually from `backend` with `alembic upgrade head`.

Docker Compose starts PostgreSQL and creates the `signstream` database from the values in `docker-compose.yml`. The API applies migrations automatically. For an externally managed PostgreSQL server, create the database and user first, set `DATABASE_URL`, and start the API.

## Production build

```powershell
Set-Location frontend
npm run lint
npm run build
```

The static production bundle is written to `frontend/dist`.

Run the complete local validation from the project root:

```powershell
.\bs\Scripts\python.exe -m pytest -q backend
Set-Location frontend
npm run lint
npm run build
```

Text, TXT, DOCX, and PDF inputs are normalized by the API when their required extractors are installed. Image OCR and uploaded speech transcription use the configured Gemini or OpenAI provider. The browser speech workflow also shows live recognition when supported, then sends a WebM/M4A recording to the API. Video export records the rendered avatar canvas as WebM from the translation studio.

## Docker

Copy `.env.example` to `.env`, replace the secret, and run:

```powershell
docker compose up --build
```

The web app is served on port `80` and the API on port `8000`.

## Runtime assets

The browser requires the generated files under `frontend/public/motion`. The default avatar is `frontend/public/avatar.vrm`; place additional `.vrm` files anywhere under `frontend/public` (preferably `frontend/public/avatars`) and run `npm run dev` or `npm run build` from `frontend`. The avatar catalog is regenerated automatically and the studio selector will make each file available to the user. The converter and raw source videos are offline pipeline assets and are not imported by the web application.

## Fine-tuned motion coverage

The full motion library remains one unified dataset under `frontend/public/motion`. The 200 selected glosses from `WLASL_top2.json` have been fine-tuned in place inside the normal `clips` and `landmarks` folders. The remaining library files and manifest entries are unchanged, so the application always loads the single full manifest at `/motion/manifest.json`.
