// Application Configuration
function resolveApiBase() {
    let candidate = window.QPG_API_BASE || window.QPG_API_URL;
    if (!candidate) {
        const meta = document.querySelector('meta[name="qpg-api-base"]');
        if (meta && meta.content) candidate = meta.content.trim();
    }
    if (!candidate) candidate = "http://localhost:8000";
    return candidate.replace(/\/+$/, "");
}
export const API_BASE = resolveApiBase();
export const TOKEN_KEY = "qpg_token";
