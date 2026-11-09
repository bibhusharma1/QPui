# Deployment

## 1. Frontend

Static files served from the repo root. Deployment targets:

- **Vercel**: `vercel.json` rewrites all app routes (`/dashboard`, `/subjects`, `/question-bank`, `/pyqs`, `/generate-paper`, `/my-papers`, `/teachers`, `/profile`, `/help`, `/activity`, `/settings`, `/login`) to `/index.html`.
- **GitHub Pages**: `.github/workflows/static.yml` uploads the whole repo.
- **Netlify-style**: `_redirects` provides the same rewrites.

The frontend must be served from an origin in the backend's CORS allow-list (default `http://localhost:3000`).

## 2. Backend

FastAPI/uvicorn. Configure via `.env`:

- `QUES_JWT_SECRET` (>= 32 chars, no "replace").
- `QUES_CORS_ORIGINS` (include the deployed frontend origin).
- `QUES_STORAGE_ROOT`, `QUES_DEFAULT_SUBJECT`, `QUES_DATABASE_PATH`.
- `QUES_ADMIN_EMAIL`, `QUES_ADMIN_PASSWORD`.
- `QUES_PORT` (default 8000).
- `QUES_MAX_UPLOAD_MB` (default 50).

## 3. Local run

```bash
# Backend
docker compose up --build   # or uvicorn on :8000

# Frontend (from repo root)
python3 -m http.server 3000 --bind 127.0.0.1
```

Open `http://localhost:3000` (not `127.0.0.1:3000` — the Origin must match the allow-list exactly).

## 4. Backend switching

The sidebar selector switches between Local (Docker, `http://localhost:8000`) and Production (Render, `https://qpengine-6f07.onrender.com`). Switching clears the session and reloads. The current base URL is shown in the sidebar footer.

## 5. Future cloud/Docker notes

- Frontend container: serve static files (nginx) on a port; inject `QPG_API_BASE` at runtime/build.
- Backend container: FastAPI/uvicorn image with env vars.
- Frontend never connects to Turso/SQLite directly; all data goes through backend APIs.
- File downloads (DOCX) rely on backend streaming.