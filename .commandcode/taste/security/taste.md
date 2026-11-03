# Security (frontend auth & secrets)

- Never persist tokens or secrets in browser storage (localStorage/sessionStorage); temporary auth artifacts like challenge tokens stay in memory only, and access tokens are the only thing saved to persistent storage. Confidence: 0.9
- Never log or display secrets, tokens, or OTP codes anywhere — including console/log output — even during debugging; show generic failure messages for auth errors like 401/429. Never generate or display OTP codes in the client; the authenticator app computes them. Confidence: 0.9
- Never send secrets to third-party services (e.g., render QR/secrets client-side with a local library instead of an external QR API that would receive the secret). Confidence: 0.9
- Never connect the frontend directly to databases or object storage (SQLite/Turso/storage credentials); centralize the API base URL via environment configuration for local and cloud, remove hardcoded localhost from individual components, and never expose backend secrets in frontend config. Handle uploads/downloads only through backend endpoints or authorized storage URLs, and never construct local filesystem paths or assume files exist on the frontend server. Confidence: 0.9
- Drive all retry/cooldown logic from the server's Retry-After header, never from a locally computed timer. Confidence: 0.9
