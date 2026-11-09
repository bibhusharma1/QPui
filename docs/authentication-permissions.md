# Authentication and permissions

## 1. Login

Login is a two-step flow hidden behind one form (`#loginForm`):

1. `POST /auth/login` with `{email, password}`.
2. If the response has `requires_totp === true`, the TOTP field is revealed and a `challenge_token` is stored in memory.
3. `POST /auth/totp/verify` with `{challenge_token, code}`.
4. On success, the `access_token` is stored in `sessionStorage` and `GET /auth/me` loads the user.

If a challenge is expired or reused (401 with a matching detail), the login is silently restarted and the code is retried once.

## 2. Current user

`GET /auth/me` populates `currentUser` (name, email, role, status). The role drives the admin/teacher UI and route gating. The frontend does not trust a role claim in the JWT; it always calls `/auth/me`.

## 3. Token storage

Tokens are stored in `sessionStorage` under `qpg_token_local` / `qpg_token_production` (per backend target). There are no refresh tokens; on 401 the session is cleared and the login page is shown.

## 4. Logout

Logout is client-side only: clears all sessions, resets state, and shows the login page. There is no backend logout endpoint.

## 5. TOTP management (profile)

Endpoints used:
- `GET /auth/totp/status`
- `POST /auth/totp/enroll`
- `POST /auth/totp/confirm {code}`
- `DELETE /auth/totp {code}`

Rate limiting (429) uses the `Retry-After` header for a countdown.

## 6. Removed feature: Admin access mode

The Admin access mode (Edit/Read-only) feature has been removed from the frontend. The `/auth/access-mode` endpoints are no longer called. Administrator capabilities are governed by role-based permissions only.

## 7. Teacher subject assignments and permissions

Admins assign subjects to teachers via `POST /teachers/{id}/subjects {subjects}`. The backend auto-grants all four permission flags on assignment. The frontend loads a teacher's assignments from `GET /users/{id}/subjects` (fallback `/teachers/{id}/subjects`) and the current teacher's from `GET /users/{id}/subjects` (fallback `/teachers/me/subjects`).

Permissions per subject:
- `accessPapers` (view papers)
- `uploadProcess` (upload/process PDFs)
- `manageBank` (manage question bank)
- `generate` (generate papers)

When fields are missing, they default to `true`. These values gate page access in `showPage()` and subject lists in `loadSubjects()`.

## 8. Role differences

- **Admins:** full navigation, subject CRUD, teacher management, access-mode toggle, assignment modal.
- **Teachers:** restricted navigation, subjects derived from permissions + blueprints, page access gated by permissions.

## 9. Common issues

- Expired token → cleared session, redirected to login.
- 403 → "Your account does not have permission to perform this action."
- Missing assignment endpoints → UI falls back and shows empty/limited data. See `docs/backend-integration.md`.
## Related documentation

- [Application flow](application-flow.md)
- [Backend integration](backend-integration.md)
- [Complete workflow](complete-workflow.md)

