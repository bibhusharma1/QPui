# Automated Question Paper Generator

Smart QPG is an AI-assisted question paper generator for teachers and academic administrators. It reads previous-year question papers, extracts questions, builds a question bank, and generates balanced papers from a configurable blueprint.

## Main technologies

- **Frontend:** Plain HTML, CSS, and JavaScript (single-page app, no build step). Served as static files.
- **Backend:** FastAPI (Python) on `http://localhost:8000`, with SQLite/Turso storage and file-based question banks.
- **Deployment:** Vercel / GitHub Pages (static frontend) plus a FastAPI backend.

## Basic architecture

The active frontend is a single-page app made of three files:

- `index.html` — the app shell: login screen, all page sections, dialogs.
- `script.js` — all logic: API helper, routing, state, pages, polling.
- `style.css` + `styles/glass.css` — styling.

A second `frontend/` folder contains an incomplete modular redesign (ES modules). It is **not** the served entry point and is not active.

```text
Browser (index.html + script.js)
        | fetch + Bearer token
        v
FastAPI backend (http://localhost:8000)
        |--> SQLite (users, jobs, teachers, ...)
        |--> JSON files (question banks, blueprints, priorities)
        '--> File storage (PDFs, DOCX)
```

## How the frontend talks to the backend

All requests go through `api()` / `apiRequest()` in `script.js`. The helper:

- Attaches `Authorization: Bearer <token>` from `sessionStorage`.
- Sends JSON for bodies, or `FormData` for file uploads.
- Parses JSON / text / blob responses.
- On `401`, clears the session and returns to the login page.

The backend base URL defaults to `http://localhost:8000` and can be switched to the production Render backend from the sidebar selector. See `docs/backend-integration.md`.

## Run it locally

1. Start the backend (FastAPI on `http://localhost:8000`).
2. Serve the UI from the repo root on port 3000 (the backend's CORS allow-list includes this origin):

```bash
python3 -m http.server 3000 --bind 127.0.0.1
```

3. Open `http://localhost:3000`.

Use port 3000 only — other ports are rejected by CORS and login fails with "Authentication service unavailable". See `docs/development-guide.md`.

## Environment configuration

- Frontend API base: `window.QPG_API_BASE` / `meta[name="qpg-api-base"]` / default `http://localhost:8000`.
- Backend settings live in the backend `.env` (`QUES_JWT_SECRET`, `QUES_CORS_ORIGINS`, `QUES_STORAGE_ROOT`, ...). See `docs/deployment.md`.

## Deployment

- Frontend: static files on Vercel / GitHub Pages. `vercel.json` and `_redirects` rewrite all app routes to `/index.html`.
- Backend: FastAPI/uvicorn container or service. See `docs/deployment.md`.

## Documentation

- [Architecture](docs/architecture.md)
- [Frontend structure](docs/frontend-structure.md)
- [Application flow](docs/application-flow.md)
- [Authentication and permissions](docs/authentication-permissions.md)
- [Backend integration](docs/backend-integration.md)
- [Backend services reference](docs/backend-services.md)
- [Reconciliation contract](docs/reconciliation-contract.md)
- [Question bank](docs/question-bank.md)
- [Paper management](docs/paper-management.md)
- [Paper generation](docs/paper-generation.md)
- [UI and styling](docs/ui-and-styling.md)
- [Deployment](docs/deployment.md)
- [Development guide](docs/development-guide.md)
- [Complete workflow](docs/complete-workflow.md)