# Sauti Sounds

Prototype hybrid player: React/Vite frontend, FastAPI backend, local-library workflow, and TIDAL-backed search/playlists.

## Local development

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --env-file backend/.env --reload --host 0.0.0.0 --port 8000
```

Set `VITE_API_BASE_URL=http://127.0.0.1:8000` in a local `.env`.

## Railway deployment

The repo is configured for a single-service Railway deployment:

- `Dockerfile` builds the Vite frontend and serves it from FastAPI.
- `railway.toml` points Railway at the Dockerfile and healthchecks `/api/health`.
- In production, `VITE_API_BASE_URL` should be left empty so the frontend talks to the API on the same origin.

Recommended Railway service variables:

```bash
APP_SESSION_SECRET=<random secret>
PLAYBACK_TOKEN_SECRET=<random secret>
AUTH_INVITE_CODE=<shared invite code for account creation>
AUTH_MAX_USERS=2
COOKIE_SECURE=true
TIDAL_QUALITY=HIGH
```

Recommended database:

- Add a Railway Postgres service.
- Point this app service's `DATABASE_URL` at the Postgres connection string instead of using the default SQLite fallback.
