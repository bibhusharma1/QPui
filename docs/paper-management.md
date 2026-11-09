# Paper management

## 1. What it does

The My Papers page (`#teacher-papers` / `#admin-papers`, route `/my-papers`) lists generated question papers with pagination, and lets users download DOCX or delete a paper.

## 2. Files

- `index.html` — `teacher-papers`, `admin-papers` sections, tables, pagination.
- `script.js` — `loadPapers`, `fetchPapers`, download/delete handlers.

## 3. How it works

- `GET /api/question-papers/history?page=&page_size=&subject=` returns the list.
- Each row shows paper title, subject, exam type, marks, date, duration, and actions.
- Download: `GET /api/question-papers/{paper_id}/docx` (blob).
- Delete: `DELETE /api/question-papers/history/{paper_id}`.
- Pagination via `#papersPrev` / `#papersNext`.

## 4. Drafts

Drafts can be created and exported, but the backend does not provide a listing endpoint. The page shows a static note (`#draftPapersList`).

## 5. Permissions

- Teachers see their own papers; admins see all.
- Generated papers are stored on the backend; the frontend never stores files.