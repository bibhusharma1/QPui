# Frontend structure

## 1. Active files

- `index.html` — the single app shell. Contains the login page, all page sections, and all dialogs/modals.
- `script.js` — all application logic (about 6,800 lines).
- `style.css` — main stylesheet.
- `styles/glass.css` — glass theme layer.
- `tests/pyq-status.test.js` — small status helper test.

## 2. Page sections (in `index.html`)

- `loginPage` — login form with email, password, and TOTP code.
- `teacher-dashboard`, `admin-dashboard` — dashboards.
- `teacher-subjects`, `admin-subjects` — subjects.
- `teacher-questions` — Question Bank.
- `teacher-pyqs` — Previous Year Questions (PDFs).
- `teacher-generate` — Generate Question Paper.
- `teacher-papers`, `admin-papers` — papers list.
- `admin-teachers` — admin / teacher management.
- `teacher-profile`, `admin-profile` — profile and TOTP settings.
- `teacher-help` — help cards.
- `admin-activity` — activity (no backend endpoint).

## 3. Navigation

The sidebar has two nav blocks: `teacherNavigation` and `adminNavigation`. Which one is shown depends on `currentUser.role`. Items use `data-page` (page id) and `data-go` (navigate target). Admin-only items use `data-admin="true"` and are hidden for teachers.

## 4. Dialogs and modals

- `confirmDialog` — generic confirm.
- `sourceDetailModal`, `figurePreviewModal` — question source/figure preview.
- `addQuestionModal` — add a question from the bank to a draft.
- `pyqPriorityDialog` — set default priority when processing a PDF.
- `resetPasswordDialog`, `profileChangeEmailModal`, `profileChangePasswordModal` — account settings.
- `subjectAssignmentModal` — created dynamically for teacher subject assignments.

## 5. Shared UI components

- Toast (`#toast`) for short messages.
- Status badges (`statusBadge`) for processing state.
- Pagination bars on teachers, papers, questions.
- Filter bars (subject, search, status, marks).
- Empty/loading/error state helpers.

## 6. Inactive modular tree (`frontend/`)

`frontend/` contains `index.html`, `css/*`, `js/*` (api clients, router, sidebar, utils). None of it is loaded by the active `index.html`. It is a partial redesign and is not documented as active functionality. See `frontend/README.md` for its intended structure.

## 7. CSS architecture

See `docs/ui-and-styling.md`. In short: `style.css` holds tokens, base, layout, components, states, and responsive rules; `styles/glass.css` adds the glass theme.