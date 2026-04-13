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

## Cloudflare R2 (media storage)

Local audio files are uploaded to Cloudflare R2 so they persist across devices and browser sessions. If R2 is not configured, imported files fall back to IndexedDB blobs (per-device only).

Setup:

1. Create an R2 bucket in the Cloudflare dashboard.
2. Create an API token with **Object Read & Write** permissions for the bucket.
3. (Optional) Enable public access on the bucket and set `R2_PUBLIC_URL` to the public endpoint — this avoids presigned URL generation.
4. Set the environment variables:

```bash
R2_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<access-key-id>
R2_SECRET_ACCESS_KEY=<secret-access-key>
R2_BUCKET_NAME=sauti-sounds
R2_PUBLIC_URL=                          # optional, e.g. https://pub-xxx.r2.dev
```

Recommended database:

- Add a Railway Postgres service.
- Point this app service's `DATABASE_URL` at the Postgres connection string instead of using the default SQLite fallback.
