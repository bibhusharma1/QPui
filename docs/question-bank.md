# Question Bank

## 1. What it does

The Question Bank page (`#teacher-questions`, route `/question-bank`) lets users browse, search, create, edit, and delete questions stored in a per-subject JSON bank. Questions come from parsed previous-year papers and can also be added manually.

## 2. Files

- `index.html` — `teacher-questions` section, filters, table, pagination, review panel, modals.
- `script.js` — `loadPyqQuestions`, `renderPyqQuestions`, priority handling, CRUD handlers.

## 3. How it works

1. Select a subject and (optionally) marks.
2. `GET /api/question-bank?subject_id=&marks=&page=&page_size=` returns `{items, pagination, filters, available_marks}`.
3. `available_marks` populates the marks filter.
4. Questions are grouped by marks, with priority dots (1 normal, 2 important, 3 high).
5. Priority sort (`qbPrioritySort`) reorders.
6. Pagination (10/25/50 per page).

Additional actions:
- Create: `POST /api/question-bank`.
- Edit: `PATCH /api/question-bank/{id}?subject_id=`.
- Delete: `DELETE /api/question-bank/{id}?subject_id=` (backend proposed).
- Priorities: `GET/PUT/DELETE /api/question-priorities`.
- Approve/reject review items (proposed backend endpoints).

## 4. Figures and tables

`has_figures` / `has_tables` flags indicate attachments. Figures are fetched on demand via `GET /api/question-bank/{id}/resources/figure/{rid}` (base64). Tables via `.../table/{rid}` (headers/rows). Previewed in `figurePreviewModal` / `sourceDetailModal`.

## 5. Review panel

`#qbReviewPanel` shows records the validation pipeline flagged for manual review before becoming usable questions.

## 6. Permissions

- Page access requires `manageBank` or `accessPapers` for teachers.
- Admins have full access.

## 7. Common issues

- No subject selected → "Select a subject and marks value to view questions."
- No questions found → empty state.
- Delete/approve/reject may fail until backend implements them.