# Development guide

## 1. Prerequisites

- Python 3 + backend dependencies (FastAPI, uvicorn).
- A static file server for the frontend.

## 2. Run locally

1. Copy `.env.example` to `.env`, set `QUES_JWT_SECRET`, change the admin password.
2. Start the backend on `http://localhost:8000`.
3. Serve the UI on port 3000:

```bash
python3 -m http.server 3000 --bind 127.0.0.1
```

4. Open `http://localhost:3000`.

## 3. Login

Default admin: `admin@example.com` / `admin123` (change in production). Login requires email, password, and (once accepted) a six-digit TOTP code.

## 4. Project layout

- Active frontend: `index.html`, `script.js`, `style.css`, `styles/glass.css`.
- Backend: `src/masterdeorca/` (FastAPI app, services, database).
- Config: `config/`, `.env`.
- Docs: `docs/`.
- Tests: `tests/`.

## 5. Conventions

- No build step; edit files and refresh.
- All API calls go through `api()` in `script.js`.
- Use port 3000 for the UI to match CORS.
- Do not commit secrets or tokens.

## 6. Testing

- `node --check script.js` for syntax.
- `tests/pyq-status.test.js` for status helper.
- Backend tests under `tests/` if present.

## 7. Notes

- The `frontend/` tree is an incomplete modular redesign; not the active app.
- Many backend endpoints exist that the frontend does not use (topics, questions DB, papers DB, weightage, import). The frontend uses the JSON question bank.