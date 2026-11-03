# MasterDeOrca Frontend - Backend Switching Report

## Files Changed
1. `frontend/js/config.js` - Centralized API configuration with backend target switching
   - Added LOCAL_API_BASE and PROD_API_BASE constants
   - Added backend target persistence via localStorage (key: qpg_backend_target)
   - Added getCurrentBackendTarget(), setBackendTarget() functions
   - Production (Render) remains default; preserves localhost for local dev
   - Switching targets clears session tokens and reloads

2. `frontend/index.html` - Added backend selector UI in sidebar
   - Added backend selector dropdown (Local/Docker and Production/Render)
   - Added display showing current API base URL
   - Added module script to initialize selector and handle switching

3. `frontend/js/api/api-client.js` - Uses centralized config (already using API_BASE from config.js)
   - No changes needed - already uses shared configuration

4. `frontend/js/api/auth-api.js` - Uses apiClient (already centralized)
   - No changes needed

## How to Switch Backends
1. Open the UI
2. In the sidebar footer, use the "Backend" dropdown to select:
   - "Production (Render)" → https://qpengine-6f07.onrender.com
   - "Local (Docker)" → http://localhost:8000
3. Switching will clear the session token and reload the page - you'll need to login again
4. The current backend URL is displayed below the selector

## Verification
- All API calls go through apiClient which uses API_BASE from config.js
- No hardcoded backend URLs in API modules
- Token storage is isolated per session; switching clears tokens
- 401/403 errors handled by api-client
- Production remains default
