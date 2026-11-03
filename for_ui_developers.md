# UI developer guide

## Run the UI (always port 3000)

Serve the static UI (repo root) on the fixed port 3000 — it matches the backend's default CORS origins (`http://localhost:3000`, `http://localhost:5173`). Other ports (5500, 5170, …) get rejected by CORS and login shows "Authentication service unavailable".

```bash
# 1. Backend (FastAPI) on http://localhost:8000 — see "Start and authenticate" below
# 2. UI server (run from the repo root):
python3 -m http.server 3000 --bind 127.0.0.1
# 3. Open http://localhost:3000

# Stop the server when done:
kill $(lsof -t -i:3000)
```

Note: open `http://localhost:3000`, not `http://127.0.0.1:3000` — the Origin sent to the backend must match the allowed origin string exactly.

## Start and authenticate

Copy `.env.example` to `.env`, set a private `QUES_JWT_SECRET`, change the development admin password, then run `docker compose up --build`. The local base URL is `http://localhost:8000`; interactive OpenAPI docs are at `/docs`.

Set `QUES_CORS_ORIGINS` to the frontend's origin when it is not on `localhost:3000` or `localhost:5173`.

Login with `POST /auth/login` and JSON `{ "email": "admin@example.com", "password": "admin123" }`. A successful response contains `access_token` and `token_type: "bearer"`. Send `Authorization: Bearer <access_token>` on every endpoint below. The token expires after `QUES_JWT_TTL_MINUTES`.

Success response: `{ "access_token": "<JWT>", "token_type": "bearer" }`. Invalid credentials return 401.

```js
const base = "http://localhost:8000";
const login = await fetch(`${base}/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@example.com", password: "admin123" })
});
const { access_token } = await login.json();
const headers = { Authorization: `Bearer ${access_token}` };
```

## Subjects and PDFs

`GET /health` is public and returns `{ "status": "ok" }`.

`GET /subjects` returns `{ "subjects": ["OperatingSys"] }`.

`POST /subjects` creates a subject and its folders. Body: `{ "name": "NewSubject" }`. Response (201) includes the folder paths. An existing name returns 409. Names may use letters, numbers, spaces, underscores, and hyphens.

Example responses: `GET /subjects` → `{ "subjects": ["OperatingSys"] }`; `POST /subjects` → `{ "name": "NewSubject", "created": true, "directories": { "source": ".../NewSubject/source", "scrapper": "...", "parser": "...", "reconstruct": "...", "manifests": "...", "logs": "...", "metadata": "..." } }`.

```js
const subjects = await fetch(`${base}/subjects`, { headers });
const created = await fetch(`${base}/subjects`, {
  method: "POST", headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "NewSubject" })
});
```

`POST /subjects/{subject}/pdfs` accepts multipart form data with one or more repeated `files` fields. Only valid PDFs up to `QUES_MAX_UPLOAD_MB` (50 MB by default) are accepted. Existing filenames are never overwritten. Response (201) lists the stored filename, byte size, and path.

```js
const form = new FormData();
for (const file of fileInput.files) form.append("files", file);
const upload = await fetch(`${base}/subjects/OperatingSys/pdfs`, {
  method: "POST", headers, body: form
});
```

`GET /subjects/{subject}/pdfs` lists that subject's PDFs and their latest processing state.

Each item contains `filename`, `size_bytes`, `status`, `job_id`, and `result_available`.

```js
const pdfs = await fetch(`${base}/subjects/OperatingSys/pdfs`, { headers });
```

## Process and retrieve results

`POST /subjects/{subject}/pdfs/{filename}/process` starts a fresh Scrapper → Parser run and returns HTTP 202 with `{ "job_id", "status", "subject", "filename" }`. Body `{ "force": true }` requests a fresh run even if a successful result exists. If omitted, `force` defaults to true. A PDF already running returns 409.

```js
const started = await fetch(`${base}/subjects/OperatingSys/pdfs/paper.pdf/process`, {
  method: "POST", headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ force: true })
});
const { job_id } = await started.json();
```

`GET /jobs/{job_id}` returns `queued`, `running`, `succeeded`, or `failed`, the active stage, timestamps, error summary, and output metadata on success. The PDF-specific status is also available at `GET /subjects/{subject}/pdfs/{filename}/status`.

The job response includes `job_id`, `subject`, `filename`, `status`, `stage`, `started_at`, `updated_at`, `error`, and `result`. On success, `result` includes paths for the scraper JSON, manifest, parsed JSON, page count, question count, and providers used.

```js
const status = await fetch(`${base}/jobs/${job_id}`, { headers });
```

`GET /subjects/{subject}/pdfs/{filename}/result` returns parsed JSON path, question count, and processing metadata. Add `?include_questions=true` to include all structured questions.

```js
const result = await fetch(
  `${base}/subjects/OperatingSys/pdfs/paper.pdf/result?include_questions=true`, { headers }
);
```

## Reconstruct

`POST /subjects/{subject}/pdfs/{filename}/reconstruct` generates the full DOCX and returns its path, counts, and any missing assets or warnings.

Its JSON response contains `docx_path`, `question_count`, `subquestion_count`, `figures_inserted`, `warnings`, and `missing_assets`. Download returns the DOCX bytes with the standard Word MIME type.

```js
const docx = await fetch(`${base}/subjects/OperatingSys/pdfs/paper.pdf/reconstruct`, {
  method: "POST", headers
});
```

Download the completed document from `GET /subjects/{subject}/pdfs/{filename}/reconstruction` with the same bearer header. It returns the DOCX file (404 if reconstruction has not run).

## Responses and errors

| Status | Meaning |
| --- | --- |
| 200 / 201 / 202 | Read or operation accepted (201 creates/uploads; 202 starts background processing) |
| 401 | Missing/invalid token or incorrect login |
| 404 | Subject, PDF, job, or parsed result not found |
| 409 | Existing subject, duplicate filename, active job, or `force: false` for a completed PDF |
| 413 / 415 / 422 | Upload too large, not a PDF, or invalid name/request |
| 500 | Unexpected server error; check the subject `logs/` folder |

The UI flow is: login → create or list a subject → upload PDF → start processing → poll job status → read result metadata/questions → optionally request DOCX reconstruction. Do not include passwords in logs or client-side source code.


## Question priorities (added 2026-10-29)
- `GET /api/question-priorities?subject_id=` returns `{"subject_id", "default_priority": 1, "priorities": {"<question_id>": 1|2|3}}`.
- `PUT /api/question-priorities` with body `{"question_id", "priority", "subject_id"}` (subject_id optional) saves a priority and returns `{"question_id", "subject_id", "priority", "updated": true}`.
- `DELETE /api/question-priorities/{question_id}?subject_id=` resets a priority to 1 and returns `{"question_id", "subject_id", "priority": 1, "reset": true}`.

## Generate Question Paper and blueprints (added 2026-10-29)
- Proposed endpoints documented in backend_services.md (S25).
- Frontend form collects title, subject, exam type, total marks, duration, blueprint, and sections.
- Section totals are calculated as questions × marks each and must equal total marks.
