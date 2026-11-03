# Automated-QuestionPaper-Generator
An AI-powered Smart Question Paper Generator that analyzes syllabi, previous year question papers, and question banks to generate balanced question papers based on topic weightage and difficulty level.

## Run the UI locally

The static frontend lives in this repo's root (`index.html`, `script.js`, `style.css`) and must be served from **`http://localhost:3000`** — that origin is in the backend's default CORS allow-list.

Start the backend first (FastAPI/uvicorn on `http://localhost:8000`), then serve the UI:

```bash
python3 -m http.server 3000 --bind 127.0.0.1
```

Then open **http://localhost:3000** in your browser.

Stop the UI server with `Ctrl+C` (foreground) or kill it in the background:

```bash
kill $(lsof -t -i:3000)
```

Never use other ports (5500/5173/etc.) for the UI — the backend would reject the requests with CORS errors and login would fail with "Authentication service unavailable".

See `FRONTEND_ARCHITECTURE.md` for the frontend architecture, backend communication, localhost/cloud transition and Docker preparation notes.

Login requires email, password, and (once the backend accepts the credentials) a six-digit TOTP code from your authenticator app.

