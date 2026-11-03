# Backend services required by the UI

Central record of every backend service the frontend depends on. Append new
entries at the end with the next number; never rewrite old entries — update
their **Status** line only.

- **UI repository:** this repository (`index.html`, `script.js`, `style.css`).
- **Backend repository:** maintained separately; not part of this workspace.
- **API summary source:** `for_ui_developers.md` (backend-authored contract).
- **Base URL:** `http://localhost:8000` (UI override: `window.QPG_API_BASE`).
- **Auth:** `POST /auth/login` returns a bearer token; send
  `Authorization: Bearer <token>` on every endpoint except `/health` and login.
- **Error format:** FastAPI-style `{"detail": "<message>"}`; the UI shows
  `detail` (or status text) in toasts / inline error states.

**Status legend**

| Mark | Meaning |
| --- | --- |
| Verified live | Documented in `for_ui_developers.md` **and** exercised against the running local instance on 2026-10-29 |
| Documented | Documented in `for_ui_developers.md`, not exercised by the UI work |
| Proposed | Required by a UI feature; contract defined here; **not yet implemented** — backend owner to build |

---

## Part A — Existing services (from `for_ui_developers.md`)

### S1 — Health check
- **Endpoint:** `GET /health` (public, no auth)
- **Response:** `{"status": "ok"}`
- **UI action:** none (manual/ops check)
- **Status:** Verified live 2026-10-29 → `200 {"status":"ok"}`

### S2 — Login (JWT)
- **Endpoint:** `POST /auth/login` (public)
- **Request:** `{"email": string, "password": string}`
- **Response 200:** `{"access_token": "<JWT>", "token_type": "bearer"}`
- **UI action:** login form submit
- **Observed JWT claims (live):** `sub` (the email), `iat`, `exp`. **No** `role`,
  `name`, or `email` claim — the UI therefore decodes `sub` for display and
  needs S10 for roles.
- **Errors:** 401 invalid credentials
- **Status:** Verified live 2026-10-29 → 200 with token

### S3 — List subjects
- **Endpoint:** `GET /subjects` (auth)
- **Response 200:** `{"subjects": ["OperatingSys", ...]}`
- **UI action:** dashboard list, subjects page, PYQ/question/syllabus/generate dropdowns
- **Status:** Verified live 2026-10-29 → shape confirmed

### S4 — Create subject
- **Endpoint:** `POST /subjects` (auth)
- **Request:** `{"name": string}` — letters, numbers, spaces, underscores, hyphens
- **Response 201:** `{"name": "...", "created": true, "directories": {...}}`
- **UI action:** "Create Subject" form on My Subjects
- **Errors:** 409 duplicate; 422 invalid name
- **Status:** Documented (UI wired; not exercised by UI work)

### S5 — Upload PDFs
- **Endpoint:** `POST /subjects/{subject}/pdfs` (auth)
- **Request:** multipart, repeated `files` fields; PDFs only, ≤ `QUES_MAX_UPLOAD_MB` (50 MB default); never overwrites existing filenames
- **Response 201:** list of stored files (`filename`, `size_bytes`, `path`)
- **UI action:** "+ Upload PDFs" on PYQs page (subject must be selected)
- **Errors:** 404 unknown subject; 409 duplicate filename; 413 too large; 415 not a PDF; 422 invalid
- **Status:** Documented (UI wired; not exercised by UI work)

### S6 — List PDFs of a subject
- **Endpoint:** `GET /subjects/{subject}/pdfs` (auth)
- **Response 200:** `{"subject": "...", "pdfs": [{"filename", "size_bytes", "status", "job_id", "result_available"}]}`
- **UI action:** PYQ table render on subject select
- **Live note:** observed `status: "not_processed"` (with `result_available: true`)
  — a state not listed in `for_ui_developers.md`; the UI maps it to a neutral
  "Not processed" pill. Doc gap, not a UI bug.
- **Status:** Verified live 2026-10-29 → shape + `not_processed` observed

### S7 — Start processing / poll job
- **Endpoint:** `POST /subjects/{subject}/pdfs/{filename}/process` (auth), body `{"force": true}` (default true)
- **Response 202:** `{"job_id", "status", "subject", "filename"}`
- **Endpoint:** `GET /jobs/{job_id}` (auth) → `{"job_id", "subject", "filename", "status": "queued|running|succeeded|failed", "stage", "started_at", "updated_at", "error", "result"}`
- **UI action:** "Process" button + 2 s polling loop
- **Errors:** 404 unknown subject/file; 409 already running (or `force:false` on completed)
- **Status:** Documented (UI wired; not exercised by UI work)

### S8 — Parsed result / questions
- **Endpoint:** `GET /subjects/{subject}/pdfs/{filename}/result?include_questions=true` (auth)
- **Response 200:** parsed metadata + `questions[]` when `include_questions=true`; `question_count`
- **UI action:** "Result" button → extracted-questions panel
- **Errors:** 404 no parsed result
- **Status:** Documented (UI wired; not exercised by UI work)

### S9 — DOCX reconstruction
- **Endpoint:** `POST /subjects/{subject}/pdfs/{filename}/reconstruct` (auth) → `{"docx_path", "question_count", "subquestion_count", "figures_inserted", "warnings", "missing_assets"}`
- **Endpoint:** `GET /subjects/{subject}/pdfs/{filename}/reconstruction` (auth) → DOCX bytes (`404` if not built)
- **UI action:** "DOCX" button (build then blob-download)
- **Status:** Documented (UI wired; not exercised by UI work)

---

## Part B — Proposed services (pending backend implementation)

Admin workflow services. Conventions for all Part B entries: bearer auth
required; `{"detail": "..."}` errors; ids are integers; subjects are addressed
by name (existing convention); filenames URL-encoded.

---

### S10 — Current user (role resolution)
- **Date:** 2026-10-29 · **Context:** admin workflow needs to distinguish admin vs teacher; login JWT carries no role claim (verified, S2)
- **Purpose:** return the authenticated user's profile and role so the UI can show/hide admin pages and fill profile screens
- **UI action:** on app load after login; falls back to JWT decode with `role = "admin"` assumed while S10 is missing (documented fallback, not a secret)
- **Endpoint:** `GET /auth/me`
- **Request:** — (bearer)
- **Response 200:**
  ```json
  {"id": 1, "email": "admin@example.com", "name": "Administrator", "role": "admin", "status": "active"}
  ```
  `role`: `"admin" | "teacher"`
- **DB:** users table — `id`, `email`, `name`, `hashed_password`, `role`, `status`
- **Validation:** token valid and not expired
- **Auth:** any authenticated user; returns only own record
- **Errors:** 401 missing/invalid token
- **Status:** Proposed — pending implementation

---

### S11 — Teacher management (admin)
- **Date:** 2026-10-29 · **Context:** "admin should read, create, edit, approve/disapprove, remove teachers"
- **Purpose:** CRUD + approval workflow for teacher accounts
- **UI action:** Teachers page — table render, "Add Teacher" dialog, per-row Approve / Disapprove / Edit / Remove (Remove asks confirmation)

**S11a — List** `GET /teachers?status=&search=&page=&page_size=`
- **Response 200:**
  ```json
  {"teachers": [{"id": 3, "name": "Rahul Kumar", "email": "rahul@example.com", "department": "CSE", "status": "pending", "subject_count": 0, "created_at": "2026-10-29T00:00:00Z"}], "total": 1}
  ```
  `status`: `"pending" | "approved" | "disapproved"`; filters optional; default `page_size` 50

**S11b — Create** `POST /teachers`
- **Request:** `{"name": string, "email": string, "department": string, "password": string, "status": "pending|approved"}` (password optional → invite/reset flow later; default status `pending`)
- **Response 201:** teacher object as in S11a
- **Errors:** 409 duplicate email; 422 validation

**S11c — Update / approve / disapprove** `PATCH /teachers/{teacher_id}`
- **Request:** any subset of `{"name", "email", "department", "status", "password"}`
- **Response 200:** updated teacher object
- **Note:** approval (`status: "approved"`) and disapproval (`status: "disapproved"`) are status changes through this endpoint — distinct from delete
- **Errors:** 404 unknown id; 409 duplicate email; 422 invalid

**S11d — Remove** `DELETE /teachers/{teacher_id}`
- **Response 204**; 404 unknown id; admin only
- **DB:** `teachers` table — `id`, `name`, `email` (unique), `department`, `hashed_password`, `status`, `created_at`
- **Validation:** name non-empty; email format + unique; department ≤ 64 chars; password ≥ 8 chars when provided
- **Auth:** **admin only** for all four operations
- **Status:** Proposed — pending implementation

---

### S12 — Question bank CRUD + approval
- **Date:** 2026-10-29 · **Context:** "extract and edit questions, assign questions to subjects and syllabus topics, approve/disapprove"
- **Purpose:** central question store fed by manual entry and PDF import (S13)
- **UI action:** Question Bank page — filters + table render, "Add Question" dialog, per-row Approve / Disapprove / Edit / Remove (confirm on remove)

**S12a — List** `GET /questions?subject=&status=&difficulty=&search=&page=&page_size=`
- **Response 200:**
  ```json
  {"questions": [{"id": 12, "subject": "OperatingSys", "topic_id": 4, "topic_name": "Scheduling", "text": "Explain round-robin scheduling.", "difficulty": "MEDIUM", "type": "LONG", "marks": 5, "status": "approved", "source": "pyq:operating_systems_regular_exam_text.pdf", "created_at": "..."}], "total": 1}
  ```
  `difficulty`: `EASY|MEDIUM|HARD`; `type`: `MCQ|SHORT|LONG|NUMERICAL`; `status`: `pending|approved|disapproved`; `source`: origin tag (`manual` or `pyq:<filename>`)

**S12b — Create** `POST /questions`
- **Request:** `{"subject": string, "topic_id": int|null, "text": string, "difficulty": "EASY|MEDIUM|HARD", "type": "MCQ|SHORT|LONG|NUMERICAL", "marks": int}`
- **Response 201:** question object (`status` starts `"pending"`)

**S12c — Update / approve / disapprove** `PATCH /questions/{question_id}`
- **Request:** any subset of create fields + `{"status": "pending|approved|disapproved"}`
- **Response 200:** updated question object
- **Errors (a–c):** 404 unknown id/subject; 422 validation

**S12d — Remove** `DELETE /questions/{question_id}` → 204; 404 unknown id
- **DB:** `questions` table — `id`, `subject_name` (FK→subjects), `topic_id` (FK→topics, nullable), `text`, `difficulty`, `type`, `marks`, `status`, `source`, `created_at`, `updated_at`
- **Validation:** `text` 1–2000 chars; `marks` 1–100; `topic_id` must belong to `subject` when set; enums as above
- **Auth:** list for any authenticated user; create/edit/approve/disapprove/delete **admin only**
- **Status:** Proposed — pending implementation. **Obsolete in UI** as of 2026-10-29 (manual Question Bank section removed; `/questions` no longer called by frontend).

---

### S13 — Import parsed questions into the question bank
- **Date:** 2026-10-29 · **Context:** PYQs page shows extracted questions (S8); admin wants them in the reviewable bank
- **Purpose:** copy the questions from a processed PDF's result into the question bank with `source = "pyq:<filename>"`, status `pending`
- **UI action:** "Import to Question Bank" button under the extracted-questions panel
- **Endpoint:** `POST /subjects/{subject}/pdfs/{filename}/questions/import`
- **Request:** `{"overwrite": false}` (optional; when true, replaces previously imported questions from this file)
- **Response 201:** `{"imported": 8, "skipped_duplicates": 1, "questions": [<S12 question objects>]}`
- **Errors:** 404 unknown subject/file or no parsed result; 409 already imported without `overwrite`
- **DB:** writes rows into `questions` (S12); idempotency via `(source, text)` uniqueness
- **Validation:** file must have a successful parse result
- **Auth:** admin only
- **Status:** Proposed — pending implementation

---

### S14 — Syllabus topics per subject
- **Date:** 2026-10-29 · **Context:** "managing … syllabus records", "assigning questions to … syllabus topics"
- **Purpose:** per-subject topic list that questions can be assigned to
- **UI action:** Syllabus page — subject select → topic list; add form; per-row Edit (dialog) / Remove (confirm)

**S14a — List** `GET /subjects/{subject}/topics`
- **Response 200:** `{"subject": "OperatingSys", "topics": [{"id": 4, "name": "CPU Scheduling", "unit": 2, "description": "…", "question_count": 7}]}`

**S14b — Create** `POST /subjects/{subject}/topics`
- **Request:** `{"name": string, "unit": int|null, "description": string|null}`
- **Response 201:** topic object

**S14c — Update** `PATCH /topics/{topic_id}` — subset of create fields → 200 topic object
**S14d — Remove** `DELETE /topics/{topic_id}` → 204
- **Errors (a–d):** 404 unknown subject/topic; 409 duplicate topic name within subject; 422 invalid
- **DB:** `topics` table — `id`, `subject_name` (FK), `name`, `unit` (nullable), `description` (nullable); unique `(subject_name, name)`
- **Validation:** `name` 1–120 chars; `unit` ≥ 1 when set
- **Auth:** list any authenticated user; create/edit/delete **admin only**
- **Status:** Proposed — pending implementation. **Obsolete in UI** as of 2026-10-29 (Syllabus page removed; `/subjects/{subject}/topics` no longer called by frontend).

---

### S15 — PDF review status + removal
- **Date:** 2026-10-29 · **Context:** "read, … approve, disapprove, and remove PDFs"; "clearly distinguish approval status from deletion"
- **Purpose:** admin curation of uploaded PYQ PDFs — mark reviewed/unreviewed, delete files
- **UI action:** PYQ table per-row "Mark Reviewed" / "Unreview" and "Remove" (confirm dialog)

**S15a — Update** `PATCH /subjects/{subject}/pdfs/{filename}`
- **Request:** `{"review_status": "unreviewed|approved|disapproved"}`
- **Response 200:** `{"filename", "review_status", "size_bytes", "status", "result_available"}` (list-item shape + `review_status`)

**S15b — Remove** `DELETE /subjects/{subject}/pdfs/{filename}`
- **Response 204**; deletes stored file, jobs and results for that PDF
- **Errors:** 404 unknown subject/filename; 409 deletion blocked while a job is running
- **DB:** add `review_status` column (default `"unreviewed"`) to the PDF/manifest record; DELETE cascades job/result artifacts
- **Auth:** admin only for both
- **Note:** `GET /subjects/{subject}/pdfs` (S6) should include `review_status` in each item once added
- **Status:** Proposed — pending implementation

---

### S16 — Subject update / removal
- **Date:** 2026-10-29 · **Context:** "read, create, edit, … remove … subjects"
- **Purpose:** rename a subject or delete it with all its PDFs/questions/topics
- **UI action:** My Subjects cards — "Rename" (dialog) and "Remove" (confirm dialog)

**S16a — Rename** `PATCH /subjects/{subject}`
- **Request:** `{"name": "NewName"}`
- **Response 200:** `{"name": "NewName", "renamed": true}`
- **Note:** backend must move/rename the subject's storage directories and cascade the name change to questions/topics references (or return 409 if a hard cascade is not feasible — UI will surface it)

**S16b — Remove** `DELETE /subjects/{subject}`
- **Response 204**; removes directories, PDFs, results, topics and question references for the subject
- **Errors:** 404 unknown subject; 409 blocked while a job is running
- **Auth:** admin only
- **Status:** Proposed — pending implementation

---

### S17 — Generated papers list
- **Date:** 2026-10-29 · **Context:** My Papers page currently shows static demo rows
- **Purpose:** list metadata of generated/saved question papers (generation itself is a future service, out of scope here)
- **UI action:** My Papers page table render
- **Endpoint:** `GET /papers?subject=&page=&page_size=`
- **Response 200:**
  ```json
  {"papers": [{"id": 5, "title": "Mid-Semester Examination", "subject": "OperatingSys", "exam_type": "Mid-Semester", "total_marks": 50, "duration": "3 Hours", "question_count": 20, "created_by": "admin@example.com", "created_at": "2026-10-29T00:00:00Z", "status": "draft|final"}], "total": 1}
  ```
- **DB:** `papers` table — `id`, `title`, `subject_name`, `exam_type`, `total_marks`, `duration`, `question_count`, `created_by` (FK→users), `status`, `created_at`, `content_json`
- **Auth:** list for any authenticated user (teachers see own; admin sees all — filter optional `created_by=me`)
- **Errors:** 401
- **Status:** Proposed — pending implementation

---

### S18 — Weightage analytics
- **Date:** 2026-10-29 · **Context:** Weightage Analysis page currently shows static demo numbers
- **Purpose:** topic frequency / marks / recency analysis feeding the weightage table
- **UI action:** Weightage page table render (per selected subject)
- **Endpoint:** `GET /subjects/{subject}/weightage`
- **Response 200:** `{"subject": "...", "papers_analyzed": 5, "topics": [{"topic_id": 4, "topic_name": "CPU Scheduling", "frequency": 7, "papers_count": 10, "historical_marks": 35, "last_appeared": 2026, "weight_score": 82.5, "tier": "high|medium|low|unseen"}]}`
- **DB:** derived from `questions` (S12) + parsed PYQ results (S8); may be a materialized view
- **Auth:** any authenticated user
- **Errors:** 404 unknown subject; 200 with empty `topics` when no data
- **Status:** Proposed — pending implementation. **Obsolete in UI** as of 2026-10-29 (Weightage Analysis page removed; endpoint no longer called by frontend).

---

### S19 — Persistent processing-status manifest per subject
- **Date:** 2026-10-29 · **Context:** PYQs page status detection must not rely solely on the presence/absence of question records in JSON files
- **Purpose:** maintain an authoritative, persistent processing-status manifest for every subject so the UI can retrieve accurate PDF status (processing, completed, failed)
- **Location:** `{subject_root}/manifests/processing_status.json` (one manifest per subject)
- **Manifest schema (per PDF entry):**
  ```json
  {
    "subject": "OperatingSys",
    "updated_at": "2026-10-29T00:00:00Z",
    "pdfs": [
      {
        "id": "uuid-or-stable-id",
        "filename": "paper.pdf",
        "relative_path": "OperatingSys/source/paper.pdf",
        "status": "processing|completed|failed|not_processed",
        "last_processed_at": "2026-10-29T00:00:00Z",
        "result_json": "OperatingSys/parser/paper.json",
        "scraper_json": "OperatingSys/scrapper/paper.json",
        "docx_path": "OperatingSys/reconstruct/paper.docx",
        "error": null
      }
    ]
  }
  ```
- **API integration:** `GET /subjects/{subject}/pdfs` (S6) and `GET /subjects/{subject}/pdfs/{filename}/status` should read from this manifest; upload/process/reprocess/fail/remove (S5, S7, S15b) must update it atomically
- **Update triggers:** PDF upload, processing start, completion, failure, reprocessing, and removal
- **Validation rules:** filename and relative_path required and unique per subject; status must be one of the allowed values; paths must be normalized (trim whitespace, consistent separators) before comparison; missing entries default to `not_processed`; stale entries for removed PDFs must be purged
- **Expected behavior:** UI matches PDF filename/relative path against manifest records using normalized values; no false matches between similarly named files, subjects, or MID/END papers; badges and Process/Result/DOCX/Review/Import actions reflect manifest status
- **Status:** Proposed — pending implementation

---

### S20 — Question bank enhancements for parsed PYQ questions
- **Date:** 2026-10-29 · **Context:** Question Bank UI must show all successfully parsed PYQ questions grouped by marks with pagination
- **Purpose:** extend S12 so the UI can retrieve PYQ-sourced questions accurately and paginate/group them
- **Required changes:**
  - Add `source` filter to `GET /questions` (exact or `source_prefix`, e.g. `pyq:`) and optional `marks` filter
  - Include `question_number` (original question number) and `source` (already present) in each question object
  - Ensure `total` reflects filtered results; keep `page` and `page_size` handling
  - Optionally support `group_by=marks` to return questions grouped by marks
- **Expected behavior:** UI groups questions by marks, shows question text, original number, marks, subject, and source PDF; pagination with configurable page size; loading/empty/error states
- **Status:** Proposed — pending implementation. **Superseded in UI** by S23 (`GET /api/question-bank`); these `/questions` enhancements are not currently called by frontend.

---

### S21 — Serve Question Bank (parsed questions)
- **Date:** 2026-10-29 · **Context:** Question Bank UI needs a stable endpoint for successfully parsed PYQ questions
- **Endpoint:** `GET /questions` (auth) — serves questions from the existing question store/data source
- **Query params:** `subject` (optional), `marks` (optional, integer), `status` (optional), `difficulty` (optional), `search` (optional), `page` (optional, default 1), `page_size` (optional, default 25)
- **Response 200:** `{"questions":[{"id":12,"subject":"OperatingSys","question_number":3,"text":"...","difficulty":"MEDIUM","type":"LONG","marks":5,"status":"pending","source":"pyq:paper.pdf","created_at":"..."}],"total":1,"page":1,"page_size":25}`
- **Validation rules:** `page`/`page_size` positive integers; `marks` non-negative integer; unknown subject returns 404; invalid params return 422
- **Errors:** 401 unauthorized; 404 subject not found; 422 invalid query; 500 server error
- **Status:** Proposed — pending implementation. **Superseded in UI** by S23 (`GET /api/question-bank`); this `/questions` read path is not currently called by frontend.

---

### S22 — Persistent subject Question Bank
- **Date:** 2026-10-29 · **Context:** Uploading a PDF must synchronize parsed questions into a per-subject bank
- **Storage:** `{subject_dir}/question_bank.json` (backend-owned; UI never reads files)
- **Behavior:** after successful PDF processing, import parsed questions from the manifest's `questions_parsed.json` into the subject bank using stable question IDs and source-PDF identifiers; skip duplicates; never import failed/incomplete results; preserve parsed schema and metadata; use file locking/atomic writes; recover if bank missing/invalid
- **Serve endpoint:** `GET /questions?subject=&marks=&page=&page_size=` (default page_size 25) returns `{"questions":[...],"total":N,"page":1,"page_size":25}` with consistent IDs and metadata, including nested subquestions
- **Validation rules:** subject required for subject-scoped reads; page/page_size positive integers; marks optional non-negative integer; total reflects applied filters
- **Errors:** 401 unauthorized; 404 subject not found; 422 invalid query; 500 server error
- **Status:** Proposed — pending implementation. **Superseded in UI** by S23 (`GET /api/question-bank`); this `/questions` read path is not currently called by frontend.

---

### S23 — Parsed PYQ Question Bank API (actual frontend contract)
- **Date:** 2026-10-29 · **Context:** Parsed PYQ UI now consumes the subject-level question bank
- **Endpoint:** `GET /api/question-bank` (auth)
- **Query params:** `subject_id` (optional), `marks` (optional), `page` (default 1), `page_size` (default 25)
- **Response 200:** `{"items":[{"question_id":"...","original_question_number":"Q1a","cleaned_text":"...","original_text":"...","marks":2.0,"subject_id":"OperatingSys","source_pdf":"...","source_pages":[1],"source_path":"...","page_number":1,"section_name":"Part-I","sub_questions":[]}],"pagination":{"page":1,"page_size":25,"total_items":18,"total_pages":1},"filters":{"subject_id":"OperatingSys","marks":null}}`
- **Validation rules:** page/page_size positive integers; marks optional numeric; unknown subject returns empty result or 404 as implemented by backend; total reflects applied filters
- **Errors:** 401 unauthorized; 422 invalid query; 500 server error
- **UI use:** parsed PYQ page only; SQLite-backed `/questions` remains unchanged for manual question management
- **Status:** Implemented by backend; frontend migrated

---

## Integration notes for the UI

- The UI calls every Part B endpoint through the same `api()` helper as Part A;
  while a service is still `Proposed`, the calling page renders the live error
  (usually `404`) inside its standard error/empty states — nothing is faked.
- Until S10 exists the UI assumes `role = "admin"` after login (JWT has no role
  claim) so the admin workflow is reachable; once S10 lands, `role: "teacher"`
  hides admin-only navigation items.
- Destructive actions (remove subject/PDF/question/teacher, disapprove) open a
  native `<dialog>` confirmation before the request is sent.

---

### S24 — Question priority persistence
- **Date:** 2026-10-29 · **Context:** Question Bank UI needs editable per-question priority (1 Regular, 2 Higher priority, 3 Must come) that survives refresh/restart
- **Purpose:** persist teacher/admin priority overrides for parsed question-bank questions
- **UI action:** Question Bank page — priority `<select>` per row; save on change; loading/saving/error states

**S24a — List** `GET /api/question-priorities?subject_id=` (auth)
- **Query:** `subject_id` optional
- **Response 200:** `{"subject_id": string|null, "default_priority": 1, "priorities": {"<question_id>": 1|2|3}}`
- **UI use:** load saved priorities when questions load; default `1` for missing entries

**S24b — Save** `PUT /api/question-priorities` (auth)
- **Request:** `{"question_id": string, "priority": 1|2|3, "subject_id": string|null}`
- **Response 200:** `{"question_id": string, "subject_id": string|null, "priority": int, "updated": true}`

**S24c — Reset** `DELETE /api/question-priorities/{question_id}?subject_id=` (auth)
- **Response 200:** `{"question_id": string, "subject_id": string|null, "priority": 1, "reset": true}`

- **Validation:** priority 1–3; question_id 1–200 chars; subject_id optional 1–80 chars
- **Auth:** any authenticated user (as implemented)
- **Errors:** 401 unauthorized; 422 invalid query/body
- **Status:** Implemented by backend; frontend migrated (2026-10-29)

---

### S25 — Question paper generation and blueprints (actual backend contract)
- **Date:** 2026-10-29 · **Context:** Generate Question Paper page redesigned to a form-based blueprint workflow
- **Purpose:** store reusable paper blueprints and generate a DOCX question paper from a selected subject, exam type, marks, duration, and sections
- **UI action:** Generate Question Paper page — basic configuration, section table, Manage Blueprints dialog, Generate button, DOCX download

**S25a — List blueprints** `GET /blueprints?subject=&exam_type=` (auth)
- **Response 200:** `{"blueprints":[{"id":"...","name":"...","description":"...","subject":"...","exam_type":"...","sections":[{"name":"A","questions":10,"marks":2}],"is_default":true}],"total":N}`

**S25b — Create blueprint** `POST /blueprints` (auth, admin)
- **Request:** `{"name":string,"description":string|null,"subject":string|null,"exam_type":string|null,"sections":[{"name":string,"questions":int,"marks":int}],"is_default":boolean}`
- **Response 201:** blueprint object

**S25c — Update blueprint** `PATCH /blueprints/{blueprint_id}` (auth, admin)
- **Request:** subset of create fields
- **Response 200:** blueprint object

**S25d — Duplicate blueprint** `POST /blueprints/{blueprint_id}/duplicate` (auth, admin)
- **Response 201:** blueprint object

**S25e — Delete blueprint** `DELETE /blueprints/{blueprint_id}` (auth, admin)
- **Response 204**

**S25f — Generate paper** `POST /papers/generate` (auth)
- **Request:** `{"title":string,"subject":string,"exam_type":string,"total_marks":int,"duration":string,"blueprint_id":string|null,"sections":[{"name":string,"questions":int,"marks":int}]}`
- **Response 201:** `{"paper_id":int,"title":string,"subject":string,"exam_type":string,"total_marks":int,"duration":string,"question_count":int,"download_url":string}`

**S25g — Download generated DOCX** `GET /papers/{paper_id}/docx` (auth)
- **Response 200:** DOCX bytes

- **Validation:** sections must be non-empty; section totals must equal total_marks; questions/marks positive integers
- **Auth:** list/generate/download for any authenticated user; create/edit/duplicate/delete admin only
- **Selection rule:** backend must select questions by priority 3 → 2 → 1, randomly among eligible questions of the same priority; requested marks must match exactly and incompatible questions must not be substituted. Return a clear error when insufficient matching questions exist.
- **UI usage (2026-10-29, unified):** Generate page now has one Blueprint and Sections card combining saved blueprints and quick-mark presets. It loads blueprints on page open, supports select/create/duplicate/rename/update/delete, applies a selected blueprint or preset to the section editor and total marks, validates section totals, and persists through S25a–S25e. Quick presets remain editable and can be saved as new blueprints. Status: Proposed — pending backend implementation; live calls currently return 404 and are shown as errors.

---

### S26 — Question paper blueprints and generation (verified frontend contract)
- **Date:** 2026-10-29 · **Context:** Generate Question Paper page migrated to the running backend's actual blueprint/generation APIs
- **Purpose:** store reusable paper blueprints and generate a DOCX question paper from a selected subject, exam type, marks, duration, and blueprint

**S26a — List blueprints** `GET /blueprints` (auth)
- **Response 200:** `{"items":[{"blueprint_id":"...","name":"...","description":"...","subject_id":"...","exam_type":"...","sections":[{"name":"A","question_count":2,"marks_per_question":5}],"is_default":true}],"quick_mark_presets":[15,25,50,60,70,80,100]}`

**S26b — Create blueprint** `POST /blueprints` (auth)
- **Request:** `{"blueprint_id":string,"name":string,"description":string|null,"subject_id":string|null,"exam_type":string|null,"sections":[{"name":string,"question_count":int,"marks_per_question":int}],"is_default":boolean}`

**S26c — Get/update blueprint** `GET /blueprints/{blueprint_id}`, `PATCH /blueprints/{blueprint_id}` (auth)
- **PATCH request:** same fields as create
- **Response 200:** blueprint object

**S26d — Duplicate blueprint** `POST /blueprints/{blueprint_id}/duplicate` (auth)
- **Request:** optional object or null
- **Response 201:** blueprint object

**S26e — Delete blueprint** `DELETE /blueprints/{blueprint_id}` (auth)
- **Response 200**

**S26f — Generate paper** `POST /api/question-papers/generate` (auth)
- **Request:** `{"title":string,"subject":string,"exam_type":string,"total_marks":int,"duration":string,"blueprint_id":string|null}`
- **Response 200:** includes `paper_id`, `sections`, `question_count`, `processing_accuracy_notice`, `docx_url`

**S26g — Download generated DOCX** `GET /api/question-papers/{paper_id}/docx` (auth)
- **Response 200:** DOCX bytes

- **UI usage:** unified Blueprint and Sections card; quick presets 15/25/50/60/70/80/100; editable sections; total validation; create/duplicate/rename/update/delete; generation and DOCX download wired and verified; processing accuracy notice shown. Saved blueprints persist after refresh.

---

### S27 — Draft review before DOCX export (frontend workflow)
- **Date:** 2026-10-29 · **Context:** Generate Question Paper page now opens an editable draft review table before DOCX export
- **Endpoints reused:** S26f generation, S26g DOCX download, S26a/S26b blueprint CRUD, and `/api/question-bank?subject_id=...&page_size=...`
- **Behavior:** generated draft is reviewed/edited in the browser; questions can be added from the subject Question Bank, reordered, removed, and reassigned; section and total-mark validation gates DOCX export; processing accuracy notice is shown outside the paper preview.
- **Assets/source:** source details come from generated paper and Question Bank fields; no fake asset/PDF URLs are constructed.

---

### S28 — Formal examination paper metadata and DOCX options (frontend)
- **Date:** 2026-10-29 · **Context:** Generate Question Paper form expanded with examination details, responsive question editor, and DOCX options
- **Backend contract unchanged:** generation still uses S26f `POST /api/question-papers/generate` with `title`, `subject`, `exam_type`, `total_marks`, `duration`, `blueprint_id`; DOCX uses S26g `GET /api/question-papers/{paper_id}/docx`.
- **Frontend fields:** university/institution, college, department, academic year, semester, subject code, optional exam date, and general instructions are collected in the UI. The backend schema does not currently persist these extra metadata fields.
- **DOCX option:** ~~"Include Processing Accuracy Notice" toggles the exact notice text~~ **Removed 2026-10-30** — the accuracy notice is mandatory and handled by the backend; the Generate page no longer carries the checkbox, the client-side notice constant, or the `include_processing_accuracy_notice` request field. If the backend returns `processing_accuracy_notice`, the UI still displays that server-provided text.
- **Source references:** question provenance comes from generated paper and `/api/question-bank` fields (source PDF, original question number, page(s), section); no unsupported file URLs are constructed.

---

### S29 — Parsed question bank create/update (Question Bank Add/Edit)
- **Date:** 2026-10-30 · **Context:** Question Bank page now supports adding and editing questions using the shared question editor (reused by Generate Question Paper draft review).
- **Purpose:** create and update parsed question-bank items so manually authored questions can live alongside imported PYQ questions.
- **UI action:** Question Bank — `+ Add Question` button (create), per-row `Edit` (update), and `Remove Question` in the Edit Question modal (delete via S29c, after confirmation dialog); Generate paper draft review — per-row `Edit` (in-memory only, no network).

**S29a — Create** `POST /api/question-bank` (auth)
- **Request:** `{"subject_id": string, "cleaned_text": string, "marks": number, "section_name": string|null, "original_question_number": string|null, "source_pdf": string|null, "source_pages": number[], "page_number": number|null, "priority": 1|2|3}`
- **Response 201:** question item in S23 shape plus `priority`.
- **Errors:** 404 unknown subject; 422 validation.

**S29b — Update** `PATCH /api/question-bank/{question_id}` (auth)
- **Request:** subset of S29a fields (subject_id not changeable).
- **Response 200:** updated question item.
- **Errors:** 404 unknown question; 422 validation.

**S29c — Remove (optional)** `DELETE /api/question-bank/{question_id}` (auth) → 204; 404 unknown.

- **Validation:** `cleaned_text` 1–2000 chars; `marks` 1–100; `priority` 1–3; `source_pages` non-negative integers; `subject_id` must exist.
- **Auth:** any authenticated user (consistent with S23; backend may restrict to admin and UI surfaces 403).
- **Status:** Proposed — pending backend implementation; UI calls return errors shown in standard empty/error states until available.

---

### S30 — TOTP login in the main login form, revealed after credentials (frontend)
- **Date:** 2026-10-30 · **Context:** Login page asks for email + password first; the six-digit TOTP field appears only after the backend accepts the credentials (i.e. `requires_totp: true` + `challenge_token` in the login response). Enrollment/disable use the TOTP contract from the 2026-10-30 integration message (`/auth/totp/*`). Authenticator codes renew every 30 seconds; an informational epoch-anchored countdown sits under the OTP field.
- **Backend contract unchanged:** submit still chains the documented calls — `POST /auth/login {email, password}` → on `{"requires_totp": true, "challenge_token": "..."}` immediately `POST /auth/totp/verify {challenge_token, code}`. No combined email+password+OTP endpoint exists or is used; none was invented.
- **Backend requirements this frontend depends on (must hold):**
  - `/auth/login` returns `requires_totp: true` + `challenge_token` on every login attempt for TOTP-enabled users (never authenticates them with email+password alone).
  - `/auth/totp/verify` 401s distinguish an expired/reused challenge (message must contain wording matching `/(expir|reus|invalid).*(challenge)/` or equivalent) from a plain wrong code, so the UI can silently restart the login; challenge lifetime ≈ 5 min, single-use.
  - `/auth/totp/*` 429 responses include a numeric (or HTTP-date) `Retry-After` header; the UI lockdown/countdown uses it exclusively.
- **Constraint for "TOTP mandatory for all users":** the backend decides this per account (requires_totp in the login response). Frontend cannot enforce TOTP for accounts without TOTP enabled; if universal enforcement is required, the backend must reject logins for non-enabled accounts or the accounts must complete enrollment.
- **Status:** Live — documented contract above already implemented by the backend; no backend changes made.

---

### S31 — Saved Basic Configuration presets (Proposed) + 2FA toggle notes (frontend)
- **Date:** 2026-10-30 (restored backend-backed 2026-10-30 same day, see status) · **Context:** Generate Question Paper page carries a saved-configuration system for the 13 Basic-Configuration fields (university/institution, college, department, paper title, academic year, semester, exam type, subject, subject code, exam date, duration, total marks, general instructions). A 2FA on/off toggle was added to the Profile 2FA cards.
- **Required backend contract:**
  - `GET /api/ui-configurations` (auth) → `200 {"items": [{"configuration_id", "name", "is_default", "values": {"university", "college", "department", "paper_title", "academic_year", "semester", "exam_type", "subject", "subject_code", "exam_date", "duration", "total_marks", "instructions"}}]}` — stored per authenticated user (e.g. `{STORAGE_ROOT}/.masterdeorca/user_ui_configurations.json`).
  - `POST /api/ui-configurations` (auth) — create/duplicate: `{name, values{...}, is_default?}` → 201 configuration object.
  - `PATCH /api/ui-configurations/{configuration_id}` (auth) — save(current values)/rename/set default; body is a subset → 200 configuration object.
  - `DELETE /api/ui-configurations/{configuration_id}` (auth) → 200/204; deleting the default must not orphan the store (backend reassigns or accepts none-default state like blueprints do).
- **2FA toggle:** the Profile toggle only drives the *documented* enrollment flows (`GET /auth/totp/status` → enroll → confirm; disable via `DELETE /auth/totp {code}`). It does not and cannot bypass TOTP enforcement client-side — `requires_totp` in `POST /auth/login` remains the backend's authority. If a genuine "skip TOTP (remember this device)" feature is wanted, the backend must add it — e.g. challenge/remember-device tokens issued after first successful verification, honored by `/auth/login`; that is a proposed-backend concern, not implementable in the UI alone.
- **Status:** **Restored 2026-10-30 (backend-backed).** The saved-configuration UI (dropdown, name field, New/Save/Duplicate/Rename/Set default/Delete + status line) is back on the Generate page and talks to the endpoints above through the standard `api()` helper; the earlier localStorage implementation (`qpg_saved_configs_v1` / `qpg_last_configuration_id`, `loadSavedConfigs()` client-store) is **not** restored. Until the backend implements S31 the page shows the live load error / empty state and never invents configurations. Status: Proposed — pending backend implementation.

---

### S32 — Admin access mode (Read-only / Edit) for the Admin page
- **Date:** 2026-10-30 · **Context:** Sidebar `Teachers` entry replaced by `Admin`; the Admin page exposes an access-mode switch (Read-only vs Edit) plus teacher management (S11). Dashboard removed Active Teachers/Assignments cards and the duplicate Manage Teachers shortcut.
- **Purpose:** persist the per-session administrator access mode so read-only viewing (subjects, question bank, PYQs, papers) can hide write actions, and Edit Mode restores them. Mode never lives in frontend state alone.
- **UI action:** Admin page — Access Mode panel. `Read-only Mode` / `Edit Mode` buttons; on confirm-switch, PUT then refresh UI (body `access-readonly` class hides write controls; current-mode chip and radios update). GET runs after login/`/auth/me` for admins; if the endpoint is missing, the Admin panel shows a notice that changes cannot be persisted while the session default (Edit, per the S10 role-fallback precedent) applies.

**S32a — Read mode** `GET /auth/access-mode` (bearer)
- **Request:** —
- **Response 200:**
  ```json
  {"mode": "edit", "updated_at": "2026-10-30T00:00:00Z"}
  ```
  `mode`: `"read_only" | "edit"`; per authenticated user; administrators only.
- **Errors:** 401 missing/invalid token; 403 non-admin.

**S32b — Persist mode** `PUT /auth/access-mode` (bearer)
- **Request:** `{"mode": "read_only" | "edit"}`
- **Response 200:** the object from S32a with the persisted value.
- **Errors:** 401; 403 non-admin; 422 invalid mode; backend 404/501 before implementation (UI shows the S32 notice and keeps the last backend-confirmed mode).

- **DB:** users table (S10) gains `access_mode` (default `edit`), or a per-session store equivalent.
- **Auth:** admin only for both operations.
- **Status:** Proposed — pending backend implementation. The UI issues the real GET/PUT calls and never fabricates a persisted mode: without S32 it falls back to Edit Mode and displays a persistence notice instead of storing the choice client-side.

---

### S33 — Question Bank validation pipeline (Proposed)
- **Date:** 2026-10-30 · **Context:** backend introduced an automated question-validation pipeline ahead of persistence; the Question Bank UI must surface validation state without inventing statuses
- **Purpose:** let the UI distinguish validated bank records from records the pipeline flagged, and let an administrator approve/reject flagged records

**S33a — Item fields on `GET /api/question-bank` (S23)**
- Each item **may** additionally carry:
  - `validation_status`: `"approved" | "needs_review" | "invalid" | "duplicate" | "awaiting_validation" | "rejected"`
  - `validation_reason`: human-readable failure/flag description (present on flagged records)
  - `processing_status`: `"scraped" | "parsed" | "awaiting_validation" | "awaiting_import"` (pipeline progress, independent of validation outcome)
- Legacy rows that do not run the pipeline carry **neither** field; the UI must treat the absence of both fields as "real data as previously documented", not as `approved`.
- Items without `validation_status` but with `processing_status` are pipeline items that have not reached a validation decision yet.
- **Status:** Proposed — pending backend implementation. UI consumes these fields exactly; when absent the page keeps today's behavior and never displays a fabricated status.

**S33b — Approve flagged record** `POST /api/question-bank/{question_id}/approve` (auth, admin)
- **Response 200:** the S23 question object with `validation_status: "approved"`.
- **Errors:** 404 unknown question; 403 non-admin; 409 record is not in a reviewable state.

**S33c — Reject flagged record** `POST /api/question-bank/{question_id}/reject` (auth, admin)
- **Response 200:** the S23 question object with `validation_status: "rejected"`.
- **Errors:** same as S33b.
- **UI behavior:** approved items render as normal bank records; `needs_review | invalid | duplicate | awaiting_validation` render only in a dedicated review/processing section (never as approved); `rejected` items are not displayed; `processing_status` is shown wherever the backend provides it.

---

## Part C — Newly consumed services (history of generated papers)

### S34 — List generated-paper history
- **Date:** 2026-10-30 · **Context:** Question Papers page replaces the unavailable placeholder with the backend's permanent history.
- **Endpoint:** `GET /api/question-papers/history` (auth; admin sees all, other users see their own papers)
- **Query params:** `page` (default 1, ≥1), `page_size` (default 25, 1–100), `subject` (optional)
- **Response 200:** `{"items": [...], "page": int, "page_size": int, "total": int}`, newest-first. Each item:
  - `paper_id` (str), `filename` (str, original DOCX filename), `subject` (str), `paper_title` (str), `exam_type` (str), `total_marks` (int), `duration` (str), `generated_at` (ISO 8601), `generated_by` (email|null), `docx_available` (bool), `docx_url` (str)
- **UI use:** Question Papers page (teacher + admin) — renders Paper/Subject/Exam type/Marks/Date/Duration, Download + Delete actions, pagination, newest-first, empty + error + loading states.
- **Errors:** 401; 422 invalid query (e.g. bad `subject`)
- **Status:** Verified live — route + schema confirmed against running instance OpenAPI (`/api/question-papers/history` get) on 2026-10-30.

### S35 — Download a generated paper DOCX
- **Endpoint:** `GET /api/question-papers/{paper_id}/docx` (auth)
- **Response 200:** DOCX bytes (`Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`); server-supplied `Content-Disposition` filename is `question-paper-{paper_id}.docx`.
- **UI use:** Question Papers Download action uses each history item's original `filename` (item.filename) as the saved filename so the original name is preserved. Missing files surface a disabled Download button (`docx_available` false) or a toast on a 404.
- **Errors:** 401; 404 "Generated paper not found"
- **Status:** Verified live — route confirmed in OpenAPI on 2026-10-30.

### S36 — Delete a generated-paper history record
- **Endpoint:** `DELETE /api/question-papers/history/{paper_id}` (auth)
- **Response 200:** `{"paper_id": str, "deleted": true}`
- **Authorization:** only the record owner (`generated_by`) or an administrator may delete; otherwise 403.
- **UI use:** Question Papers Delete action — confirmation dialog, refresh of the current page after a successful delete (steps back a page if the last item on a page was removed), toast on success/error.
- **Errors:** 401; 403 (not owner/admin); 404 not found; 422
- **Side effects:** removes the history record JSON and its stored DOCX.
- **Status:** Verified live — route + semantics confirmed against running instance OpenAPI on 2026-10-30.

### S37 — Automatic history on generation
- **Endpoint (generation):** `POST /api/question-papers/generate` (auth, `require_write_user`); request body is the documented `QuestionPaperGenerate` (title, subject, exam_type, total_marks, duration, blueprint_id, seed, metadata fields).
- **Behavior:** the backend persists a permanent paper record + DOCX automatically on every successful generation (no separate "save to history" step). The UI now calls this endpoint with the same seed it uses for the editable draft, so the history record and the draft review start from the same selection.
- **UI use:** Generate Question Paper submit flow. A failure to persist history is surfaced as a toast but does not block the editable draft review workflow.
- **Status:** Verified live — route confirmed in OpenAPI on 2026-10-30.

### S38 — Previous Year Questions (PDF) processing pipeline
- **Date:** 2026-10-30 · **Context:** "PYQ page showed an empty state even though subjects and PDFs exist." Root cause was UI-side: the `teacher-pyqs` page loader did not run `loadSubjects()`, so the subject dropdown was empty and `loadPdfList()` short-circuited to "Select a subject…" without ever calling the API. Backend endpoints below are all correct and unchanged.
- **Endpoint:** `GET /subjects` (`Admin`) -> `{"subjects": [name, …]}` — subject enumeration is admin-only. Teachers derive subjects from their saved blueprints (`GET /blueprints` → `item.subject_id`).
- **Endpoint:** `GET /subjects/{subject}/pdfs` (`Admin`) -> `{"subject": subject, "pdfs": [item]}`. Each item: `subject_id`, `filename`, `size_bytes`, `uploaded_at`, `status` (`not_processed | queued | running | succeeded | failed`), `job_id`, `started_at`, `processed_at`, `last_error`, `question_count`, `result_available` (bool), `review_status` (`unreviewed | approved`). List order is on-disk name (case-insensitive); the UI keeps newest-first only for the generated-papers history (see S34), not for raw PDF files.
- **Endpoint:** `POST /subjects/{subject}/pdfs` (`AdminWrite`, multipart field `files`) -> `{"subject": subject, "uploaded": [{filename, size_bytes, path}]}` — the UI now reads `data.uploaded` (previously expected `files`/`pdfs`/`stored`, which never matched and left the parsed list empty).
- **Endpoint:** `POST /subjects/{subject}/pdfs/{filename}/process` (`AdminWrite`, optional `{force}`) -> 202 `{"job_id", "status":"queued", …}`.
- **Endpoint:** `GET /jobs/{job_id}` (`Admin`) -> job payload with `status` (`queued|running|succeeded|failed`), `stage`, `error`. The UI polls this every 2 s and reloads the PDF list on terminal `succeeded`/`failed`.
- **Endpoint:** `GET /subjects/{subject}/pdfs/{filename}/result?include_questions=true` (`Admin`) -> `{subject, filename, parsed_json, question_count, metadata, questions:[...]}` where each question carries `question_id`, `original_question_number`/`original_label`, `cleaned_text`, `original_text`, `marks`, `marks_notation`, `section_name`, `source_pdf`, `source_pages`, `sub_questions[]`, `assets`, `tables`, `confidence`, `validation_issues`, `review_status`. The UI renders this list and reuses the existing question-detail inspector (figures/tables) per row.
- **Endpoint:** `POST /subjects/{subject}/pdfs/{filename}/reconstruct` (`AdminWrite`) builds the DOCX.
- **Endpoint:** `GET /subjects/{subject}/pdfs/{filename}/reconstruction` (`AdminWrite`) streams the DOCX bytes; the UI downloads it as `<filename without .pdf>.docx`.
- **Endpoint:** `PATCH /subjects/{subject}/pdfs/{filename}` (`AdminWrite`) with `{review_status}` toggles review state; `DELETE .../{filename}` removes the PDF + jobs + results.
- **UI use:** Question Papers page (PYQ tab). `loadSubjects()` now runs before fetching PDFs; upload parses `uploaded`; the "Result" action opens an extracted-questions inspector with per-question detail; errors show a Retry button; subject selector + search + status filter operate on live data.
- **Required backend consideration (documented, not changed):** all PYQ routes are admin-gated (`Admin`/`AdminWrite`). Teachers are blocked from `/pyqs` by `resolveRoute` and the nav toggle, so no backend change is required for the current admin-only workflow. If teachers ever need to manage/view PYQs, add user-scoped read endpoints and relax these dependencies — but do not invent client-side workarounds.
- **Status:** Verified live — all routes confirmed against the running instance OpenAPI + source on 2026-10-30; live sample subject `OperatingSys` returns 6 PDFs (4 `not_processed`, 2 `succeeded`) and the result endpoint returns 6 questions with full metadata.
