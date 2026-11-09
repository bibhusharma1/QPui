# Paper generation

## 1. What it does

The Generate Question Paper page (`#teacher-generate`, route `/generate-paper`) builds a paper from a subject's question bank using a blueprint (section layout). It supports saved configurations and blueprints, draft review, and DOCX export.

## 2. Files

- `index.html` — `teacher-generate` section: basic config, blueprint editor, generation summary, draft review table, add-question modal.
- `script.js` — form handling, `loadBlueprints`, `loadSavedConfigs`, draft review, export.

## 3. How it works

1. Load subjects, blueprints (`GET /blueprints`), and saved configs (`GET /api/ui-configurations`).
2. Fill basic configuration (university, college, title, subject, exam type, duration, total marks, instructions).
3. Choose or edit a blueprint (sections: name, question count, marks each). Section totals must equal total marks.
4. Submit → `POST /api/question-papers/drafts` with the `QuestionPaperGenerate` body → returns a draft.
5. Review the draft: edit question text/marks/section, remove, reorder, add questions from the bank (`POST .../questions`, `PATCH .../questions/{qid}`, `DELETE .../questions/{qid}`, `PUT .../question-order`).
6. Export DOCX: `POST /api/question-papers/drafts/{draft_id}/docx`.

Alternatively, generate directly with `POST /api/question-papers/generate` (creates a history record).

## 4. Saved configurations and blueprints

- Configurations: `GET/POST/PATCH/DELETE /api/ui-configurations`.
- Blueprints: `GET/POST/PATCH/DELETE /blueprints` (plus duplicate).

## 5. Permissions

- Page access gated by `generate` for teachers; admins always allowed.
- If a teacher lacks `generate`, the page is shown but frozen with an access overlay.

## 6. Known limitation

The `paperInstructions` field is collected in the UI but is not included in the request body sent to the backend (no instructions field in `QuestionPaperGenerate` beyond title/exam).