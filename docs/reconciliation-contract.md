# Reconciliation Controls — Required Backend Contract (Frontend Dependency)

Status: **NOT YET IMPLEMENTED** (backend endpoints not present in this repository's documentation or frontend source).

The frontend must not hardcode scheduler state. The following backend endpoints are required before reconciliation controls can be integrated. Names/paths are proposed based on existing conventions; final paths must be confirmed with the backend implementation.

## Proposed endpoints

### GET /admin/reconciliation/status (auth, admin)
Response 200:
```json
{
  "enabled": true,
  "interval_hours": 12,
  "last_run_at": "2026-...Z",
  "next_run_at": "2026-...Z",
  "last_duration_ms": 1234,
  "last_counts": { "imported": 0, "changed": 0, "skipped": 0, "failed": 0 },
  "last_error": null,
  "running": false
}
```

### PUT /admin/reconciliation/settings (auth, admin)
Request: `{ "enabled": bool, "interval_hours": 12 | 24 }`
Response 200: updated status object.

### POST /admin/reconciliation/run (auth, admin)
Triggers a manual run. Response 202: `{ "run_id": "...", "status": "queued" }` or 409 if a run is already active.
Frontend must disable "Run Now" while `running === true` or after a 409, and re-poll status.

## Notes
- Frontend will consume these through the same `api()` helper and base URL configuration.
- No frontend mock implementation is provided; UI controls remain hidden/disabled until endpoints exist.
- Required counts and timestamps come from backend only.
```