// Application Configuration
const LOCAL_API_BASE = "http://localhost:8000";
const PROD_API_BASE = "https://qpengine-6f07.onrender.com";
const BACKEND_TARGET_KEY = "qpg_backend_target"; // "local" or "production"

function getStoredBackendTarget() {
    try {
        if (typeof localStorage !== "undefined") {
            const stored = localStorage.getItem(BACKEND_TARGET_KEY);
            if (stored === "local" || stored === "production") {
                return stored;
            }
        }
    } catch (e) {}
    return null;
}

function getApiBaseForTarget(target) {
    if (target === "local") {
        return LOCAL_API_BASE;
    }
    if (target === "production") {
        return PROD_API_BASE;
    }
    return PROD_API_BASE;
}

function resolveApiBase() {
    // Environment-based configuration with Render backend as production default
    let candidate =
        window.QPG_API_BASE ||
        window.QPG_API_URL ||
        (typeof process !== "undefined" && process.env && process.env.QPG_API_BASE) ||
        (typeof import.meta !== "undefined" && import.meta.env && (import.meta.env.VITE_API_BASE || import.meta.env.VITE_QPG_API_BASE));

    // Allow overriding via meta tag
    if (!candidate) {
        const meta = document.querySelector('meta[name="qpg-api-base"]');
        if (meta && meta.content) candidate = meta.content.trim();
    }

    // Check for stored backend target preference
    const storedTarget = getStoredBackendTarget();
    if (storedTarget && !candidate) {
        candidate = getApiBaseForTarget(storedTarget);
    }

    // Check for local development indicators
    const isLocalDev =
        typeof location !== "undefined" &&
        (location.hostname === "localhost" ||
         location.hostname === "127.0.0.1" ||
         location.hostname === "[::1]" ||
         location.port === "3000" ||
         location.port === "5173" ||
         location.port === "8080");

    if (!candidate) {
        if (storedTarget) {
            candidate = getApiBaseForTarget(storedTarget);
        } else if (isLocalDev) {
            candidate = LOCAL_API_BASE;
        } else {
            candidate = PROD_API_BASE;
        }
    }

    // Ensure we don't accidentally use localhost in production contexts if no explicit local target
    if (!storedTarget && !isLocalDev && String(candidate).includes("localhost")) {
        candidate = PROD_API_BASE;
    }

    return String(candidate).replace(/\/+$/, "");
}

export const API_BASE = resolveApiBase();
export const LOCAL_API_BASE_URL = LOCAL_API_BASE;
export const PROD_API_BASE_URL = PROD_API_BASE;
export const BACKEND_TARGET_STORAGE_KEY = BACKEND_TARGET_KEY;
export const TOKEN_KEY = "qpg_token";

export function getCurrentBackendTarget() {
    const base = API_BASE;
    if (base === LOCAL_API_BASE) {
        return "local";
    }
    if (base === PROD_API_BASE) {
        return "production";
    }
    // Try to infer from stored
    const stored = getStoredBackendTarget();
    if (stored) return stored;
    return "production";
}

export function setBackendTarget(target) {
    if (target !== "local" && target !== "production") {
        return;
    }
    try {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem(BACKEND_TARGET_KEY, target);
        }
    } catch (e) {}
    // Clear session when switching backends to avoid token reuse
    try {
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.removeItem(TOKEN_KEY);
        }
    } catch (e) {}
    // Reload to apply new API base
    if (typeof window !== "undefined") {
        window.location.reload();
    }
}
