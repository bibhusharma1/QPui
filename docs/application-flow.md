# Application flow

## 1. Startup

1. The browser loads `index.html`, which loads `script.js`.
2. `script.js` resolves the backend base URL and runs the backend auto-detection promise (`backendInitPromise`).
3. On `DOMContentLoaded`, `onUnauthorized` is set to `showLoginPage`, and elements are wired.
4. If a token exists in `sessionStorage`, `loadCurrentUser()` runs; on success the app shell is shown. Otherwise the login page is shown.

## 2. Navigation

- Clicks on `.nav-item` or `[data-go]` call `navigateToPage(pageId)`.
- `navigateToPage` updates the URL via `pushState`/`replaceState` and calls `showPage`.
- `showPage` hides all sections, shows the target, updates the nav active state, sets the page title/subtitle, runs permission checks, and (once) calls the page loader.
- Browser back/forward is handled by `popstate`.

## 3. Page loaders

`pageLoaders` maps page ids to loaders: `loadSubjects`, `loadPdfList`, `loadBlueprints`, `loadSavedConfigs`, `loadPyqQuestions`, `loadPapers`, `loadTeachers`. A page is loaded once (tracked in `pageLoaded`); revisiting papers/PYQs re-fetches.

## 4. Role handling

`isAdminUser()` checks `currentUser.role === "admin"`. `applyRoleUI()` toggles the teacher/admin nav, hides `[data-admin]` items for teachers, and hides subject/PYQ creation for teachers.

## 5. Permission handling (teachers)

`loadCurrentUserAssignments()` calls `/users/{id}/subjects` (fallback `/teachers/me/subjects`) and builds `currentUserPermissions[subject]` with `accessPapers`, `uploadProcess`, `manageBank`, `generate`.

`showPage` gates page access:
- `teacher-pyqs` requires at least one subject with `uploadProcess`.
- `teacher-questions` requires `manageBank` or `accessPapers`.
- `teacher-generate` sets `window.__restrictGeneratePage` based on `generate`.

## 6. Removed feature: Access Mode

The Access Mode (Edit/Read-only) feature has been removed from the frontend. Administrator capabilities are now governed solely by role-based permissions.