/* Smart QPG frontend.
   Generic client for the FastAPI backend described in for_ui_developers.md.
   Override the base URL before this script loads: window.QPG_API_BASE = "https://host"; */

const LOCAL_API_BASE = "http://localhost:8000";
const PROD_API_BASE = "https://qpengine-6f07.onrender.com";
const BACKEND_TARGET_KEY = "qpg_backend_target"; // "local" | "production"

function isLocalDevHost() {
    try {
        const h = (typeof location !== "undefined") ? location.hostname : "";
        const p = (typeof location !== "undefined") ? location.port : "";
        return h === "localhost" || h === "127.0.0.1" || h === "[::1]" ||
            p === "3000" || p === "5173" || p === "8080";
    } catch (e) { return false; }
}

function envPreferredTarget() {
    return isLocalDevHost() ? "local" : "production";
}

function getStoredBackendTarget() {
    try {
        const v = localStorage.getItem(BACKEND_TARGET_KEY);
        if (v === "local" || v === "production") return v;
    } catch (e) {}
    return null;
}

function targetToBase(t) {
    return (t === "local") ? LOCAL_API_BASE : PROD_API_BASE;
}

function tokenKeyFor(t) {
    return "qpg_token_" + ((t === "local") ? "local" : "production");
}

// Allow explicit override via globals/meta/script attr (highest priority).
function explicitApiOverride() {
    let candidate = (typeof window !== "undefined") ? (window.QPG_API_BASE || window.QPG_API_URL) : null;
    if (!candidate) {
        try {
            const meta = document.querySelector('meta[name="qpg-api-base"]');
            if (meta && meta.content) candidate = meta.content.trim();
        } catch (e) {}
    }
    if (!candidate) {
        try {
            const scriptTag = document.currentScript || document.querySelector('script[data-api-base]');
            if (scriptTag && scriptTag.getAttribute("data-api-base")) candidate = scriptTag.getAttribute("data-api-base").trim();
        } catch (e) {}
    }
    return candidate ? String(candidate).replace(/\/+$/, "") : null;
}

const __overrideBase = explicitApiOverride();

// Active backend target state
let activeBackendTarget = (function () {
    if (__overrideBase) {
        // infer target from override
        if (__overrideBase.indexOf("localhost") !== -1 || __overrideBase.indexOf("127.0.0.1") !== -1) return "local";
        return "production";
    }
    const stored = getStoredBackendTarget();
    if (stored) return stored;
    return envPreferredTarget();
})();

// migrate legacy token into target-specific storage
(function migrateLegacyToken() {
    try {
        const legacy = sessionStorage.getItem("qpg_token");
        if (legacy) {
            const k = tokenKeyFor(activeBackendTarget);
            if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, legacy);
        }
    } catch (e) {}
})();

let API_BASE = __overrideBase || targetToBase(activeBackendTarget);

function getToken() {
    return sessionStorage.getItem(tokenKeyFor(activeBackendTarget));
}

function setToken(token) {
    sessionStorage.setItem(tokenKeyFor(activeBackendTarget), token);
}

function clearSession() {
    try { sessionStorage.removeItem(tokenKeyFor(activeBackendTarget)); } catch (e) {}
    try { sessionStorage.removeItem("qpg_token"); } catch (e) {}
}

function clearAllSessions() {
    try { sessionStorage.removeItem(tokenKeyFor("local")); } catch (e) {}
    try { sessionStorage.removeItem(tokenKeyFor("production")); } catch (e) {}
    try { sessionStorage.removeItem("qpg_token"); } catch (e) {}
}

function getCurrentBackendTarget() { return activeBackendTarget; }

function targetForBase(base) {
    return (base === LOCAL_API_BASE) ? "local" : "production";
}

function setBackendTarget(target) {
    if (target !== "local" && target !== "production") return;
    if (target === activeBackendTarget) return;
    activeBackendTarget = target;
    API_BASE = targetToBase(target);
    try { localStorage.setItem(BACKEND_TARGET_KEY, target); } catch (e) {}
    if (typeof window !== "undefined") window.location.reload();
}

function hasSessionFor(t) {
    try { return !!sessionStorage.getItem(tokenKeyFor(t)); } catch (e) { return false; }
}

// reachability probe (no-cors, short timeout)
function probeBackend(base, timeoutMs) {
    return new Promise(function (resolve) {
        let ctrl = null;
        try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
        const timer = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (e) {} }, timeoutMs || 3000);
        try {
            fetch(base + "/health", { method: "GET", mode: "no-cors", cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
                .then(function () { clearTimeout(timer); resolve(true); })
                .catch(function () { clearTimeout(timer); resolve(false); });
        } catch (e) {
            clearTimeout(timer);
            resolve(false);
        }
    });
}

// Auto-detect best backend. Returns a promise.
let backendInitPromise = (async function () {
    // If explicit override, trust it.
    if (__overrideBase) {
        updateBackendSelectorUI();
        return;
    }
    // If an active session exists, keep its target (avoid switching mid-session).
    if (hasSessionFor("local") || hasSessionFor("production")) {
        if (!hasSessionFor(activeBackendTarget)) {
            activeBackendTarget = hasSessionFor("local") ? "local" : "production";
            API_BASE = targetToBase(activeBackendTarget);
        }
        try { localStorage.setItem(BACKEND_TARGET_KEY, activeBackendTarget); } catch (e) {}
        updateBackendSelectorUI();
        return;
    }
    // No session: probe preferred target, fall back to other if unreachable.
    const stored = getStoredBackendTarget();
    let preferred = stored || envPreferredTarget();
    // On deployed (non-local) UI, never default to local silently; preferred already production unless stored.
    const preferredReachable = await probeBackend(targetToBase(preferred), 3000);
    if (preferredReachable) {
        activeBackendTarget = preferred;
    } else {
        const other = (preferred === "local") ? "production" : "local";
        // On deployed UI, do not switch to localhost unless genuinely reachable.
        if (!(other === "local" && !isLocalDevHost())) {
            const otherReachable = await probeBackend(targetToBase(other), 3000);
            if (otherReachable) activeBackendTarget = other;
        }
    }
    API_BASE = targetToBase(activeBackendTarget);
    try { localStorage.setItem(BACKEND_TARGET_KEY, activeBackendTarget); } catch (e) {}
    updateBackendSelectorUI();
})();

// Fallback coordination
let backendSwitchCooldownUntil = 0;

function tryFallbackBackend() {
    const now = Date.now();
    if (now < backendSwitchCooldownUntil) return false;
    backendSwitchCooldownUntil = now + 60000;
    const other = (activeBackendTarget === "local") ? "production" : "local";
    // Never fall back to localhost on deployed UI unless reachable (probe synchronously-ish via cached? attempt)
    activeBackendTarget = other;
    API_BASE = targetToBase(other);
    try { localStorage.setItem(BACKEND_TARGET_KEY, other); } catch (e) {}
    clearSession();
    return true;
}

async function handleBackendFailureAndMaybeSwitch() {
    const now = Date.now();
    if (now < backendSwitchCooldownUntil) return false;
    backendSwitchCooldownUntil = now + 60000;
    const other = (activeBackendTarget === "local") ? "production" : "local";
    // deployed UI: don't switch to local unless reachable
    if (other === "local" && !isLocalDevHost()) {
        const r = await probeBackend(LOCAL_API_BASE, 2000);
        if (!r) return false;
    } else {
        const r = await probeBackend(targetToBase(other), 2000);
        if (!r) return false;
    }
    activeBackendTarget = other;
    API_BASE = targetToBase(other);
    try { localStorage.setItem(BACKEND_TARGET_KEY, other); } catch (e) {}
    clearSession();
    if (typeof window !== "undefined") window.location.reload();
    return true;
}

function updateBackendSelectorUI() {
    try {
        const sel = document.getElementById("backendTargetSelect");
        if (sel) sel.value = activeBackendTarget;
        const disp = document.getElementById("backendTargetDisplay");
        if (disp) disp.textContent = API_BASE;
    } catch (e) {}
}

// Expose for debugging/external
if (typeof window !== "undefined") {
    window.QPG_BACKEND = {
        get active() { return activeBackendTarget; },
        get base() { return API_BASE; },
        set: setBackendTarget,
        clearAll: clearAllSessions
    };
}

function decodeToken(token) {
    try {
        const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(payload));
    } catch (error) {
        return {};
    }
}

let onUnauthorized = null;

/* api(path, { method, body, form, headers }) — generic request helper.
   body: JSON-serializable value. form: FormData (multipart). */
const SENSITIVE_KEYS = ["password", "token", "access_token", "authorization", "secret", "api_key", "apikey"];

function redactValue(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(redactValue);
    if (typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value)) {
            if (SENSITIVE_KEYS.indexOf(String(key).toLowerCase()) !== -1) {
                out[key] = "[REDACTED]";
            } else {
                out[key] = redactValue(value[key]);
            }
        }
        return out;
    }
    return value;
}

function redactHeaders(headers) {
    const out = { ...(headers || {}) };
    for (const key of Object.keys(out)) {
        if (SENSITIVE_KEYS.indexOf(String(key).toLowerCase()) !== -1 || String(key).toLowerCase() === "authorization") {
            out[key] = "[REDACTED]";
        }
    }
    return out;
}

async function apiRequest(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const __startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
    try {
        if (typeof console !== "undefined" && console.debug) {
            const __body = options.form ? "[FormData]" : (options.body !== undefined ? redactValue(options.body) : undefined);
            console.debug("[api] request", options.method || "GET", path, { headers: redactHeaders(headers), body: __body });
        }
    } catch (e) {}
    const token = getToken();

    if (options.authToken) {
        headers.Authorization = "Bearer " + options.authToken;
    } else if (token && !options.skipAuth) {
        headers.Authorization = "Bearer " + token;
    }

    if (options.form) {
        options.body = options.form;
    } else if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(options.body);
    }

    let response;

    try {
        const fetchOptions = { ...options, headers };
        delete fetchOptions.authToken;
        delete fetchOptions.skipAuth;
        response = await fetch(API_BASE + path, fetchOptions);
    } catch (error) {
        // Attempt fallback backend on network failure.
        try {
            const switched = await handleBackendFailureAndMaybeSwitch();
            if (switched) {
                throw new Error("Backend switched to " + API_BASE + ". Please retry.");
            }
        } catch (e) {
            if (e && e.message && e.message.indexOf("Backend switched") !== -1) throw e;
        }
        throw new Error("Cannot reach server at " + API_BASE);
    }

    try {
        if (typeof console !== "undefined" && console.debug) {
            const __duration = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - __startedAt);
            console.debug("[api] response", options.method || "GET", path, response.status, response.statusText, { duration_ms: __duration });
        }
    } catch (e) {}

    if (response.status === 401) {
        let payload = {};
        try { payload = await response.json(); } catch (_) {}
        const detail = typeof payload.detail === "string" ? payload.detail : (payload.message || "Unauthorized");
        const error = new Error(detail);
        error.status = 401;
        error.retryAfter = response.headers.get("Retry-After");
        error.data = payload;
        throw error;
    }

    if (response.status === 403) {
        const error = new Error("Your account does not have permission to perform this action.");
        error.status = 403;
        throw error;
    }

    if (!response.ok) {
        let message = response.status + " " + response.statusText;
        let errorData = {};

        try {
            const data = await response.json();
            errorData = data || {};

            if (Array.isArray(data.errors)) {
                message = data.errors.map(item => [item.field, item.message].filter(Boolean).join(": ")).join("; ");
            } else if (data.detail) {
                if (typeof data.detail === "string") {
                    message = data.detail;
                } else if (Array.isArray(data.detail)) {
                    message = data.detail.map(function (item) {
                        const field = Array.isArray(item.loc) ? item.loc.slice(1).join(".") : "";
                        const text = item.msg || item.message || JSON.stringify(item);
                        return field ? field + ": " + text : text;
                    }).join("; ");
                } else if (data.detail.message) {
                    message = data.detail.message;
                } else {
                    message = "Request failed. Please check the entered values.";
                }
            } else if (data.message) {
                message = data.message;
            }
        } catch (error) {
            /* keep status text */
        }
        const error = new Error(message);
        error.status = response.status;
        error.retryAfter = response.headers.get("Retry-After");
        error.data = errorData;
        throw error;
    }

    if (response.status === 204) return null;

    const contentType = response.headers.get("Content-Type") || "";

    if (contentType.includes("application/json")) return response.json();
    if (contentType.includes("text/")) return response.text();
    return response.blob();
}

function api(path, options = {}) {
    return apiRequest(path, options).catch(function (error) {
        if (error && error.status === 401) {
            clearSession();
            if (typeof onUnauthorized === "function") onUnauthorized();
            throw new Error("Session expired. Please log in again.");
        }
        throw error;
    });
}

let toastTimer = null;

function showToast(message) {
    const toast = document.getElementById("toast");

    if (!toast) {
        return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
        toast.classList.remove("show");
    }, 3500);
}

function escapeHTML(value) {
    const amp = "&" + "amp;";
    const map = {
        "&": amp,
        "<": "&" + "lt;",
        ">": "&" + "gt;",
        '"': "&" + "quot;",
        "'": "&" + "#039;"
    };

    return String(value ?? "").replace(/[&<>"']/g, function (char) {
        return map[char];
    });
}

/* State helpers for loading / empty / error UI. */

function stateHTML(icon, message, kind) {
    return '<div class="empty-state' + (kind ? " " + kind : "") + '">' +
        '<div class="empty-icon">' + icon + "</div>" +
        "<p>" + escapeHTML(message) + "</p></div>";
}

function tableStateHTML(icon, message, kind, columns) {
    return '<tr><td colspan="' + (columns || 5) + '" class="state-cell' +
        (kind ? " " + kind : "") + '">' +
        (kind === "loading" ? '<span class="spinner"></span>' : "") +
        escapeHTML(message) + "</td></tr>";
}

function setButtonLoading(button, loading, label) {
    if (!button) return;

    if (loading) {
        button.dataset.label = button.textContent;
        button.classList.add("loading");
        button.disabled = true;
        if (label) button.textContent = label;
    } else {
        button.classList.remove("loading");
        button.disabled = false;
        if (button.dataset.label) button.textContent = button.dataset.label;
    }
}

/* Suffix for errors from endpoints documented as Proposed in
   backend_services.md — keeps pending integration explicit in the UI. */

function pendingNote(message) {
    return message;
}

function debounce(fn, ms) {
    let timer = null;
    return function () {
        clearTimeout(timer);
        timer = setTimeout(fn, ms);
    };
}

document.addEventListener("DOMContentLoaded", function () {

    onUnauthorized = showLoginPage;

    /* ELEMENTS */

    const loginPage = document.getElementById("loginPage");
    const application = document.getElementById("application");

    const loginForm = document.getElementById("loginForm");
    const loginEmail = document.getElementById("loginEmail");
    const loginPassword = document.getElementById("loginPassword");
    const loginButton = document.getElementById("loginButton");
    const loginMessage = document.getElementById("loginMessage");
    const loginTotpCode = document.getElementById("loginTotpCode");
    const loginTotpGroup = document.getElementById("loginTotpGroup");
    const totpCountdown = document.getElementById("totpCountdown");
    const loginCooldown = document.getElementById("loginCooldown");
    const toggleLoginPassword = document.getElementById("toggleLoginPassword");
    const logoutButton = document.getElementById("logoutButton");

    const teacherNavigation = document.getElementById("teacherNavigation");
    const adminNavigation = document.getElementById("adminNavigation");

    const pageTitle = document.getElementById("pageTitle");
    const pageSubtitle = document.getElementById("pageSubtitle");
    let redirectAfterLogin = null;
    let loginChallenge = null;
    let cooldownUntil = 0;
    let cooldownTimer = null;
    let loggingIn = false;

    /* PAGE VISIBILITY */

    function showLoginPage() {
        const currentPath = window.location.pathname;
        if (currentPath !== "/login" && currentPath !== "/") {
            redirectAfterLogin = currentPath + window.location.search;
        }
        if (window.location.pathname !== "/login") {
            window.history.replaceState({ pageId: "login" }, "", "/login");
        }
        if (loginPage) loginPage.classList.remove("hidden");
        if (application) application.classList.add("hidden");
        if (teacherNavigation) teacherNavigation.classList.add("hidden");
        if (adminNavigation) adminNavigation.classList.add("hidden");

        // Keyboard-first: land on the first empty field so Enter-to-login works
        // immediately. Enter inside any field submits the form natively.
        if (loginEmail && !loginEmail.value) loginEmail.focus();
        else if (loginPassword && !loginPassword.value) loginPassword.focus();
        else if (loginTotpGroup && !loginTotpGroup.classList.contains("hidden") &&
                 loginTotpCode && !loginTotpCode.value) loginTotpCode.focus();
    }

    function showApplication() {
        if (!currentUser || !getToken()) {
            showLoginPage();
            return;
        }
        if (loginPage) loginPage.classList.add("hidden");
        if (application) application.classList.remove("hidden");
        const isAdmin = isAdminUser();
        if (teacherNavigation) teacherNavigation.classList.toggle("hidden", isAdmin);
        if (adminNavigation) adminNavigation.classList.toggle("hidden", !isAdmin);

        const returnPath = redirectAfterLogin;
        redirectAfterLogin = null;
        const initialPage = (returnPath && resolveRoute(returnPath.split("?")[0])) || resolveRoute(window.location.pathname) ||
            (isAdminUser() ? "admin-dashboard" : "teacher-dashboard");
        navigateToPage(initialPage, { replace: true });
    }

    /* ROLE + CURRENT USER
       Current user and role are owned by /auth/me. */

    let currentUser = null;

    function isAdminUser() {
        return Boolean(currentUser && String(currentUser.role).toLowerCase() === "admin");
    }

    let currentUserAssignments = null;
    let currentUserPermissions = {};

    async function loadCurrentUserAssignments() {
        if (!currentUser) return;
        try {
            const data = await api(`/users/${currentUser.id || currentUser.user_id}/subjects`);
            currentUserAssignments = data;
            // Build permissions map
            const assignments = data.assignments || data.subjects || data.data || [];
            currentUserPermissions = {};
            (Array.isArray(assignments) ? assignments : []).forEach(a => {
                const subj = a.subject_id || a.subject || a.subjectName;
                if (subj) {
                    currentUserPermissions[subj] = {
                        accessPapers: a.access_question_papers ?? a.accessPapers ?? a.permissions?.accessPapers ?? a.permissions?.questionPapers ?? true,
                        uploadProcess: a.upload_process ?? a.uploadProcess ?? a.permissions?.uploadProcess ?? a.permissions?.process ?? true,
                        manageBank: a.manage_question_bank ?? a.manageBank ?? a.permissions?.manageBank ?? a.permissions?.questionBank ?? true,
                        generate: a.generate_papers ?? a.generatePapers ?? a.permissions?.generate ?? a.permissions?.generatePapers ?? true
                    };
                }
            });
        } catch (error) {
            try {
                const data = await api(`/teachers/me/subjects`);
                currentUserAssignments = data;
                const assignments = data.assignments || data.subjects || [];
                currentUserPermissions = {};
                (Array.isArray(assignments) ? assignments : []).forEach(a => {
                    const subj = a.subject_id || a.subject || a.subjectName;
                    if (subj) {
                        currentUserPermissions[subj] = {
                            accessPapers: a.access_question_papers ?? a.accessPapers ?? true,
                            uploadProcess: a.upload_process ?? a.uploadProcess ?? true,
                            manageBank: a.manage_question_bank ?? a.manageBank ?? true,
                            generate: a.generate_papers ?? a.generatePapers ?? true
                        };
                    }
                });
            } catch (e) {
                currentUserAssignments = null;
                currentUserPermissions = {};
            }
        }
    }

    async function loadCurrentUser() {
        if (!getToken()) return false;
        try {
            currentUser = await api("/auth/me");
            updateUserUI();
            applyRoleUI();
            if (isAdminUser()) await loadAdminAccessMode();
            if (!isAdminUser()) {
                await loadCurrentUserAssignments();
            }
            return true;
        } catch (error) {
            if (error.status === 401) clearSession();
            currentUser = null;
            if (error.status !== 401) throw error;
            return false;
        }
    }

    /* ADMIN ACCESS MODE
       The active mode is owned by the backend session (S32): GET
       /auth/access-mode returns the persisted mode, PUT persists a change.
       No access-mode state is stored client-side — only the last value the
       backend confirmed is kept in memory. While S32 is missing, the
       documented fallback applies (same precedent as the /auth/me role
       fallback): administrators get Edit Mode. */

    let adminAccessMode = "edit";
    let accessModeBackendAvailable = true;
    let accessModeSavePending = false;

    function applyAccessModeUI() {
        document.body.classList.toggle("access-readonly", adminAccessMode === "read_only");
        const status = document.getElementById("accessModeStatus");
        if (status) status.textContent = adminAccessMode === "read_only" ? "Read-only Mode" : "Edit Mode";
        const readOnly = document.getElementById("accessModeReadOnly");
        const editMode = document.getElementById("accessModeEdit");
        if (readOnly) readOnly.setAttribute("aria-checked", String(adminAccessMode === "read_only"));
        if (editMode) editMode.setAttribute("aria-checked", String(adminAccessMode !== "read_only"));
        const notice = document.getElementById("accessModeNotice");
        if (notice) {
            if (!accessModeBackendAvailable) {
                notice.textContent = "The access-mode endpoint (S32) is not available on the backend yet, so the session default (Edit Mode) is shown. Mode changes cannot be persisted until it ships.";
                notice.classList.remove("hidden");
            } else {
                notice.classList.add("hidden");
                notice.textContent = "";
            }
        }
    }

    function setAccessModeButtonsDisabled(disabled) {
        ["accessModeReadOnly", "accessModeEdit"].forEach(function (id) {
            const button = document.getElementById(id);
            if (button) button.disabled = disabled;
        });
    }

    async function loadAdminAccessMode() {
        if (!isAdminUser()) {
            adminAccessMode = "edit";
            accessModeBackendAvailable = true;
            document.body.classList.remove("access-readonly");
            return;
        }
        try {
            const data = await api("/auth/access-mode");
            adminAccessMode = (data && data.mode === "read_only") ? "read_only" : "edit";
            accessModeBackendAvailable = true;
        } catch (error) {
            adminAccessMode = "edit";
            accessModeBackendAvailable = false;
        }
        applyAccessModeUI();
    }

    async function setAdminAccessMode(mode) {
        if (accessModeSavePending || mode === adminAccessMode) { applyAccessModeUI(); return; }
        accessModeSavePending = true;
        setAccessModeButtonsDisabled(true);
        try {
            const data = await api("/auth/access-mode", { method: "PUT", body: { mode: mode } });
            adminAccessMode = (data && data.mode === "read_only") ? "read_only" : "edit";
            accessModeBackendAvailable = true;
            applyAccessModeUI();
            showToast(mode === "read_only"
                ? "Read-only mode active. Write actions are hidden."
                : "Edit mode active. Administrative actions are restored.");
        } catch (error) {
            applyAccessModeUI();
            if (error.status === 403) {
                showToast("Your account does not have permission to change the access mode.");
            } else if (error.status === 404 || error.status === 405 || error.status === 501) {
                accessModeBackendAvailable = false;
                applyAccessModeUI();
                showToast("Mode not changed: " + error.message);
            } else {
                showToast(error.message);
            }
        } finally {
            accessModeSavePending = false;
            setAccessModeButtonsDisabled(false);
        }
    }

    const accessModeReadOnlyButton = document.getElementById("accessModeReadOnly");
    const accessModeEditButton = document.getElementById("accessModeEdit");

    if (accessModeReadOnlyButton) {
        accessModeReadOnlyButton.addEventListener("click", function () {
            setAdminAccessMode("read_only");
        });
    }

    if (accessModeEditButton) {
        accessModeEditButton.addEventListener("click", function () {
            setAdminAccessMode("edit");
        });
    }

    function applyRoleUI() {
        const isAdmin = Boolean(currentUser && currentUser.role === "admin");
        if (teacherNavigation) teacherNavigation.classList.toggle("hidden", isAdmin);
        if (adminNavigation) adminNavigation.classList.toggle("hidden", !isAdmin);

        document.querySelectorAll("[data-admin]").forEach(function (element) {
            element.classList.toggle("hidden", !isAdmin);
        });
        ["createSubjectForm", "pyqUpload"].forEach(function (id) {
            const element = document.getElementById(id);
            if (element) (id === "pyqUpload" ? element.closest("label") : element)?.classList.toggle("hidden", !isAdmin);
        });
        document.querySelectorAll('#teacherNavigation [data-page="teacher-subjects"], #teacherNavigation [data-page="teacher-pyqs"]').forEach(element => element.classList.toggle("hidden", !isAdmin));

        const role = currentUser ? currentUser.role : "—";

        ["profileRole", "adminProfileRole"].forEach(function (id) {
            const element = document.getElementById(id);
            if (element) element.textContent = role;
        });
    }

    function updateUserUI() {
        const name = currentUser?.name || currentUser?.email || "";
        const email = currentUser?.email || "";
        const firstLetter = name.charAt(0).toUpperCase();

        const fields = {
            sidebarUserName: name,
            sidebarUserRole: currentUser?.role || "",
            topbarUserName: name,
            teacherWelcomeName: name,
            adminWelcomeName: name,
            profileName: name,
            profileEmail: email,
            profileDepartment: currentUser?.department || "—",
            profileStatus: currentUser?.status || "—",
            adminProfileName: name,
            adminProfileEmail: email,
            adminProfileStatus: currentUser?.status || "—"
        };

        Object.keys(fields).forEach(function (id) {
            const element = document.getElementById(id);
            if (element) element.textContent = fields[id];
        });

        ["sidebarAvatar", "profileAvatar"].forEach(function (id) {
            const element = document.getElementById(id);
            if (element) element.textContent = firstLetter;
        });
    }

    /* PAGE INFORMATION */

    const pageInformation = {
        "teacher-dashboard": {
            title: "Dashboard",
            subtitle: "Overview of your question paper generation system"
        },
        "teacher-subjects": {
            title: "My Subjects",
            subtitle: "Subjects registered in the system"
        },
        "teacher-questions": {
            title: "Question Bank",
            subtitle: "Manage your question bank"
        },
        "teacher-pyqs": {
            title: "PYQs",
            subtitle: "Upload PDFs, process them and extract questions"
        },
        "teacher-generate": {
            title: "Generate Question Paper",
            subtitle: "Create a question paper using AI-assisted analysis"
        },
        "teacher-papers": {
            title: "My Papers",
            subtitle: "View and manage generated question papers"
        },
        "teacher-profile": {
            title: "Profile",
            subtitle: "Manage your profile information"
        },
        "teacher-help": {
            title: "Help",
            subtitle: "Get help with the question paper generator"
        },
        "admin-dashboard": {
            title: "Admin Dashboard",
            subtitle: "Manage the question paper generation system"
        },
        "admin-teachers": {
            title: "Admin",
            subtitle: "Access mode and teacher management"
        },
        "admin-subjects": {
            title: "Subjects",
            subtitle: "Manage academic subjects"
        },
        "admin-assignments": {
            title: "Assignments",
            subtitle: "Assign subjects to teachers"
        },
        "admin-papers": {
            title: "Question Papers",
            subtitle: "View generated question papers"
        },
        "admin-activity": {
            title: "Activity",
            subtitle: "View system activities"
        },
        "admin-profile": {
            title: "Profile",
            subtitle: "Manage administrator profile"
        }
    };

    const pageLoaders = {
        "teacher-dashboard": loadSubjects,
        "teacher-subjects": loadSubjects,
        "teacher-pyqs": function () {
            return ensureSubjectsLoaded().then(function () {
                return loadPdfList();
            });
        },
        "teacher-generate": function () {
            return loadSubjects().then(function () { return loadBlueprints(); }).then(function () { return loadSavedConfigs(); });
        },
        "teacher-questions": function () { return loadSubjects().then(function () { return loadPyqQuestions(true); }); },
        "teacher-papers": loadPapers,
        "admin-papers": loadPapers,
        "admin-teachers": loadTeachers,
        "admin-subjects": loadSubjects,
        "admin-dashboard": function () {
            const teacherStat = document.getElementById("statAdminTotalTeachers");
            const subjectStat = document.getElementById("statAdminTotalSubjects");
            const questionStat = document.getElementById("statAdminTotalQuestions");
            const jobs = [];
            jobs.push(api("/api/dashboard/metrics").then(function (data) {
                if (teacherStat && data && typeof data.total_teachers === "number") {
                    teacherStat.textContent = String(data.total_teachers);
                } else if (teacherStat) {
                    return api("/teachers?page=1&page_size=1").then(function (d) {
                        const total = d && d.total;
                        if (typeof total === "number") teacherStat.textContent = String(total);
                    }).catch(function () {});
                }
                if (subjectStat && data && typeof data.total_subjects === "number") {
                    subjectStat.textContent = String(data.total_subjects);
                } else if (subjectStat) {
                    return api("/subjects").then(function (d) {
                        const subjects = d && Array.isArray(d.subjects) ? d.subjects : [];
                        subjectStat.textContent = String(subjects.length);
                    }).catch(function () {});
                }
                if (questionStat && data && typeof data.total_questions === "number") {
                    questionStat.textContent = String(data.total_questions);
                }
            }).catch(function () {
                if (teacherStat) {
                    jobs.push(api("/teachers?page=1&page_size=1").then(function (data) {
                        const total = data && data.total;
                        if (typeof total === "number") teacherStat.textContent = String(total);
                    }).catch(function () {}));
                }
                if (subjectStat) {
                    jobs.push(api("/subjects").then(function (data) {
                        const subjects = data && Array.isArray(data.subjects) ? data.subjects : [];
                        subjectStat.textContent = String(subjects.length);
                    }).catch(function () {}));
                }
            }));
            return Promise.all(jobs);
        }
    };

    const routeByPage = {
        "teacher-dashboard": "/dashboard", "admin-dashboard": "/dashboard",
        "teacher-subjects": "/subjects", "admin-subjects": "/subjects",
        "teacher-questions": "/question-bank", "teacher-pyqs": "/pyqs",
        "teacher-generate": "/generate-paper", "teacher-papers": "/my-papers",
        "admin-papers": "/my-papers", "admin-teachers": "/teachers",
        "teacher-profile": "/profile", "admin-profile": "/profile",
        "teacher-help": "/help", "admin-activity": "/activity"
    };
    const pageLoaded = new Set();
    let activePageId = null;

    function resolveRoute(pathname) {
        const path = pathname.replace(/\/+$/, "") || "/";
        if (path === "/login" || path === "/") return null;
        const pages = Object.keys(routeByPage).filter(function (pageId) {
            return routeByPage[pageId] === path;
        });
        if (!pages.length) return null;
        const admin = isAdminUser();
        if (!admin && ["/teachers", "/activity", "/subjects", "/pyqs"].includes(path)) return null;
        const preferred = pages.find(function (pageId) {
            return admin ? pageId.indexOf("admin-") === 0 : pageId.indexOf("teacher-") === 0;
        });
        return preferred || pages[0];
    }

    function navigateToPage(pageId, options) {
        const settings = options || {};
        const route = routeByPage[pageId];
        if (!route) return;
        if (!getToken()) {
            showLoginPage();
            return;
        }
        const method = settings.replace ? "replaceState" : "pushState";
        const search = window.location.pathname === route ? window.location.search : "";
        if (window.location.pathname !== route || settings.forceHistory) {
            window.history[method]({ pageId: pageId }, "", route + search);
        }
        showPage(pageId, { fromHistory: Boolean(settings.fromHistory) });
    }

    function showPage(pageId, options) {
        const settings = options || {};
        if (!getToken()) {
            showLoginPage();
            return;
        }

        // Check permissions for teachers
        if (!isAdminUser()) {
            try {
                const perms = currentUserPermissions || {};
                if (pageId === "teacher-pyqs") {
                    const hasPerm = Object.values(perms).some(p => p && p.uploadProcess);
                    if (!hasPerm && Object.keys(perms).length > 0) {
                        showToast("You don't have permission to upload/process question papers.");
                        return navigateToPage("teacher-dashboard");
                    }
                }
                if (pageId === "teacher-questions") {
                    const hasPerm = Object.values(perms).some(p => p && (p.manageBank || p.accessPapers));
                    if (!hasPerm && Object.keys(perms).length > 0) {
                        showToast("You don't have permission to access question bank.");
                        return navigateToPage("teacher-dashboard");
                    }
                }
                if (pageId === "teacher-generate") {
                    const hasPerm = Object.values(perms).some(p => p && p.generate);
                    if (!hasPerm && Object.keys(perms).length > 0) {
                        showToast("You don't have permission to generate question papers.");
                        return navigateToPage("teacher-dashboard");
                    }
                }
            } catch (e) {}
        }

        // Stop job polling when leaving the PYQs/processing screen.
        if (pageId !== "teacher-pyqs" && typeof stopAllPolling === "function") {
            stopAllPolling();
        }

        document
            .querySelectorAll(".page-section")
            .forEach(function (section) {
                if (section.id !== pageId) {
                    section.querySelectorAll("[data-totp-qr]").forEach(function (image) { image.removeAttribute("src"); image.classList.add("hidden"); });
                    section.querySelectorAll("[data-totp-enrollment]").forEach(function (panel) { panel.classList.add("hidden"); });
                }
                section.classList.add("hidden");
            });

        const viewId = pageId === "admin-subjects" ? "teacher-subjects" : pageId;
        const selectedPage = document.getElementById(viewId);

        if (!selectedPage) {
            console.error("Page not found:", pageId);
            return;
        }

        selectedPage.classList.remove("hidden");
        selectedPage.querySelectorAll("[data-totp-settings]").forEach(function (container) {
            loadTotpStatus(container);
        });
        activePageId = pageId;

        document
            .querySelectorAll(".nav-item")
            .forEach(function (item) {
                item.classList.remove("active");
                item.removeAttribute("aria-current");
            });

        const activeNav =
            document.querySelector('[data-page="' + pageId + '"]');

        if (activeNav) {
            activeNav.classList.add("active");
            activeNav.setAttribute("aria-current", "page");
        }

        const information = pageInformation[pageId];

        if (information) {
            if (pageTitle) pageTitle.textContent = information.title;
            if (pageSubtitle) pageSubtitle.textContent = information.subtitle;
        }

        const loader = pageLoaders[pageId];

        if (loader && !pageLoaded.has(pageId)) {
            pageLoaded.add(pageId);
            Promise.resolve(loader()).catch(function (error) {
                pageLoaded.delete(pageId);
                showToast(error.message);
            });
        }
        if ((pageId === "teacher-papers" || pageId === "admin-papers") && pageLoaded.has(pageId) && typeof fetchPapers === "function") {
            fetchPapers().catch(function () {});
        }

        if (window.innerWidth < 1024) {
            document.body.classList.remove("nav-open");

            if (mobileMenu) {
                mobileMenu.setAttribute("aria-expanded", "false");
                mobileMenu.setAttribute("aria-label", "Open sidebar");
                mobileMenu.setAttribute("title", "Open sidebar");
            }
        }

        if (!settings.fromHistory) window.scrollTo({ top: 0, behavior: "smooth" });
    }

    /* NAVIGATION */

    window.addEventListener("popstate", function () {
        if (!getToken()) {
            showLoginPage();
            return;
        }
        const pageId = (window.history.state && window.history.state.pageId) || resolveRoute(window.location.pathname);
        if (pageId) showPage(pageId, { fromHistory: true });
        else navigateToPage(isAdminUser() ? "admin-dashboard" : "teacher-dashboard", { replace: true });
    });

    document.addEventListener("click", function (event) {
        const nav = event.target.closest(".nav-item");

        if (nav && nav.getAttribute("data-page")) {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || nav.target === "_blank") return;
            event.preventDefault();
            navigateToPage(nav.getAttribute("data-page"));
            return;
        }

        const go = event.target.closest("[data-go]");

        if (go && go.getAttribute("data-go")) {
            navigateToPage(go.getAttribute("data-go"));
            return;
        }

        const open = event.target.closest("[data-open-subject]");

        if (open) {
            const subject = open.getAttribute("data-open-subject");
            const select = document.getElementById("pyqSubject");

            if (select) select.value = subject;

            navigateToPage("teacher-pyqs");
            return;
        }

        handleSubjectAction(event.target.closest("[data-subject-action]"));
    });

    /* Subject rename / remove (services S16a / S16b) */

    async function handleSubjectAction(button) {
        if (!button) return;

        const subject = button.getAttribute("data-subject");
        const action = button.getAttribute("data-subject-action");

        if (action === "rename") {
            const name = window.prompt(
                "Rename subject \"" + subject + "\" to:", subject);

            if (!name || name.trim() === subject) return;

            try {
                await api("/subjects/" + encodeURIComponent(subject), {
                    method: "PATCH",
                    body: { name: name.trim() }
                });
                showToast("Subject renamed to " + name.trim());
                loadSubjects().catch(function () {});
            } catch (error) {
                showToast(error.message);
            }
        }

        if (action === "remove") {
            const ok = await confirmAction(
                "Remove subject",
                "Remove \"" + subject + "\" with all its PDFs, results and " +
                "topics? This cannot be undone.",
                "Remove"
            );

            if (!ok) return;

            try {
                await api("/subjects/" + encodeURIComponent(subject), {
                    method: "DELETE"
                });
                showToast("Removed subject " + subject);
                loadSubjects().catch(function () {});
            } catch (error) {
                showToast(error.message);
            }
        }
    }

    /* LOGIN */

    /* TOTP challenge credentials stay in memory and are never persisted. */
    function responseValue(data, keys) {
        for (const key of keys) if (data && data[key] !== undefined && data[key] !== null) return data[key];
        return null;
    }

    function retrySeconds(error) {
        const raw = error?.retryAfter;
        const parsedDate = typeof raw === "string" && !/^\d+(\.\d+)?$/.test(raw) ? Date.parse(raw) : NaN;
        const seconds = Number.isFinite(parsedDate) ? Math.ceil((parsedDate - Date.now()) / 1000) : Number(raw);
        return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
    }

    function safeTotpError(error, fallback) {
        if (error?.status === 401) return "The authenticator code could not be verified.";
        if (error?.status === 429) return "Too many attempts. Wait for the countdown before trying again.";
        if (error?.status === 409) return "Authenticator verification is already enabled.";
        if (error?.status === 400) return "Start authenticator setup before confirming it.";
        return fallback;
    }

    function startServerCooldown(button, output, seconds) {
        if (!button || seconds <= 0) return;
        const until = Date.now() + seconds * 1000;
        button.disabled = true;
        if (output) output.classList.remove("hidden");
        const update = function () {
            const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
            if (output) output.textContent = remaining
                ? "Try again in " + String(Math.floor(remaining / 60)).padStart(2, "0") + ":" + String(remaining % 60).padStart(2, "0")
                : "";
            if (!remaining) {
                clearInterval(timer);
                button.disabled = false;
                if (output) output.classList.add("hidden");
            }
        };
        const timer = setInterval(update, 1000);
        update();
    }

    function clearCooldown() {
        if (cooldownTimer) clearInterval(cooldownTimer);
        cooldownTimer = null;
        cooldownUntil = 0;
        if (loginCooldown) { loginCooldown.textContent = ""; loginCooldown.classList.add("hidden"); }
        if (loginButton) loginButton.disabled = false;
    }

    function formatCountdown(seconds) {
        return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
    }

    /* Cooldown after a rate-limited verification. Driven purely by the
       server-provided Retry-After value, never by a local guess. */
    function startLoginRetryCountdown(seconds) {
        if (seconds <= 0) return;
        clearCooldown();
        if (!loginButton || !loginCooldown) return;
        loginButton.disabled = true;
        cooldownUntil = Date.now() + seconds * 1000;
        const update = function () {
            const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
            if (!remaining) { clearCooldown(); return; }
            loginCooldown.classList.remove("hidden");
            loginCooldown.textContent = "Too many attempts. Try again in " + formatCountdown(remaining);
        };
        cooldownTimer = setInterval(update, 1000);
        update();
    }

    /* Informational countdown mirroring the authenticator's interval, anchored
       to the Unix epoch like authenticator apps. The code shown by the app
       remains valid until the interval rolls over; the backend verifies every
       code against its own clock and skew policy. Never auto-submits. */
    const TOTP_INTERVAL = 30;

    function updateTotpCountdown() {
        if (!totpCountdown) return;
        const remaining = TOTP_INTERVAL - (Math.floor(Date.now() / 1000) % TOTP_INTERVAL);
        totpCountdown.textContent = "New code in " + formatCountdown(remaining);
    }

    if (totpCountdown) {
        updateTotpCountdown();
        setInterval(updateTotpCountdown, 1000);
    }

    /* Merged three-field login: email + password + TOTP code. The backend's
       documented contract is two-step (login returns a challenge, then the
       code is verified) — both calls are chained under the single submit so
       the user only sees one form. The challenge token stays in memory. */

    async function finishLogin(accessToken) {
        if (!accessToken) throw new Error("The server did not return an access token.");
        loginChallenge = null;
        clearCooldown();
        setToken(accessToken);
        try {
            if (!await loadCurrentUser()) throw new Error("Login succeeded but the backend did not return a valid current user.");
        } catch (error) {
            clearSession();
            currentUser = null;
            throw error;
        }
        loginForm?.reset();
        hideTotpField();
        showApplication();
        document.querySelectorAll("[data-totp-settings]").forEach(function (container) {
            loadTotpStatus(container);
        });
    }

    function markTotpError(error) {
        error.fromTotp = true;
        return error;
    }

    /* The OTP field is hidden until the backend accepts the email and
       password (requires_totp response), then revealed for code entry. */
    function showTotpField() {
        loginTotpGroup?.classList.remove("hidden");
        if (loginTotpCode && !loginTotpCode.value) loginTotpCode.focus();
    }

    function hideTotpField() {
        loginTotpGroup?.classList.add("hidden");
        if (loginTotpCode) loginTotpCode.value = "";
    }

    function challengeDetail(error) {
        const payload = error?.data || {};
        if (typeof payload.detail === "string") return payload.detail;
        return typeof payload.message === "string" ? payload.message : "";
    }

    /* Expired or reused challenges must restart the login silently; wrong
       codes must keep the form intact for correction instead. */
    function isChallengeExpired(error) {
        if (error?.status !== 401) return false;
        return /challenge.{0,30}(expir|reus|invalid)|(?:expir|reus).{0,30}challenge/i.test(challengeDetail(error));
    }

    function verifyLoginChallenge(challenge, code) {
        return apiRequest("/auth/totp/verify", {
            method: "POST",
            skipAuth: true,
            body: { challenge_token: challenge, code: code }
        });
    }

    async function handleLoginResponse(data, code) {
        // Inspect requires_totp before touching any token from this response.
        if (data?.requires_totp !== true) {
            await finishLogin(responseValue(data, ["access_token"]));
            return;
        }

        // Email and password were accepted — the OTP field now appears.
        showTotpField();
        loginChallenge = String(responseValue(data, ["challenge_token"]) || "");
        if (!loginChallenge) throw new Error("The server requested verification but did not return a challenge token.");

        if (!/^\d{6}$/.test(code)) {
            if (loginMessage) {
                loginMessage.textContent = "Enter the six-digit code from your authenticator app.";
                loginMessage.classList.add("error");
            }
            if (loginTotpCode) loginTotpCode.focus();
            return;
        }

        let verified;
        try {
            verified = await verifyLoginChallenge(loginChallenge, code);
        } catch (error) {
            if (!isChallengeExpired(error)) throw markTotpError(error);

            // Challenge expired or already used — restart the login silently
            // and give the entered code one more attempt with the new challenge.
            const restarted = await apiRequest("/auth/login", {
                method: "POST",
                skipAuth: true,
                body: { email: loginEmail.value.trim(), password: loginPassword.value }
            });

            if (restarted?.requires_totp !== true) {
                await finishLogin(responseValue(restarted, ["access_token"]));
                return;
            }

            loginChallenge = String(responseValue(restarted, ["challenge_token"]) || "");
            if (!loginChallenge) throw markTotpError(new Error("Please sign in again to continue."));

            try {
                verified = await verifyLoginChallenge(loginChallenge, code);
            } catch (error) {
                throw markTotpError(error);
            }
        }

        await finishLogin(responseValue(verified, ["access_token"]));
    }

    if (loginForm) {
        loginForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            if (loggingIn || Date.now() < cooldownUntil) return;

            const email = loginEmail ? loginEmail.value.trim() : "";
            const password = loginPassword ? loginPassword.value : "";
            const code = loginTotpCode ? loginTotpCode.value.replace(/\D/g, "") : "";

            if (loginMessage) {
                loginMessage.textContent = "";
                loginMessage.classList.remove("success", "error");
            }

            if (!email || !password) {
                if (loginMessage) {
                    loginMessage.textContent = "Please enter your email, password and authenticator code.";
                    loginMessage.classList.add("error");
                }
                if (!email && loginEmail) loginEmail.focus();
                else if (!password && loginPassword) loginPassword.focus();
                return;
            }

            // The OTP check only applies once the field has been revealed,
            // i.e. after the backend has accepted the email and password.
            const otpRequested = Boolean(loginTotpGroup) && !loginTotpGroup.classList.contains("hidden");
            if (otpRequested && !/^\d{6}$/.test(code)) {
                if (loginMessage) {
                    loginMessage.textContent = "Enter the six-digit code from your authenticator app.";
                    loginMessage.classList.add("error");
                }
                if (loginTotpCode) loginTotpCode.focus();
                return;
            }

            loggingIn = true;
            setButtonLoading(loginButton, true, "Signing in…");

            try {
                const data = await apiRequest("/auth/login", {
                    method: "POST",
                    body: { email: email, password: password },
                    skipAuth: true
                });

                await handleLoginResponse(data, code);
            } catch (error) {
                if (!error?.status) {
                    if (loginMessage) loginMessage.textContent = "Authentication service unavailable. Please try again.";
                } else if (error.fromTotp === true) {
                    if (error.status === 401) {
                        if (loginMessage) loginMessage.textContent = "The authenticator code could not be verified. Enter the current code and try again.";
                    } else if (error.status === 429) {
                        if (loginMessage) loginMessage.textContent = "Too many attempts. Wait for the countdown before trying again.";
                    } else {
                        if (loginMessage) loginMessage.textContent = error.message;
                    }
                } else if (error.status === 401) {
                    // Combined message — never hints whether the email exists.
                    if (loginMessage) loginMessage.textContent = "Invalid email or password.";
                    hideTotpField();
                } else {
                    if (loginMessage) loginMessage.textContent = error.message;
                }
                if (loginMessage) loginMessage.classList.add("error");

                // Failures keep the email, password and code in place so the
                // user can correct the code and retry without retyping.
                if (error?.status === 429) startLoginRetryCountdown(retrySeconds(error));
            } finally {
                loggingIn = false;
                setButtonLoading(loginButton, false);
                if (loginButton) loginButton.disabled = Boolean(cooldownUntil);
            }
        });
    }

    if (loginTotpCode) {
        loginTotpCode.addEventListener("input", function () {
            loginTotpCode.value = loginTotpCode.value.replace(/\D/g, "").slice(0, 6);
        });
    }

    function showTotpSettingsMessage(container, message, type) {
        const target = container?.querySelector("[data-totp-settings-message]");
        if (target) { target.textContent = message || ""; target.className = "form-message" + (type ? " " + type : ""); }
    }

    async function loadTotpStatus(container) {
        try {
            const status = await api("/auth/totp/status");
            const enabled = status?.totp_enabled === true;
            const enrolled = status?.totp_enrolled === true;
            container.dataset.totpEnabled = enabled ? "1" : "0";
            container.dataset.totpEnrolled = enrolled ? "1" : "0";
            container.dataset.totpPending = (enrolled && !enabled) ? "1" : "0";
            const toggle = container.querySelector("[data-totp-toggle]");
            if (toggle) { toggle.checked = enabled; toggle.disabled = false; }
            const text = container.querySelector("[data-totp-status]");
            if (text) text.textContent = enabled
                ? "Authenticator verification is enabled for your account."
                : enrolled
                    ? "Authenticator is enrolled but not enabled. Finish setup with a current code below."
                    : "Authenticator verification is not enabled.";
            container.querySelector("[data-totp-enroll-panel]")?.classList.toggle("hidden", enabled || enrolled);
            container.querySelector("[data-totp-pending-panel]")?.classList.toggle("hidden", enabled || !enrolled);
            container.querySelector("[data-totp-disable-form]")?.classList.toggle("hidden", !enabled);
        } catch (error) {
            const toggle = container.querySelector("[data-totp-toggle]");
            if (toggle) { toggle.checked = false; toggle.disabled = true; }
            const text = container.querySelector("[data-totp-status]");
            if (text) text.textContent = "Authenticator setup is currently unavailable.";
            showTotpSettingsMessage(container, "Could not load authenticator settings.", "error");
        }
    }

    document.querySelectorAll("[data-totp-settings]").forEach(function (container) {
        container.querySelector("[data-totp-enroll]")?.addEventListener("click", async function (event) {
            const button = event.currentTarget;
            if (container.dataset.totpPending === "1") {
                showTotpSettingsMessage(container, "Enrollment already started. Enter the code from your authenticator app to confirm it.", "info");
                container.querySelector("[data-totp-confirm-code]")?.focus();
                return;
            }
            setButtonLoading(button, true, "Preparing…");
            showTotpSettingsMessage(container, "", "");
            try {
                const result = await api("/auth/totp/enroll", { method: "POST" });
                const payload = result?.qr_code_payload || result?.provisioning_uri;
                if (typeof payload !== "string" || !payload.startsWith("otpauth://")) {
                    throw new Error("The server did not return valid authenticator setup information.");
                }
                const backendImage = typeof result?.qr_code_png_base64 === "string" ? result.qr_code_png_base64 : "";
                const image = container.querySelector("[data-totp-qr]");
                if (image) {
                    if (backendImage) {
                        image.src = "data:image/png;base64," + backendImage;
                    } else {
                        throw new Error("The server did not return a QR code image.");
                    }
                    image.classList.remove("hidden");
                }
                container.dataset.totpPending = "1";
                container.querySelector("[data-totp-enrollment]")?.classList.remove("hidden");
                container.querySelector("[data-totp-confirm-code]")?.focus();
            } catch (error) {
                container.dataset.totpPending = "0";
                showTotpSettingsMessage(container, (error && error.message) ? error.message : "Could not start authenticator setup. Please try again.", "error");
            } finally {
                setButtonLoading(button, false);
            }
        });

        container.querySelectorAll("[data-totp-confirm-code], [data-totp-disable-code]").forEach(function (field) {
            field.addEventListener("input", function () {
                field.value = field.value.replace(/\D/g, "").slice(0, 6);
            });
        });

        container.querySelectorAll("[data-totp-confirm-form]").forEach(function (form) {
            form.addEventListener("submit", async function (event) {
                event.preventDefault();
                const field = form.querySelector("[data-totp-confirm-code]");
                const button = form.querySelector("[type=submit]");
                const message = form.querySelector("[data-totp-enroll-message]");
                const cooldown = form.parentElement.querySelector("[data-totp-cooldown]");
                const code = String(field?.value || "");
                if (!/^\d{6}$/.test(code)) {
                    if (message) { message.textContent = "Enter all six digits from your authenticator app."; message.className = "form-message error"; }
                    return;
                }
                if (container.dataset.totpPending !== "1") {
                    if (message) { message.textContent = "Start authenticator setup before confirming it."; message.className = "form-message error"; }
                    return;
                }
                setButtonLoading(button, true, "Confirming…");
                let wait = 0;
                try {
                    const result = await apiRequest("/auth/totp/confirm", { method: "POST", body: { code: code } });
                    if (result?.totp_enabled !== true) throw new Error("Confirmation was not completed.");
                    if (message) { message.textContent = "Authenticator verification is now enabled."; message.className = "form-message success"; }
                    if (field) field.value = "";
                    container.dataset.totpPending = "0";
                    container.querySelector("[data-totp-enrollment]")?.classList.add("hidden");
                    const image = container.querySelector("[data-totp-qr]");
                    if (image) { image.removeAttribute("src"); image.classList.add("hidden"); }
                    await loadTotpStatus(container);
                } catch (error) {
                    if (message) { message.textContent = safeTotpError(error, "Could not confirm authenticator setup. Try again."); message.className = "form-message error"; }
                    wait = error.status === 429 ? retrySeconds(error) : 0;
                    if (field) { field.value = ""; if (!wait) field.focus(); }
                } finally {
                    setButtonLoading(button, false);
                    if (wait) startServerCooldown(button, cooldown, wait);
                }
            });
        });

        container.querySelector("[data-totp-disable-form]")?.addEventListener("submit", async function (event) {
            event.preventDefault();
            const form = event.currentTarget;
            const field = form.querySelector("[data-totp-disable-code]");
            const button = form.querySelector("[data-totp-disable]");
            const message = form.querySelector("[data-totp-disable-message]");
            const cooldown = form.querySelector("[data-totp-cooldown]");
            const code = String(field?.value || "");
            if (!/^\d{6}$/.test(code)) {
                if (message) { message.textContent = "Enter all six digits from your authenticator app."; message.className = "form-message error"; }
                return;
            }
            setButtonLoading(button, true, "Turning off…");
            let wait = 0;
            try {
                const result = await apiRequest("/auth/totp", { method: "DELETE", body: { code: code } });
                if (result?.totp_enabled !== false) throw new Error("Authenticator disable was not completed.");
                if (message) { message.textContent = "Authenticator verification has been disabled."; message.className = "form-message success"; }
                if (field) field.value = "";
                await loadTotpStatus(container);
            } catch (error) {
                if (message) { message.textContent = safeTotpError(error, "Could not disable authenticator verification. Try again."); message.className = "form-message error"; }
                wait = error.status === 429 ? retrySeconds(error) : 0;
                if (field) { field.value = ""; if (!wait) field.focus(); }
            } finally {
                setButtonLoading(button, false);
                if (wait) startServerCooldown(button, cooldown, wait);
            }
        });

        container.querySelector("[data-totp-toggle]")?.addEventListener("change", function (event) {
            const toggle = event.target;
            if (toggle.checked) {
                // Only the backend status turns the switch on for real; the
                // setup flows below must complete first.
                toggle.checked = false;
                showTotpSettingsMessage(container, "", "");
                if (container.dataset.totpEnrolled !== "1") {
                    showTotpSettingsMessage(container, "No authenticator secret is enrolled yet. Use Set up authenticator first.", "info");
                    toggle.checked = false;
                    return;
                }
                if (container.dataset.totpEnabled !== "1") {
                    // Existing secret is available; ask for a code to enable it.
                    container.querySelector("[data-totp-pending-panel] [data-totp-confirm-code]")?.focus();
                    return;
                }
            }
            if (container.dataset.totpEnabled === "1") {
                // Turning off cannot be bypassed client-side: the backend owns
                // enforcement, so a current code must confirm via the disable form.
                toggle.checked = true;
                const form = container.querySelector("[data-totp-disable-form]");
                form?.classList.remove("hidden");
                form?.querySelector("[data-totp-disable-code]")?.focus();
                const message = form?.querySelector("[data-totp-disable-message]");
                if (message) {
                    message.textContent = "Enter a current code to confirm turning off two-factor authentication.";
                    message.className = "form-message error";
                }
            }
        });
    });


    /* PASSWORD SHOW / HIDE */

    if (toggleLoginPassword && loginPassword) {
        toggleLoginPassword.addEventListener("click", function () {
            if (loginPassword.type === "password") {
                loginPassword.type = "text";
                toggleLoginPassword.textContent = "Hide";
            } else {
                loginPassword.type = "password";
                toggleLoginPassword.textContent = "Show";
            }
        });
    }

    /* LOGOUT */

    if (logoutButton) {
        logoutButton.addEventListener("click", function () {
            redirectAfterLogin = null;
            clearSession();

            if (loginForm) loginForm.reset();

            showLoginPage();

            if (loginEmail) loginEmail.focus();
        });
    }

    /* SUBJECTS */

    let subjectsCache = [];

    function fillSubjectSelect(select, firstOption) {
        if (!select) return;
        const current = select.value;

        select.innerHTML = firstOption + subjectsCache.map(function (subject) {
            return '<option value="' + escapeHTML(subject) + '">' +
                escapeHTML(subject) + "</option>";
        }).join("");

        if (subjectsCache.includes(current)) {
            select.value = current;
        }
    }

    async function loadSubjects() {
        const stat = document.getElementById("statSubjects");
        const dashList = document.getElementById("dashSubjectList");
        const grid = document.getElementById("subjectGrid");

        if (grid) {
            grid.innerHTML = '<div class="large-subject-card">' +
                '<h3><span class="spinner"></span> Loading subjects…</h3></div>';
        }

        try {
            if (isAdminUser()) {
                const data = await api("/subjects");
                subjectsCache = data.subjects || [];
            } else {
                // Teachers cannot enumerate /subjects (admin-only). Use only subject IDs
                // already present in their documented, authenticated blueprint records.
                const data = await api("/blueprints");
                blueprints = data.items || [];
                blueprintsLoaded = true;
                let assignedFromPerms = [];
                try {
                    if (!isAdminUser() && currentUserPermissions) {
                        assignedFromPerms = Object.keys(currentUserPermissions).filter(k => currentUserPermissions[k]);
                    }
                } catch (e) {}
                subjectsCache = Array.from(new Set([...(blueprints.map(item => item.subject_id).filter(Boolean)), ...assignedFromPerms]));
                if (grid) grid.innerHTML = stateHTML("▣", "Subjects assigned to you.");
                if (subjectsCache.length) {
                    if (dashList) {
                        dashList.innerHTML = subjectsCache.map(function (subject) {
                            return '<div class="subject-row">' +
                                '<div class="subject-code">' +
                                escapeHTML(String(subject).slice(0, 4).toUpperCase()) +
                                "</div>" +
                                "<div><strong>" + escapeHTML(subject) + "</strong></div>" +
                                "</div>";
                        }).join("");
                    }
                } else {
                    if (dashList) dashList.innerHTML = stateHTML("▣", "No subjects assigned. Contact your administrator to get subjects assigned.");
                    if (grid) grid.innerHTML = stateHTML("▣", "No subjects assigned. Contact your administrator to get subjects assigned.");
                }
                fillSubjectSelect(document.getElementById("pyqSubject"), '<option value="">Select subject</option>');
                fillSubjectSelect(document.getElementById("qbPyqSubject"), '<option value="" disabled selected>Select subject</option>');
                fillSubjectSelect(document.getElementById("paperSubject"), '<option value="">Select subject</option>');
                if (!subjectsCache.length) {
                    const qbRows = document.getElementById("pyqQuestionsTableBody");
                    if (qbRows) qbRows.innerHTML = '<tr><td colspan="2" class="state-cell">No subjects assigned. Contact your administrator to get subjects assigned.</td></tr>';
                    const message = "No subjects assigned. Contact your administrator.";
                    ["qbPyqSubject", "paperSubject", "pyqSubject"].forEach(function (id) {
                        const select = document.getElementById(id);
                        if (select && select.options && select.options[0]) select.options[0].textContent = message;
                    });
                }
                return;
            }
        } catch (error) {
            if (grid) {
                grid.innerHTML = stateHTML(
                    "⚠",
                    "Could not load subjects: " + error.message,
                    "error"
                );
            }
            throw error;
        }

        if (stat) stat.textContent = subjectsCache.length;

        if (dashList) {
            dashList.innerHTML = subjectsCache.length
                ? subjectsCache.map(function (subject) {
                    return '<div class="subject-row">' +
                        '<div class="subject-code">' +
                        escapeHTML(subject.slice(0, 4).toUpperCase()) +
                        "</div>" +
                        "<div><strong>" + escapeHTML(subject) + "</strong></div>" +
                        "</div>";
                }).join("")
                : stateHTML("▣", "No subjects yet. Create one in My Subjects.");
        }

        if (grid) {
            grid.innerHTML = subjectsCache.length
                ? subjectsCache.map(function (subject) {
                    return '<div class="large-subject-card">' +
                        "<h3>" + escapeHTML(subject) + "</h3>" +
                        '<div class="card-actions">' +
                        '<button class="btn btn-primary small" data-open-subject="' +
                        escapeHTML(subject) + '">Manage PDFs</button>' +
                    (isAdminUser() ? '<button class="btn btn-secondary small" data-subject-action="rename" data-subject="' +
                        escapeHTML(subject) + '">Rename</button>' +
                        '<button class="btn btn-danger small" data-subject-action="remove" data-subject="' +
                        escapeHTML(subject) + '">Remove</button>' : '') +
                        "</div></div>";
                }).join("")
                : stateHTML("▣", "No subjects yet. Create one above.");
        }

        fillSubjectSelect(document.getElementById("pyqSubject"), '<option value="">Select subject</option>');
        fillSubjectSelect(document.getElementById("qbPyqSubject"), '<option value="" disabled selected>Select subject</option>');
        fillSubjectSelect(document.getElementById("paperSubject"), '<option value="">Select subject</option>');
    }

    let subjectsLoadPromise = null;

    async function ensureSubjectsLoaded() {
        if (subjectsCache.length) return subjectsCache;
        if (subjectsLoadPromise) return subjectsLoadPromise;
        subjectsLoadPromise = loadSubjects().finally(function () {
            subjectsLoadPromise = null;
        });
        return subjectsLoadPromise;
    }

    const createSubjectForm = document.getElementById("createSubjectForm");

    if (createSubjectForm) {
        createSubjectForm.addEventListener("submit", async function (event) {
            event.preventDefault();

            const input = document.getElementById("newSubjectName");
            const name = input ? input.value.trim() : "";

            if (!name) return;

            try {
                await api("/subjects", {
                    method: "POST",
                    body: { name: name }
                });

                if (input) input.value = "";
                showToast("Subject created: " + name);
                loadSubjects().catch(function () {});
            } catch (error) {
                showToast(error.message);
            }
        });
    }

    /* PDF PIPELINE */

    function pdfPath(subject, filename) {
        return "/subjects/" + encodeURIComponent(subject) +
            "/pdfs/" + encodeURIComponent(filename);
    }

    function formatSize(bytes) {
        if (!Number.isFinite(bytes)) return "—";
        if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
        return Math.max(1, Math.round(bytes / 1024)) + " KB";
    }

    function statusBadge(status) {
        const normalized = (window.PYQStatus && typeof window.PYQStatus.normalizeStatus === "function")
            ? window.PYQStatus.normalizeStatus(status)
            : String(status || "").trim().toLowerCase();

        const map = {
            succeeded: ["ready", "Parsed"],
            completed: ["ready", "Parsed"],
            failed: ["failed", "Failed"],
            running: ["processing", "Processing"],
            queued: ["processing", "Queued"],
            processing: ["processing", "Processing"],
            pending: ["pending", "Pending"],
            not_processed: ["pending", "Not processed"]
        };

        const entry = map[normalized] || ["pending", status || "Unknown"];

        return '<span class="status ' + entry[0] + '" data-status="' + escapeHTML(normalized) + '">' +
            escapeHTML(entry[1]) + "</span>";
    }

    let pyqPdfItems = [];

    function pyqYear(item) {
        const year = item.academic_year || item.year;
        if (year != null && String(year).trim()) return String(year).trim();
        const match = String(item.filename || "").match(/(?:19|20)\d{2}/);
        return match ? match[0] : "";
    }

    function pyqActionIcon(action) {
        const paths = {
            process: '<path d="M5 3l14 9-14 9V3z"/>',
            result: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
            docx: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
            review: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
            remove: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>'
        };
        return '<svg class="pyq-action-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths[action] + '</svg>';
    }

    function renderPdfItems() {
       const tbody = document.getElementById("pyqTableBody");
       if (!tbody) return;
       const selectedSubject = document.getElementById("pyqSubject")?.value || "";
       const search = (document.getElementById("pyqSearch")?.value || "").trim().toLowerCase();
        const year = document.getElementById("pyqYearFilter")?.value || "";
        const status = document.getElementById("pyqStatusFilter")?.value || "";
        const items = pyqPdfItems.filter(function (item) {
            const itemStatus = (window.PYQStatus && typeof window.PYQStatus.normalizeStatus === "function")
                ? window.PYQStatus.normalizeStatus(item.status)
                : String(item.status || "").toLowerCase();
            const statusMatches = !status || (status === "completed"
                ? itemStatus === "completed" || itemStatus === "succeeded"
                : status === "processing" ? itemStatus === "processing" || itemStatus === "queued"
                    : status === "not_processed" ? itemStatus === "not_processed" || itemStatus === "pending"
                        : itemStatus === status);
            return (!search || String(item.filename || "").toLowerCase().includes(search)) &&
                (!year || pyqYear(item) === year) && statusMatches;
        });
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="1" class="state-cell">' +
                (pyqPdfItems.length ? "No PDFs match these filters." : "No PDFs uploaded yet. Use the Upload button above.") + '</td></tr>';
            return;
        }
        tbody.innerHTML = items.map(function (item) {
            const reviewed = item.review_status === "approved";
            const normalized = (window.PYQStatus && typeof window.PYQStatus.normalizeStatus === "function")
                ? window.PYQStatus.normalizeStatus(item.status)
                : String(item.status || "").toLowerCase();
            const busy = normalized === "processing" || normalized === "running" || normalized === "queued";
            const resultAvailable = item.result_available === true;
            const details = [];
            details.push('<span class="pyq-file-detail"><span class="pyq-detail-label">File size</span><strong>' + formatSize(item.size_bytes) + '</strong></span>');
            details.push('<span class="pyq-file-detail"><span class="pyq-detail-label">Result</span><strong class="pyq-result-value">' + (resultAvailable ? 'Available' : 'Not available') + '</strong></span>');
            if (item.stage) details.push('<span class="pyq-file-detail"><span class="pyq-detail-label">Stage</span><strong>' + escapeHTML(item.stage) + '</strong></span>');
            if (item.job_id) details.push('<span class="pyq-file-detail"><span class="pyq-detail-label">Job</span><strong>' + escapeHTML(item.job_id) + '</strong></span>');
            if (item.error || item.error_message) details.push('<span class="pyq-file-error" title="' + escapeHTML(item.error || item.error_message) + '">' + escapeHTML(item.error || item.error_message) + '</span>');
            const action = function (key, label, disabled, extra) {
                return '<button type="button" class="table-action pyq-action ' + (extra || '') + '" data-action="' + key + '"' + (disabled ? ' disabled aria-disabled="true"' : '') + '>' + pyqActionIcon(key) + '<span>' + label + '</span></button>';
            };
            const rowSubject = (item && item.subject) ? item.subject : selectedSubject;
            return '<tr class="pyq-file-row" data-file="' + escapeHTML(item.filename) + '" data-subject="' + escapeHTML(rowSubject) + '" data-review="' + escapeHTML(item.review_status || "unreviewed") + '" data-status="' + escapeHTML(normalized) + '">' +
                '<td><div class="pyq-file-primary"><div class="pyq-file-title"><svg class="pyq-pdf-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg><span class="pyq-filename" title="' + escapeHTML(item.filename) + '">' + escapeHTML(item.filename) + '</span></div><div class="status-cell">' + statusBadge(item.status) + (reviewed ? ' <span class="status approved">Reviewed</span>' : '') + '</div></div>' +
                '<div class="pyq-file-secondary"><div class="pyq-file-metadata">' + details.join("") + '</div><div class="pyq-file-actions" aria-label="Actions for ' + escapeHTML(item.filename) + '">' +
                action("process", "Process", busy, "") + action("result", "Result", !resultAvailable, "") + action("docx", "DOCX", !resultAvailable, "") + action("review", reviewed ? "Unreview" : "Review", false, "") + action("remove", "Remove", false, "danger") +
                '</div></div></td></tr>';
        }).join("");
    }

    let pyqResultQuestions = [];

    function renderPyqResult(questions) {
        const body = document.getElementById("pyqResultBody");
        if (!body) return;
        if (!questions.length) {
            body.innerHTML = '<p class="state-cell">No extracted questions are available for this PDF.</p>';
            return;
        }
        body.innerHTML = '<table class="data-table qb-questions-table"><thead><tr>' +
            '<th scope="col">#</th><th scope="col">Question</th><th scope="col">Section</th>' +
            '<th scope="col">Marks</th><th scope="col">Pages</th><th scope="col">Sub-qs</th>' +
            '<th scope="col">Confidence</th><th scope="col" aria-label="Actions"></th>' +
            '</tr></thead><tbody>' +
            questions.map(function (q, i) {
                const subCount = Array.isArray(q.sub_questions) ? q.sub_questions.length : 0;
                const conf = q.confidence != null ? (Number(q.confidence) * 100).toFixed(0) + "%" : "—";
                const hasIssues = Array.isArray(q.validation_issues) && q.validation_issues.length;
                return '<tr>' +
                    '<td class="pyq-result-num">' + escapeHTML(questionNumber(q)) + '</td>' +
                    '<td class="pyq-result-text">' + escapeHTML(questionText(q)) + '</td>' +
                    '<td>' + escapeHTML(q.section_name || "") + '</td>' +
                    '<td>' + escapeHTML(q.marks != null ? String(q.marks) : "") + '</td>' +
                    '<td>' + escapeHTML(Array.isArray(q.source_pages) ? q.source_pages.join(", ") : (q.source_pages != null ? q.source_pages : "")) + '</td>' +
                    '<td>' + escapeHTML(String(subCount)) + '</td>' +
                    '<td>' + escapeHTML(conf) + (hasIssues ? ' ⚠' : '') + '</td>' +
                    '<td><button type="button" class="btn btn-small" data-action="view-question" data-idx="' + i + '">View</button></td>' +
                    '</tr>';
            }).join("") + '</tbody></table>' +
            '<p class="hint">Select <strong>View</strong> on a question to inspect it in detail.</p>';
    }

    async function openPyqResult(subject, filename) {
        const dialog = document.getElementById("pyqResultDialog");
        const body = document.getElementById("pyqResultBody");
        const title = document.getElementById("pyqResultTitle");
        if (title) title.textContent = "Extracted Questions \u2014 " + filename;
        if (body) body.innerHTML = '<p class="state-cell">Loading extracted questions…</p>';
        if (dialog) openModal("pyqResultDialog");

        let result;
        try {
            result = await api(pdfPath(subject, filename) + "/result?include_questions=true");
        } catch (error) {
            if (body) body.innerHTML = '<p class="state-cell error">Could not load extracted questions: ' + escapeHTML(error.message) + '</p>';
            showToast(error.message);
            return [];
        }

        const questions = Array.isArray(result && result.questions) ? result.questions : [];
        pyqResultQuestions = questions.map(function (q) {
            return Object.assign({}, q, { subject_id: subject, subject: subject });
        });
        renderPyqResult(pyqResultQuestions);
        return pyqResultQuestions;
    }

    let pyqPdfLoadToken = 0;
    async function loadPdfList() {
        const tbody = document.getElementById("pyqTableBody");

        if (!tbody) return;
        const requestToken = ++pyqPdfLoadToken;

        const subjectElement = document.getElementById("pyqSubject");
        const subject = subjectElement ? subjectElement.value : "";
        pyqPdfItems = [];

        if (!subject) {
            tbody.innerHTML = tableStateHTML(
                "◫", "Select a subject to view its PDFs.", "", 1);
            return;
        }

        tbody.innerHTML = tableStateHTML(
            "⟳", "Loading PDFs…", "loading", 1);

        let items;
        let loadError = null;

        try {
            const data = await api("/subjects/" + encodeURIComponent(subject) + "/pdfs");
            if (requestToken !== pyqPdfLoadToken) return;
            items = Array.isArray(data)
                ? data
                : (data.pdfs || data.files || data.items || []);
        } catch (error) {
            if (requestToken !== pyqPdfLoadToken) return;
            loadError = error;
            items = null;
        }

        if (loadError) {
            if (requestToken !== pyqPdfLoadToken) return;
            let message = loadError.message || "Could not load PDFs.";
            if (loadError.status === 404) message = "Subject not found (404).";
            else if (loadError.status === 401) message = "Session expired. Please log in again.";
            else if (loadError.status === 403) message = "You do not have permission to view these PDFs.";
            else if (loadError.status >= 500) message = "Server error while loading PDFs. Please try again.";
            else if (!loadError.status) message = "Network error. Could not reach the server.";
            tbody.innerHTML = '<tr><td colspan="1" class="state-cell error">' +
                "<strong>Could not load PDFs.</strong> " + escapeHTML(message) +
                ' <button type="button" class="btn btn-secondary small" data-pyq-retry>Retry</button></td></tr>';
            pyqPdfItems = [];
            return;
        }

        if (requestToken !== pyqPdfLoadToken) return;

        pyqPdfItems = (items || []).map(function (item) {
            if (item && typeof item === "object") {
                if (!item.subject) item = Object.assign({}, item, { subject: subject });
            }
            return item;
        });

        // Normalize statuses using the shared helper so parsed PDFs are marked
        // available even when the backend omits result_available.
        if (window.PYQStatus && typeof window.PYQStatus.applyPdfStatuses === "function") {
            pyqPdfItems = window.PYQStatus.applyPdfStatuses(pyqPdfItems, [], subject);
            pyqPdfItems = pyqPdfItems.map(function (item) {
                if (item && typeof item === "object" && !item.subject) item.subject = subject;
                return item;
            });
        }

        if (!pyqPdfItems.length) {
            tbody.innerHTML = tableStateHTML(
                "◫", "No PDFs uploaded yet. Use the Upload button above.", "", 1);
            return;
        }

        renderPdfItems();

        // Show existing progress for active jobs without starting new ones.
        pyqPdfItems.forEach(function (item) {
            const normalized = (window.PYQStatus && typeof window.PYQStatus.normalizeStatus === "function")
                ? window.PYQStatus.normalizeStatus(item.status)
                : String(item.status || "").toLowerCase();
            if ((normalized === "processing" || normalized === "queued" || normalized === "running") && item.job_id) {
                startPolling(item.subject || subject, item.filename, item.job_id);
            }
        });
    }

    ["pyqSearch", "pyqYearFilter", "pyqStatusFilter"].forEach(function (id) {
        const control = document.getElementById(id);
        if (!control) return;
        control.addEventListener(id === "pyqSearch" ? "input" : "change", renderPdfItems);
    });

    const pyqSubjectSelect = document.getElementById("pyqSubject");

    if (pyqSubjectSelect) {
        pyqSubjectSelect.addEventListener("change", function () {
            loadPdfList().catch(function (error) {
                showToast(error.message);
            });
        });
    }

    const pyqUpload = document.getElementById("pyqUpload");

    if (pyqUpload) {
        pyqUpload.addEventListener("change", async function () {
            const subjectElement = document.getElementById("pyqSubject");
            const subject = subjectElement ? subjectElement.value : "";

            if (!subject) {
                showToast("Select a subject first.");
                pyqUpload.value = "";
                return;
            }

            if (!pyqUpload.files.length) return;

            const form = new FormData();
            for (const file of pyqUpload.files) {
                form.append("files", file);
            }

            try {
                const uploaded = await api(
                    "/subjects/" + encodeURIComponent(subject) + "/pdfs",
                    { method: "POST", form: form }
                );

                const stored = Array.isArray(uploaded)
                    ? uploaded
                    : (uploaded.uploaded || uploaded.files || uploaded.pdfs || uploaded.stored || []);

                showToast("Uploaded " + (stored.length || pyqUpload.files.length) +
                    " file(s) to " + subject);

                pyqUpload.value = "";
                loadPdfList().catch(function () {});
            } catch (error) {
                showToast(error.message);
            }
        });
    }

    const activePollers = new Map();
    const activeProcessKeys = new Set();

    function pollerKey(subject, filename) {
        return String(subject || "") + "::" + String(filename || "");
    }

    function stopPolling(subject, filename) {
        let key;
        if (filename === undefined) {
            // Legacy single-arg call (filename only).
            key = String(subject);
            // Try to find a matching composite key.
            for (const k of activePollers.keys()) {
                if (k === key || k.endsWith("::" + key)) { key = k; break; }
            }
        } else {
            key = pollerKey(subject, filename);
        }
        const timer = activePollers.get(key);
        if (timer) {
            clearInterval(timer);
            activePollers.delete(key);
        }
    }

    function stopAllPolling() {
        activePollers.forEach(function (timer) {
            clearInterval(timer);
        });
        activePollers.clear();
    }

    function isTerminalJobStatus(status) {
        const normalized = String(status || "").trim().toLowerCase();
        return normalized === "succeeded" || normalized === "completed" ||
            normalized === "done" || normalized === "success" ||
            normalized === "failed" || normalized === "error" || normalized === "errored";
    }

    function startPolling(subject, filename, jobId) {
        const key = pollerKey(subject, filename);

        // Prevent duplicate timers / requests for the same document.
        stopPolling(subject, filename);

        let settled = false;

        const timer = setInterval(async function () {
            if (settled) return;
            let job;

            try {
                job = await api("/jobs/" + encodeURIComponent(jobId));
            } catch (error) {
                settled = true;
                stopPolling(subject, filename);
                const row = document.querySelector(
                    '#pyqTableBody tr[data-file="' + window.CSS.escape(filename) + '"][data-subject="' + window.CSS.escape(subject) + '"]'
                ) || document.querySelector(
                    '#pyqTableBody tr[data-file="' + window.CSS.escape(filename) + '"]'
                );
                if (row) {
                    const cell = row.querySelector(".status-cell");
                    if (cell) cell.innerHTML = statusBadge("failed");
                }
                showToast((error && error.message) ? error.message : "Could not poll job status.");
                return;
            }

            const row = document.querySelector(
                '#pyqTableBody tr[data-file="' + window.CSS.escape(filename) + '"]'
            );

            if (row) {
                const cell = row.querySelector(".status-cell");
                if (cell) cell.innerHTML =
                    statusBadge(job.status) +
                    (job.stage ? " <small>" + escapeHTML(job.stage) + "</small>" : "");
            }

            if (isTerminalJobStatus(job.status)) {
                settled = true;
                stopPolling(subject, filename);

                if (String(job.status).toLowerCase() === "failed" || String(job.status).toLowerCase() === "error" || String(job.status).toLowerCase() === "errored") {
                    const errMsg = (job.error && String(job.error).trim()) ? job.error : (job.message || "Processing failed.");
                    showToast(filename + " failed: " + errMsg);
                } else {
                    showToast(filename + " processed successfully");
                }

                // Refresh the PDF list for the correct subject when it matches the current view.
                const currentSubject = document.getElementById("pyqSubject") ? document.getElementById("pyqSubject").value : "";
                if (!currentSubject || currentSubject === subject) {
                    loadPdfList().catch(function () {});
                }
            }
        }, 2000);

        activePollers.set(key, timer);
    }

    function questionText(question) {
        if (typeof question === "string") return question;
        return question.question || question.text || question.question_text ||
            question.cleaned_text || question.original_text || "";
    }

    async function downloadDocx(subject, filename) {
        await downloadFile(pdfPath(subject, filename) + "/reconstruction", filename.replace(/\.pdf$/i, "") + ".docx");
    }

    const pyqTableBody = document.getElementById("pyqTableBody");

    if (pyqTableBody) {
        pyqTableBody.addEventListener("click", async function (event) {
            if (event.target.closest("[data-pyq-retry]")) {
                loadPdfList().catch(function () {});
                return;
            }

            const button = event.target.closest("button[data-action]");

            if (!button || button.disabled) return;

            const row = button.closest("tr[data-file]");
            const subjectElement = document.getElementById("pyqSubject");
            const subject = (row && row.getAttribute("data-subject")) || (subjectElement ? subjectElement.value : "");

            if (!row || !subject) return;

            const filename = row.getAttribute("data-file");
            const action = button.getAttribute("data-action");

            if (action === "process") {
                const key = pollerKey(subject, filename);
                if (activePollers.has(key) || activeProcessKeys.has(key)) {
                    showToast(filename + " is already being processed.");
                    return;
                }

                // Also prevent if the row is already in a processing/queued state.
                const rowStatus = row.getAttribute("data-status");
                if (rowStatus === "processing" || rowStatus === "queued" || rowStatus === "running") {
                    showToast(filename + " is already being processed.");
                    return;
                }

                activeProcessKeys.add(key);
                setButtonLoading(button, true, "Starting…");

                try {
                    const started = await api(
                        pdfPath(subject, filename) + "/process",
                        { method: "POST", body: { force: true } }
                    );
                    const jobId = started && (started.job_id || started.jobId || started.id);
                    if (!jobId) throw new Error("The backend returned no job_id; processing status cannot be tracked.");
                    showToast("Processing started for " + filename);
                    // Mark row as processing immediately.
                    row.setAttribute("data-status", "processing");
                    const statusCell = row.querySelector(".status-cell");
                    if (statusCell) statusCell.innerHTML = statusBadge("processing");
                    startPolling(subject, filename, jobId);
                    activeProcessKeys.delete(key);
                } catch (error) {
                    let message = (error && error.message) ? error.message : "Processing failed.";
                    if (error && error.status === 404) message = "PDF or subject not found (404).";
                    else if (error && error.status === 401) message = "Session expired. Please log in again.";
                    else if (error && error.status === 403) message = "You do not have permission to process this PDF.";
                    else if (error && error.status === 409) message = filename + " is already being processed.";
                    else if (error && error.status >= 500) message = "Server error while starting processing. Please try again.";
                    else if (error && !error.status) message = "Network error. Could not reach the server.";
                    showToast(message);
                    if (error && error.status === 409) {
                        // Try to resume polling using any job id returned.
                        const jobId = error.data && (error.data.job_id || error.data.jobId);
                        if (jobId) startPolling(subject, filename, jobId);
                    }
                } finally {
                    activeProcessKeys.delete(key);
                    setButtonLoading(button, false);
                }
            }

            if (action === "result") {
                setButtonLoading(button, true, "Loading…");
                const questions = await openPyqResult(subject, filename);
                setButtonLoading(button, false);
                if (questions.length) {
                    showToast(filename + " • " + questions.length + " questions");
                }
            }

            if (action === "docx") {
                setButtonLoading(button, true, "Building…");

                try {
                    await api(pdfPath(subject, filename) + "/reconstruct", {
                        method: "POST"
                    });
                    await downloadDocx(subject, filename);
                    showToast("DOCX downloaded: " + filename);
                } catch (error) {
                    showToast(error.message);
                } finally {
                    setButtonLoading(button, false);
                }
            }

            if (action === "review") {
                const next = row.getAttribute("data-review") === "approved"
                    ? "unreviewed"
                    : "approved";

                try {
                    await api(pdfPath(subject, filename), {
                        method: "PATCH",
                        body: { review_status: next }
                    });
                    showToast(filename + " marked " + next);
                    loadPdfList().catch(function () {});
                } catch (error) {
                    showToast(error.message);
                }
            }

            if (action === "remove") {
                const ok = await confirmAction(
                    "Remove PDF",
                    "Remove \"" + filename + "\" with its jobs and results? " +
                    "This cannot be undone.",
                    "Remove"
                );

                if (!ok) return;

                try {
                    await api(pdfPath(subject, filename), { method: "DELETE" });
                    showToast("Removed " + filename);
                    loadPdfList().catch(function () {});
                } catch (error) {
                    showToast(error.message);
                }
            }
        });
    }

    /* =============================================
       MODAL DIALOGS + CONFIRMATION
       (native <dialog>; confirmations for destructive
       actions per backend_services.md conventions)
    ============================================== */

    document.querySelectorAll("dialog.modal").forEach(function (modal) {
        modal.addEventListener("click", function (event) {
            if (event.target === modal) modal.close();
        });
        modal.addEventListener("close", function () {
            syncBodyScroll();
            if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
        });
    });

    document.addEventListener("click", function (event) {
        const modal = event.target;
        if (modal && modal.classList && modal.classList.contains("modal") && !modal.matches("dialog") && event.target === modal) {
            modal.classList.add("hidden");
            syncBodyScroll();
            if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;
        const openCustom = document.querySelector(".modal:not(dialog):not(.hidden)");
        if (openCustom) {
            openCustom.classList.add("hidden");
            syncBodyScroll();
            if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Tab") return;
        const modal = document.querySelector(".modal:not(dialog):not(.hidden)");
        if (!modal) return;
        const focusables = Array.from(modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
            .filter(function (element) { return !element.disabled; });
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    document.addEventListener("click", function (event) {
        const closer = event.target.closest("[data-close]");

        if (closer) {
            const modal = document.getElementById(closer.getAttribute("data-close"));
            if (modal) modal.close();
        }
    });

    let lastModalTrigger = null;

    function closeAllModals() {
        document.querySelectorAll("dialog.modal[open]").forEach(function (dialog) {
            if (typeof dialog.close === "function") dialog.close();
        });
        document.querySelectorAll(".modal:not(dialog):not(.hidden)").forEach(function (modal) {
            modal.classList.add("hidden");
        });
        if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
    }

    function syncBodyScroll() {
        // Native dialogs already lock the page. Custom overlays use a body class
        // so background scrolling is disabled only while one is actually open.
        const customModalOpen = Boolean(document.querySelector(".modal:not(dialog):not(.hidden)"));
        document.body.classList.toggle("modal-open", customModalOpen);
    }

    function openModal(id) {
        document.querySelectorAll("dialog.modal[open]").forEach(function (dialog) {
            if (dialog.id !== id && typeof dialog.close === "function") dialog.close();
        });
        document.querySelectorAll(".modal:not(dialog):not(.hidden)").forEach(function (modal) {
            modal.classList.add("hidden");
        });
        lastModalTrigger = document.activeElement;
        const modal = document.getElementById(id);
        if (modal && typeof modal.showModal === "function") {
            modal.showModal();
            const focusable = modal.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
            if (focusable) focusable.focus();
        }
        syncBodyScroll();
        return modal;
    }

    function closeModal(id) {
        const modal = document.getElementById(id);
        if (modal && typeof modal.close === "function") modal.close();
        syncBodyScroll();
    }

    function confirmAction(title, message, confirmLabel) {
        return new Promise(function (resolve) {
            const dialog = document.getElementById("confirmDialog");
            const accept = document.getElementById("confirmAccept");
            const cancel = document.getElementById("confirmCancel");

            if (!dialog || typeof dialog.showModal !== "function") {
                resolve(window.confirm(message));
                return;
            }

            document.getElementById("confirmTitle").textContent = title || "Confirm";
            document.getElementById("confirmMessage").textContent = message || "";
            accept.textContent = confirmLabel || "Confirm";

            function cleanup() {
                accept.removeEventListener("click", onAccept);
                cancel.removeEventListener("click", onCancel);
                dialog.removeEventListener("close", onDialogClose);
            }
            function onAccept() { cleanup(); dialog.close(); resolve(true); }
            function onCancel() { cleanup(); dialog.close(); resolve(false); }
            function onDialogClose() { cleanup(); resolve(false); }

            accept.addEventListener("click", onAccept);
            cancel.addEventListener("click", onCancel);
            dialog.addEventListener("close", onDialogClose);

            dialog.showModal();
        });
    }


    /* Reconciliation (admin) */
    async function getReconciliationStatus() {
        try {
            return await api("/api/reconciliation/status");
        } catch (error) {
            try {
                return await api("/admin/reconciliation/status");
            } catch (e) {
                throw error;
            }
        }
    }

    async function runReconciliation() {
        try {
            return await api("/api/reconciliation/run", { method: "POST" });
        } catch (error) {
            try {
                return await api("/admin/reconciliation/run", { method: "POST" });
            } catch (e) {
                throw error;
            }
        }
    }

    /* =============================================
       TEACHERS
    ============================================== */

    let teachersCache = [];
    let editingTeacherId = null;
    let teachersPage = 1;
    const teachersPageSize = 50;

    function teacherStatusBadge(status) {
        const map = {
            approved: ["approved", "Approved"],
            pending: ["pending", "Pending"],
            disapproved: ["disapproved", "Disapproved"]
        };

        const entry = map[status] || ["pending", status || "Unknown"];

        return '<span class="status ' + entry[0] + '">' +
            escapeHTML(entry[1]) + "</span>";
    }

    async function loadTeachers() {
        const tbody = document.getElementById("teachersTableBody");

        if (!tbody) return;

        const search = document.getElementById("teacherSearch");
        const statusFilter = document.getElementById("teacherStatusFilter");

        const params = new URLSearchParams();
        if (search && search.value.trim()) params.set("search", search.value.trim());
        if (statusFilter && statusFilter.value) params.set("status", statusFilter.value);
        params.set("page", String(teachersPage));
        params.set("page_size", String(teachersPageSize));

        tbody.innerHTML = tableStateHTML("⟳", "Loading teachers…", "loading", 7);

        let data;

        try {
            data = await api("/teachers?" + params.toString());
        } catch (error) {
            tbody.innerHTML = tableStateHTML("⚠",
                "Could not load teachers: " + error.message, "error", 7);
            updateTeachersPagination(0);
            return;
        }

        teachersCache = data.teachers || [];
        const total = Number(data.total) || 0;
        updateTeachersPagination(total);

        if (!teachersCache.length) {
            tbody.innerHTML = tableStateHTML("♙",
                "No teachers found. Add one with the button above.", "", 7);
            return;
        }

        tbody.innerHTML = teachersCache.map(function (teacher) {
            let actions = "";

            if (teacher.status !== "approved") {
                actions += '<button class="table-action" data-teacher-action="approve" data-id="' + teacher.id + '">Approve</button> ';
            }

            if (teacher.status !== "disapproved") {
                actions += '<button class="table-action" data-teacher-action="disapprove" data-id="' + teacher.id + '">Disapprove</button> ';
            }

            actions += '<button class="table-action" data-teacher-action="assign" data-id="' + teacher.id + '">Assign Subjects</button> ' +
                '<button class="table-action" data-teacher-action="edit" data-id="' + teacher.id + '">Edit</button> ' +
                '<button class="table-action danger" data-teacher-action="remove" data-id="' + teacher.id + '">Remove</button>';

            return "<tr>" +
                "<td>" + escapeHTML(teacher.name) + "</td>" +
                "<td>" + escapeHTML(teacher.email) + "</td>" +
                "<td>" + escapeHTML(teacher.department || "—") + "</td>" +
                "<td>" + escapeHTML(teacher.role || "—") + "</td>" +
                "<td>" + teacherStatusBadge(teacher.status) + "</td>" +
                "<td>" + (teacher.subject_count ?? "—") + "</td>" +
                '<td class="actions-cell">' + actions + "</td></tr>";
        }).join("");
    }

    function updateTeachersPagination(total) {
        const pageInfo = document.getElementById("teachersPageInfo");
        const previous = document.getElementById("teachersPrev");
        const next = document.getElementById("teachersNext");
        const totalPages = Math.max(1, Math.ceil(total / teachersPageSize));
        if (pageInfo) pageInfo.textContent = total ? `Page ${teachersPage} of ${totalPages} · ${total} teachers` : "No teacher records";
        if (previous) previous.disabled = teachersPage <= 1;
        if (next) next.disabled = teachersPage >= totalPages;
    }

    function openTeacherDialog(teacher) {
        editingTeacherId = teacher ? teacher.id : null;

        const title = document.getElementById("teacherDialogTitle");
        if (title) title.textContent = teacher ? "Edit Teacher" : "Add Teacher";

        const setValue = function (id, value) {
            const element = document.getElementById(id);
            if (element) element.value = value || "";
        };

        setValue("teacherName", teacher ? teacher.name : "");
        setValue("teacherEmail", teacher ? teacher.email : "");
        setValue("teacherDepartment", teacher ? teacher.department : "");
        setValue("teacherPassword", "");
        setValue("teacherStatus", teacher ? (teacher.status || "pending") : "pending");

        openModal("teacherDialog");
    }

    const addTeacherButton = document.getElementById("addTeacherButton");

    if (addTeacherButton) {
        addTeacherButton.addEventListener("click", function () {
            openTeacherDialog(null);
        });
    }

    const teacherForm = document.getElementById("teacherForm");

    if (teacherForm) {
        teacherForm.addEventListener("submit", async function (event) {
            event.preventDefault();

            const body = {
                name: document.getElementById("teacherName").value.trim(),
                email: document.getElementById("teacherEmail").value.trim(),
                department: document.getElementById("teacherDepartment").value.trim(),
                status: document.getElementById("teacherStatus").value
            };

            const password = document.getElementById("teacherPassword").value;

            if (password) body.password = password;
            if (!body.name || !body.email) return;

            setButtonLoading(document.getElementById("teacherSaveButton"), true, "Saving…");

            try {
                if (editingTeacherId) {
                    await api("/teachers/" + editingTeacherId, {
                        method: "PATCH", body: body
                    });
                    showToast("Teacher updated: " + body.name);
                } else {
                    await api("/teachers", { method: "POST", body: body });
                    showToast("Teacher created: " + body.name);
                }

                closeModal("teacherDialog");
                loadTeachers().catch(function () {});
            } catch (error) {
                showToast(error.message);
            } finally {
                setButtonLoading(document.getElementById("teacherSaveButton"), false);
            }
        });
    }

    const teachersTableBody = document.getElementById("teachersTableBody");

    if (teachersTableBody) {
        teachersTableBody.addEventListener("click", async function (event) {
            const button = event.target.closest("button[data-teacher-action]");

            if (!button) return;

            const id = button.getAttribute("data-id");
            const action = button.getAttribute("data-teacher-action");
            const teacher = teachersCache.find(function (item) {
                return String(item.id) === id;
            });

            if (action === "approve" || action === "disapprove") {
                const status = action === "approve" ? "approved" : "disapproved";

                try {
                    await api("/teachers/" + id, {
                        method: "PATCH", body: { status: status }
                    });
                    showToast((teacher ? teacher.name : "Teacher") + " " + status);
                    loadTeachers().catch(function () {});
                } catch (error) {
                    showToast(error.message);
                }
            }

            if (action === "edit") {
                openTeacherDialog(teacher);
            }

            if (action === "assign") {
                openSubjectAssignment(teacher);
            }

            if (action === "remove") {
                const ok = await confirmAction(
                    "Remove teacher",
                    "Remove " + (teacher ? "\"" + teacher.name + "\"" : "this teacher") +
                    "? This cannot be undone.",
                    "Remove"
                );

                if (!ok) return;

                try {
                    await api("/teachers/" + id, { method: "DELETE" });
                    showToast("Teacher removed");
                    loadTeachers().catch(function () {});
                } catch (error) {
                    showToast(error.message);
                }
            }
        });
    }

    /* =============================================
       SUBJECT ASSIGNMENTS & PERMISSIONS
    ============================================== */

    let assignmentCache = {};
    let currentAssignmentTeacher = null;

    async function fetchAllSubjects() {
        try {
            if (isAdminUser()) {
                const data = await api("/subjects");
                return data.subjects || [];
            }
            const data = await api("/subjects");
            return data.subjects || [];
        } catch (error) {
            try {
                const data = await api("/subjects");
                return data.subjects || [];
            } catch (e) {
                return [];
            }
        }
    }

    async function fetchTeacherAssignments(teacherId) {
        try {
            const data = await api(`/teachers/${teacherId}/subjects`);
            return data;
        } catch (error) {
            try {
                const data = await api(`/assignments/teacher/${teacherId}`);
                return data;
            } catch (e) {
                return { assignments: [], subjects: [] };
            }
        }
    }

    async function saveTeacherAssignments(teacherId, assignments) {
        try {
            // Backend expects POST to /teachers/{id}/subjects with {subjects: [...]}
            const subjects = Array.isArray(assignments) ? assignments : (assignments?.subjects || assignments?.assignments || []);
            await api(`/teachers/${teacherId}/subjects`, {
                method: "POST",
                body: { subjects: subjects }
            });
            return true;
        } catch (error) {
            try {
                await api(`/users/${teacherId}/subjects`, {
                    method: "POST",
                    body: { subjects: Array.isArray(assignments) ? assignments : (assignments?.subjects || []) }
                });
                return true;
            } catch (e) {
                throw error;
            }
        }
    }

    function openSubjectAssignment(teacher) {
        if (!teacher) return;
        currentAssignmentTeacher = teacher;
        let modal = document.getElementById("subjectAssignmentModal");
        if (!modal) {
            const dialog = document.createElement("dialog");
            dialog.id = "subjectAssignmentModal";
            dialog.className = "modal";
            dialog.innerHTML = `
                <div class="modal-card" style="max-width: 900px; width: 90vw; max-height: 90vh; overflow-y: auto;">
                    <div class="card-header">
                        <div>
                            <h3>Subject Assignments & Permissions</h3>
                            <p id="assignmentTeacherInfo">Assign subjects and permissions</p>
                        </div>
                        <button type="button" class="btn btn-secondary small" id="closeAssignmentModal">Close</button>
                    </div>
                    <div id="assignmentContent" style="padding: 1rem;">
                        <p>Loading...</p>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" id="cancelAssignment">Cancel</button>
                        <button type="button" class="btn btn-primary" id="saveAssignment">Save Assignments</button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);
            document.getElementById("closeAssignmentModal").addEventListener("click", () => { try { dialog.close(); } catch(e) { dialog.classList.add('hidden'); } });
            document.getElementById("cancelAssignment").addEventListener("click", () => { try { dialog.close(); } catch(e) { dialog.classList.add('hidden'); } });
            document.getElementById("saveAssignment").addEventListener("click", saveCurrentAssignments);
            modal = dialog;
            modal.addEventListener("click", function (e) { if (e.target === modal) { try { modal.close(); } catch(ex) { modal.classList.add('hidden'); } } });
        }
        document.getElementById("assignmentTeacherInfo").textContent = `${teacher.name} (${teacher.email})`;
        document.getElementById("assignmentContent").innerHTML = `<p>Loading subjects and assignments...</p>`;
        try { if (typeof modal.showModal === "function") modal.showModal(); else modal.classList.remove("hidden"); } catch(e) { modal.classList.remove("hidden"); }
        loadAssignmentData(teacher.id);
    }

    async function loadAssignmentData(teacherId) {
        try {
            const [allSubjects, assignmentsData] = await Promise.all([
                fetchAllSubjects(),
                fetchTeacherAssignments(teacherId)
            ]);
            const assignments = assignmentsData.assignments || assignmentsData.data || assignmentsData || [];
            const assignmentMap = {};
            (Array.isArray(assignments) ? assignments : []).forEach(a => {
                const subject = a.subject_id || a.subject || a.subjectName;
                if (subject) {
                    assignmentMap[subject] = {
                        assigned: true,
                        accessPapers: a.access_question_papers ?? a.accessPapers ?? a.permissions?.accessPapers ?? a.permissions?.questionPapers ?? true,
                        uploadProcess: a.upload_process ?? a.uploadProcess ?? a.permissions?.uploadProcess ?? a.permissions?.process ?? true,
                        manageBank: a.manage_question_bank ?? a.manageBank ?? a.permissions?.manageBank ?? a.permissions?.questionBank ?? true,
                        generate: a.generate_papers ?? a.generatePapers ?? a.permissions?.generate ?? a.permissions?.generatePapers ?? true
                    };
                }
            });
            renderAssignmentUI(allSubjects, assignmentMap);
        } catch (error) {
            document.getElementById("assignmentContent").innerHTML = `<p class="error">Failed to load assignments: ${escapeHTML(error.message)}</p>`;
        }
    }

    function renderAssignmentUI(subjects, assignmentMap) {
        const content = document.getElementById("assignmentContent");
        if (!subjects.length) {
            content.innerHTML = `<p>No subjects available.</p>`;
            return;
        }
        let html = `<table class="data-table"><thead><tr><th>Assign</th><th>Subject</th><th>Access Question Papers</th><th>Upload & Process Papers</th><th>Access & Manage Question Bank</th><th>Generate Question Papers</th></tr></thead><tbody>`;
        subjects.forEach(subject => {
            const subj = typeof subject === 'string' ? subject : (subject.name || subject.subject_id);
            const map = assignmentMap[subj] || { assigned: false, accessPapers: true, uploadProcess: true, manageBank: true, generate: true };
            html += `<tr>
                <td><input type="checkbox" class="assign-check" data-subject="${escapeHTML(subj)}" ${map.assigned ? 'checked' : ''}></td>
                <td>${escapeHTML(subj)}</td>
                <td><input type="checkbox" class="perm-check" data-subject="${escapeHTML(subj)}" data-perm="accessPapers" ${map.assigned && map.accessPapers ? 'checked' : ''} ${map.assigned ? '' : 'disabled'}></td>
                <td><input type="checkbox" class="perm-check" data-subject="${escapeHTML(subj)}" data-perm="uploadProcess" ${map.assigned && map.uploadProcess ? 'checked' : ''} ${map.assigned ? '' : 'disabled'}></td>
                <td><input type="checkbox" class="perm-check" data-subject="${escapeHTML(subj)}" data-perm="manageBank" ${map.assigned && map.manageBank ? 'checked' : ''} ${map.assigned ? '' : 'disabled'}></td>
                <td><input type="checkbox" class="perm-check" data-subject="${escapeHTML(subj)}" data-perm="generate" ${map.assigned && map.generate ? 'checked' : ''} ${map.assigned ? '' : 'disabled'}></td>
            </tr>`;
        });
        html += `</tbody></table>`;
        content.innerHTML = html;
        content.querySelectorAll('.assign-check').forEach(cb => {
            cb.addEventListener('change', function() {
                const subj = this.getAttribute('data-subject');
                content.querySelectorAll(`.perm-check[data-subject="${subj.replace(/"/g, '\\"')}"]`).forEach(pc => {
                    pc.disabled = !this.checked;
                    if (!this.checked) pc.checked = false;
                });
            });
        });
    }

    async function saveCurrentAssignments() {
        if (!currentAssignmentTeacher) return;
        const content = document.getElementById("assignmentContent");
        const assignments = [];
        content.querySelectorAll('.assign-check:checked').forEach(cb => {
            const subj = cb.getAttribute('data-subject');
            const getPerm = (perm) => {
                const pc = content.querySelector(`.perm-check[data-subject="${subj.replace(/"/g, '\\"')}"][data-perm="${perm}"]`);
                return pc ? pc.checked : true;
            };
            assignments.push({
                subject_id: subj,
                subject: subj,
                assigned: true,
                access_question_papers: getPerm('accessPapers'),
                upload_process: getPerm('uploadProcess'),
                manage_question_bank: getPerm('manageBank'),
                generate_papers: getPerm('generate'),
                permissions: {
                    accessPapers: getPerm('accessPapers'),
                    uploadProcess: getPerm('uploadProcess'),
                    manageBank: getPerm('manageBank'),
                    generatePapers: getPerm('generate')
                }
            });
        });
        try {
            await saveTeacherAssignments(currentAssignmentTeacher.id, assignments);
            showToast("Assignments saved successfully");
            const modalEl = document.getElementById("subjectAssignmentModal");
            try { if (modalEl && typeof modalEl.close === 'function') modalEl.close(); else if (modalEl) modalEl.classList.add('hidden'); } catch(e) {}
            loadTeachers().catch(function(){});
        } catch (error) {
            showToast("Failed to save assignments: " + error.message);
        }
    }

    /* =============================================
       QUESTION BANK
    ============================================== */

    let questionsCache = [];
    let editingQuestionId = null;
    let pyqQuestionsPage = 1;
    let pyqQuestionsTotal = 0;
    let pyqQuestionsPageSize = 25;
    let pyqPrioritySort = "default";
    let pyqQuestionDetailCache = [];
    let pyqQuestionLoadToken = 0;
    let pyqActiveQuestionLoadToken = 0;
    let pyqMarksLoadToken = 0;

    /* S33 validation pipeline — statuses are consumed exactly as the backend
       sends them; legacy rows (no fields at all) keep today's behavior. */
    const VALIDATION_LABELS = {
        needs_review: "Needs review",
        invalid: "Invalid",
        duplicate: "Duplicate",
        awaiting_validation: "Awaiting validation"
    };
    const PROCESSING_LABELS = {
        scraped: "Scraped",
        parsed: "Parsed",
        awaiting_validation: "Awaiting validation",
        awaiting_import: "Awaiting import"
    };
    let qbFlaggedItems = null;
    const qbFlaggedCache = new Map();

    function validationCategory(item) {
        const status = item && item.validation_status ? String(item.validation_status).trim() : "";
        if (!status) {
            const processing = item && item.processing_status ? String(item.processing_status).trim() : "";
            return processing ? "processing" : "legacy";
        }
        if (status === "approved") return "validated";
        if (status === "rejected") return "rejected";
        return "flagged";
    }

    function partitionValidationItems(data) {
        const items = data && Array.isArray(data.items) ? data.items : [];
        if (!items.some(function (item) { return item && (item.validation_status || item.processing_status); })) {
            return { visible: items, flagged: null };
        }
        const visible = [];
        const flagged = [];
        items.forEach(function (item) {
            const category = validationCategory(item);
            if (category === "validated" || category === "legacy") {
                visible.push(item);
            } else if (category !== "rejected") {
                flagged.push(item);
            }
        });
        return { visible: visible, flagged: flagged };
    }

    function difficultyBadge(value) {
        const map = { EASY: "easy", MEDIUM: "medium", HARD: "hard" };

        return '<span class="badge ' + (map[value] || "unseen") + '">' +
            escapeHTML(value || "—") + "</span>";
    }

    function questionStatusBadge(status) {
        const map = {
            approved: ["approved", "Approved"],
            pending: ["pending", "Pending"],
            disapproved: ["disapproved", "Disapproved"]
        };

        const entry = map[status] || ["pending", status || "Unknown"];

        return '<span class="status ' + entry[0] + '">' +
            escapeHTML(entry[1]) + "</span>";
    }


    function questionText(question) {
        if (!question) return "";

        return String(
            question.cleaned_text ||
            question.original_text ||
            question.text ||
            question.question_text ||
            question.question ||
            ""
        ).trim();
    }

    function questionNumber(question) {
        if (!question) return "—";

        return question.original_question_number ||
            question.original_label ||
            question.question_number ||
            question.label ||
            question.number ||
            "—";
    }

    function questionSource(question) {
        if (!question) return "";

        return String(
            question.source_pdf ||
            question.source ||
            question.pdf ||
            question.source_file ||
            question.file ||
            ""
        ).trim();
    }

    function sourcePdfName(source) {
        const value = String(source || "").trim();

        if (!value) return "—";

        if (value.toLowerCase().startsWith("pyq:")) {
            return value.slice(4).trim().split(/[\\\\/]/).pop() || "—";
        }

        return value.split(/[\\\\/]/).pop() || value;
    }

    function isPyqQuestion(question) {
        // The parsed question-bank endpoint already returns parsed bank records.
        return true;
    }

    function flattenPyqQuestions(questions) {
        // Preserve parent questions instead of expanding nested subquestions, so
        // parent and child records are not displayed twice.
        return questions || [];
    }

    function groupQuestionsByMarks(questions) {
        const groups = {};

        (questions || []).forEach(function (question) {
            const marks = (question && question.marks != null)
                ? question.marks
                : "—";

            const key = String(marks);

            if (!groups[key]) groups[key] = [];

            groups[key].push(question);
        });

        return Object.keys(groups)
            .sort(function (a, b) {
                const an = Number(a);
                const bn = Number(b);

                if (!isNaN(an) && !isNaN(bn)) return an - bn;

                return a.localeCompare(b);
            })
            .map(function (key) {
                return { marks: key, questions: groups[key] };
            });
    }

    async function loadPyqQuestions(resetPage) {
        const tbody = document.getElementById("pyqQuestionsTableBody");
        const pagination = document.getElementById("pyqQuestionsPagination");
        const pageInfo = document.getElementById("pyqQuestionsPageInfo");
        const prevButton = document.getElementById("pyqQuestionsPrev");
        const nextButton = document.getElementById("pyqQuestionsNext");
        const summary = document.getElementById("pyqQuestionsSummary");

        if (!tbody) return;

        const subject = document.getElementById("qbPyqSubject");

        if (resetPage !== false) pyqQuestionsPage = 1;

        const marksGroup = document.getElementById("qbMarksGroup");
        const pageSizeSelect = document.getElementById("qbPyqPageSize");
        const sortSelect = document.getElementById("qbPrioritySort");

        if (pageSizeSelect) {
            pyqQuestionsPageSize = Number(pageSizeSelect.value) || pyqQuestionsPageSize;
        }
        if (sortSelect) pyqPrioritySort = sortSelect.value || "default";

        if (!subject || !subject.value) {
            pyqActiveQuestionLoadToken = ++pyqQuestionLoadToken;
            tbody.innerHTML = '<tr><td colspan="1" class="state-cell">Select a subject to view its questions.</td></tr>';
            if (pagination) pagination.style.display = "none";
            if (summary) summary.textContent = "Select a subject to view its questions.";
            renderQuestionBankReview(null);
            return;
        }

        if (marksGroup && !marksGroup.value) {
            pyqActiveQuestionLoadToken = ++pyqQuestionLoadToken;
            tbody.innerHTML = '<tr><td colspan="1" class="state-cell">Select a marks value to view questions.</td></tr>';
            if (pagination) pagination.style.display = "none";
            if (summary) summary.textContent = "Select a marks value to view questions.";
            renderQuestionBankReview(null);
            return;
        }

        const params = new URLSearchParams();

        params.set("subject_id", subject.value);
        // The documented endpoint has no priority sort parameter and caps
        // page_size at 200. Fetch every filtered page before local sorting.
        params.set("page", "1");
        params.set("page_size", "200");

        if (marksGroup && marksGroup.value === "all") {
            // All Questions: the documented unfiltered contract is to omit
            // marks entirely; no fabricated value is ever sent.
        } else if (marksGroup && marksGroup.value) {
            params.set("marks", marksGroup.value);
        } else {
            tbody.innerHTML = '<tr><td colspan="1" class="state-cell">Select a marks value to view questions.</td></tr>';
            if (pagination) pagination.style.display = "none";
            if (summary) summary.textContent = "Select a marks value to view questions.";
            return;
        }

        tbody.innerHTML = '<tr><td colspan="1" class="state-cell loading">' +
            '<span class="spinner"></span> Loading…' +
            "</td></tr>";

        let data;
        const requestToken = ++pyqQuestionLoadToken;
        pyqActiveQuestionLoadToken = requestToken;

        try {
            data = await api("/api/question-bank?" + params.toString());
            if (requestToken !== pyqActiveQuestionLoadToken) return;
            const allQuestions = data && Array.isArray(data.items) ? data.items.slice() : [];
            const firstPagination = (data && data.pagination) || {};
            const reportedPages = Number(firstPagination.total_pages);
            const pageCount = Number.isFinite(reportedPages) && reportedPages > 0
                ? reportedPages
                : (allQuestions.length === 200 ? 2 : 1);

            for (let page = 2; page <= pageCount; page += 1) {
                const nextParams = new URLSearchParams(params);
                nextParams.set("page", String(page));
                const nextData = await api("/api/question-bank?" + nextParams.toString());
                if (requestToken !== pyqActiveQuestionLoadToken) return;
                if (Array.isArray(nextData && nextData.items)) allQuestions.push(...nextData.items);
            }

            data = Object.assign({}, data, { items: allQuestions });
        } catch (error) {
            if (requestToken !== pyqActiveQuestionLoadToken) return;
            tbody.innerHTML = '<tr><td colspan="1" class="state-cell error">' +
                escapeHTML("Could not load parsed PYQ questions: " + error.message) +
                "</td></tr>";
            if (pagination) pagination.style.display = "none";
            if (summary) summary.textContent = "Could not load parsed PYQ questions.";
            renderQuestionBankReview(null);
            return;
        }

        const pipelinePartition = partitionValidationItems(data);
        qbFlaggedItems = pipelinePartition.flagged;
        qbFlaggedCache.clear();
        if (Array.isArray(qbFlaggedItems)) {
            qbFlaggedItems.forEach(function (item) {
                if (item.question_id) qbFlaggedCache.set(item.question_id, item);
            });
        }
        data = Object.assign({}, data, { items: pipelinePartition.visible });

        const paginationMeta = (data && data.pagination) || {};
        const allFilteredQuestions = data && Array.isArray(data.items) ? data.items : [];

        if (requestToken !== pyqActiveQuestionLoadToken) return;
        pyqQuestionsTotal = allFilteredQuestions.length;

        const totalPages = Math.max(1, Math.ceil(pyqQuestionsTotal / pyqQuestionsPageSize) || 1);

        if (pyqQuestionsPage > totalPages && totalPages > 0) {
            pyqQuestionsPage = totalPages;
            return loadPyqQuestions(false);
        }

        if (!allFilteredQuestions.length) {
            const flaggedCount = Array.isArray(qbFlaggedItems) ? qbFlaggedItems.length : 0;
            const emptyMessage = flaggedCount
                ? "No validated questions for this selection; " + flaggedCount + " record(s) need review below."
                : ((marksGroup && marksGroup.value === "all")
                    ? "No questions found for the selected subject."
                    : "No questions found for the selected subject and marks.");
            tbody.innerHTML = '<tr><td colspan="1" class="state-cell">' + emptyMessage + "</td></tr>";
            if (pagination) pagination.style.display = "none";
            if (summary) summary.textContent = emptyMessage;
            renderQuestionBankReview(qbFlaggedItems);
            return;
        }

        const orderedQuestions = allFilteredQuestions.map(function (question, index) {
            return { question: question, originalIndex: index };
        });
        if (pyqPrioritySort !== "default") {
            orderedQuestions.sort(function (a, b) {
                const rawA = a.question && a.question.priority;
                const rawB = b.question && b.question.priority;
                const priorityA = rawA == null || rawA === "" ? null : Number(rawA);
                const priorityB = rawB == null || rawB === "" ? null : Number(rawB);
                const validA = Number.isInteger(priorityA) && priorityA >= 1 && priorityA <= 3;
                const validB = Number.isInteger(priorityB) && priorityB >= 1 && priorityB <= 3;
                if (validA !== validB) return validA ? -1 : 1;
                if (!validA) return a.originalIndex - b.originalIndex;
                if (priorityA !== priorityB) {
                    return pyqPrioritySort === "priority-desc"
                        ? priorityB - priorityA
                        : priorityA - priorityB;
                }
                return a.originalIndex - b.originalIndex;
            });
        }
        const pageStart = (pyqQuestionsPage - 1) * pyqQuestionsPageSize;
        const sortedQuestions = orderedQuestions.slice(pageStart, pageStart + pyqQuestionsPageSize)
            .map(function (entry) { return entry.question; });

        pyqQuestionDetailCache = sortedQuestions;

        tbody.innerHTML = sortedQuestions.map(function (question, index) {
            const marksLabel = (question.marks != null) ? question.marks : "—";
            const priority = Number(question.priority ?? 1);
            const priorityClass = priority === 3 ? " priority-high" : priority === 2 ? " priority-important" : " priority-normal";
            const qid = question.question_id || "";
            const processing = question && question.processing_status ? String(question.processing_status) : "";
            const processingLabel = PROCESSING_LABELS[processing] || "";
            const processingChip = processingLabel
                ? '<span class="qb-processing-chip">' + escapeHTML(processingLabel) + '</span>'
                : "";
            const resources = question.resources || question.bank?.resources || {};
            const figures = (Array.isArray(resources.figures) ? resources.figures : []).filter(resource => resource && (resource.resource_id || resource.id));
            const tables = (Array.isArray(resources.tables) ? resources.tables : []).filter(resource => resource && (resource.resource_id || resource.id));
            const hasAttachments = (question.has_figures === true && figures.length > 0) ||
                (question.has_tables === true && tables.length > 0);

            return '<tr class="qb-row" data-question-id="' + escapeHTML(qid) + '">' +
                '<td class="qb-question-cell">' +
                    '<div class="qb-primary-line"><div class="qb-question-text">' + escapeHTML(questionText(question) || "—") + '</div></div>' +
                    '<div class="qb-row-actions">' +
                        '<button type="button" class="qb-action-btn qb-edit-question" data-question-id="' + escapeHTML(qid) + '" title="Edit question" aria-label="Edit question">' +
                            '<svg class="qb-action-icon" aria-hidden="true"><use href="#icon-edit"/></svg>' +
                            '<span>Edit</span>' +
                        '</button>' +
                        (hasAttachments ? '<button type="button" class="qb-action-btn qb-attachments" data-pyq-index="' + index + '" title="Figures and Tables" aria-label="Figures and Tables">' +
                            '<svg class="qb-action-icon" aria-hidden="true"><use href="#icon-view"/></svg>' +
                            '<span>Figures &amp; Tables</span>' +
                        '</button>' : '') +
                        '<button type="button" class="qb-action-btn qb-source" data-pyq-index="' + index + '" title="Source" aria-label="Source">' +
                            '<svg class="qb-action-icon" aria-hidden="true"><use href="#icon-file"/></svg>' +
                            '<span>Source</span>' +
                        '</button>' +
                        '<span class="qb-priority-indicator' + priorityClass + '">Priority: ' + priority + ' · ' + (priority === 3 ? 'High priority' : priority === 2 ? 'Important' : 'Normal') + '</span>' +
                        (processingChip ? processingChip : "") +
                    '</div>' +
                "</td>" +
                "</tr>";
        }).join("");

        if (summary) {
            summary.textContent = sortedQuestions.length + " question(s) in this page.";
        }

        if (pagination) {
            pagination.style.display = "flex";
        }

        if (pageInfo) {
            pageInfo.textContent = "Page " + pyqQuestionsPage + " of " + totalPages;
        }

        if (prevButton) prevButton.disabled = pyqQuestionsPage <= 1;
        if (nextButton) nextButton.disabled = pyqQuestionsPage >= totalPages;

        renderQuestionBankReview(qbFlaggedItems);
    }

    function renderQuestionBankReview(flagged) {
        const panel = document.getElementById("qbReviewPanel");
        const list = document.getElementById("qbReviewList");
        if (!panel || !list) return;

        if (!Array.isArray(flagged) || !flagged.length) {
            panel.classList.add("hidden");
            list.innerHTML = "";
            return;
        }

        const admin = isAdminUser();
        panel.classList.remove("hidden");
        list.innerHTML = flagged.map(function (item) {
            const qid = item.question_id || "";
            const validationStatus = item && item.validation_status ? String(item.validation_status).trim() : "";
            const processingStatus = item && item.processing_status ? String(item.processing_status).trim() : "";
            const validationLabel = VALIDATION_LABELS[validationStatus] || "";
            const processingLabel = PROCESSING_LABELS[processingStatus] || "";
            const decided = !validationLabel; // processing-only record, no validation decision yet
            const chips = (validationLabel
                ? '<span class="qb-validation-chip qb-vs-' + escapeHTML(validationStatus) + '">' + escapeHTML(validationLabel) + '</span>'
                : "") +
                (processingLabel
                    ? '<span class="qb-processing-chip">' + escapeHTML(processingLabel) + '</span>'
                    : "");
            const reason = (item.validation_reason != null && String(item.validation_reason).trim())
                ? '<div class="qb-review-reason"><span>Validation reason:</span> ' + escapeHTML(String(item.validation_reason)) + '</div>'
                : (!decided
                    ? '<div class="qb-review-reason"><span>Validation reason:</span> None returned by the backend.</div>'
                    : "");
            const text = questionText(item) || "—";
            const marks = item.marks != null
                ? '<span class="qb-review-marks">' + escapeHTML(String(item.marks)) + ' ' + (Number(item.marks) === 1 ? "mark" : "marks") + '</span>'
                : "";
            const actionButtons = !decided && admin
                ? '<div class="qb-review-actions">' +
                    '<button type="button" class="btn btn-primary small qb-approve" data-question-id="' + escapeHTML(qid) + '">Approve</button>' +
                    '<button type="button" class="btn btn-danger small qb-reject" data-question-id="' + escapeHTML(qid) + '">Reject</button>' +
                    '<button type="button" class="qb-action-btn qb-edit-question" data-question-id="' + escapeHTML(qid) + '" title="Edit question" aria-label="Edit question"><svg class="qb-action-icon" aria-hidden="true"><use href="#icon-edit"/></svg><span>Edit</span></button>' +
                    '<button type="button" class="qb-action-btn qb-source" data-flagged-id="' + escapeHTML(qid) + '" title="View source" aria-label="View source"><svg class="qb-action-icon" aria-hidden="true"><use href="#icon-file"/></svg><span>Source</span></button>' +
                '</div>'
                : "";
            return '<div class="qb-review-card" data-question-id="' + escapeHTML(qid) + '">' +
                '<div class="qb-review-card-top">' + chips + (marks ? marks : "") + '</div>' +
                '<div class="qb-review-text">' + escapeHTML(text) + '</div>' +
                reason +
                (actionButtons || (admin ? "" : '<div class="qb-review-actions-none">Actions require an administrator account.</div>')) +
                '</div>';
        }).join("");
    }

    async function decideQuestionBankValidation(questionId, decision) {
        if (!questionId) return;
        const endpoint = "/api/question-bank/" + encodeURIComponent(questionId) + (decision === "approve" ? "/approve" : "/reject");
        try {
            await api(endpoint, { method: "POST", body: {} });
            showToast(decision === "approve" ? "Question approved." : "Question rejected.");
            loadPyqQuestions(false).catch(function () {});
        } catch (error) {
            showToast(error.message || (decision === "approve" ? "Approve failed." : "Reject failed."));
        }
    }

    const qbReviewListEl = document.getElementById("qbReviewList");
    if (qbReviewListEl) {
        qbReviewListEl.addEventListener("click", async function (event) {
            const approve = event.target.closest(".qb-approve");
            if (approve) {
                approve.disabled = true;
                await decideQuestionBankValidation(approve.getAttribute("data-question-id"), "approve");
                return;
            }
            const reject = event.target.closest(".qb-reject");
            if (reject) {
                if (!window.confirm("Reject this flagged record? It will no longer appear in the Question Bank.")) return;
                reject.disabled = true;
                await decideQuestionBankValidation(reject.getAttribute("data-question-id"), "reject");
                return;
            }
            const editButton = event.target.closest(".qb-edit-question");
            if (editButton) {
                const questionId = editButton.getAttribute("data-question-id");
                if (!questionId) return;
                let item = findQuestionBankItem(questionId) || qbFlaggedCache.get(questionId);
                if (!item) {
                    showToast("Question not found. Reload and try again.");
                    return;
                }
                const subject = item.subject_id || item.subject || (document.getElementById("qbPyqSubject")?.value || "");
                try {
                    item = await api("/api/question-bank/" + encodeURIComponent(questionId) + "?subject_id=" + encodeURIComponent(subject));
                    questionBankRowCache.set(questionId, item);
                } catch (error) {
                    showToast("Could not load question details: " + error.message);
                    return;
                }
                openQuestionEditor({
                    mode: "edit",
                    initial: item,
                    subject: subject,
                    figureContext: item,
                    onSave: function (payload) { return updateQuestionBankQuestion(questionId, payload); },
                    onRemove: function () { return removeQuestionBankQuestion(questionId); }
                });
                return;
            }
            const sourceButton = event.target.closest(".qb-source");
            if (sourceButton) {
                const questionId = sourceButton.getAttribute("data-flagged-id");
                const item = questionId ? qbFlaggedCache.get(questionId) : null;
                if (!item) return;
                pyqQuestionDetailCache = [item];
                openPyqQuestionDetail(0);
            }
        });
    }

    const pyqDetailDialog = document.getElementById("pyqQuestionDetailDialog");
    const pyqDetailBody = document.getElementById("pyqQuestionDetailBody");
    const pyqDetailClose = document.getElementById("pyqQuestionDetailClose");
    const pyqDetailTitle = document.getElementById("pyqQuestionDetailTitle");

    function addPyqDetailRow(rows, seen, label, value) {
        if (value === null || value === undefined) return;

        const text = String(value).trim();

        if (!text || text === "undefined" || text === "null" || text === "—") return;

        const key = text.toLowerCase();

        if (seen.has(key)) return;

        seen.add(key);
        rows.push({ label: label, value: text });
    }

    async function openPyqQuestionFigure(index) {
        const question = pyqQuestionDetailCache[index];
        if (!question) return;
        const content = document.getElementById("figurePreviewContent");
        if (!content) return;
        const resources = question.resources || question.bank?.resources || {};
        const figures = question.has_figures === true && Array.isArray(resources.figures)
            ? resources.figures.filter(resource => resource && (resource.resource_id || resource.id)) : [];
        const tables = question.has_tables === true && Array.isArray(resources.tables)
            ? resources.tables.filter(resource => resource && (resource.resource_id || resource.id)) : [];
        const sourceLine = figureSourceInfo(question.bank || bankQuestionById(question.question_id), question);
        content.innerHTML = "<p>Loading question resources…</p>" + sourceLine;
        lastModalTrigger = document.activeElement;
        closeAllModals();
        const modal = document.getElementById("figurePreviewModal");
        if (modal) modal.classList.remove("hidden");
        syncBodyScroll();
        if (!figures.length && !tables.length) {
            content.innerHTML = "<p>No retrievable figures or tables are available for this question.</p>";
            return;
        }
        const subject = question.subject_id || document.getElementById("qbPyqSubject")?.value;
        try {
            const fetched = await Promise.all([...figures.map(resource => ["figure", resource]), ...tables.map(resource => ["table", resource])].map(async ([type, resource]) => {
                const id = resource.resource_id || resource.id;
                if (!id || !subject) throw new Error("Resource metadata is incomplete.");
                const query = new URLSearchParams({ subject_id: subject });
                const result = await api("/api/question-bank/" + encodeURIComponent(question.question_id) + "/resources/" + type + "/" + encodeURIComponent(id) + "?" + query.toString());
                return { type, result };
            }));
            content.innerHTML = fetched.map(({ type, result }) => {
                if (type === "figure" && result.content_base64) {
                    return '<img src="data:' + escapeHTML(result.metadata?.content_type || result.metadata?.mime_type || "image/png") + ';base64,' + result.content_base64 + '" alt="Question figure" style="max-width:100%;height:auto">';
                }
                if (type === "table" && result.content) {
                    const table = result.content;
                    return '<table class="data-table"><thead><tr>' + (table.headers || []).map(h => '<th>' + escapeHTML(h) + '</th>').join("") + '</tr></thead><tbody>' + (table.rows || []).map(row => '<tr>' + row.map(cell => '<td>' + escapeHTML(cell) + '</td>').join("") + '</tr>').join("") + '</tbody></table>';
                }
                return "";
            }).join("") || "<p>No resource content was returned.</p>";
        } catch (error) {
            content.innerHTML = '<p class="error">Could not load resources: ' + escapeHTML(error.message) + '</p>';
        }
    }

    function openPyqQuestionDetail(index) {
        const question = pyqQuestionDetailCache[index];

        if (!question || !pyqDetailDialog || !pyqDetailBody) return;

        const infoSeen = new Set();
        const sourceSeen = new Set();
        const infoRows = [];
        const sourceRows = [];

        addPyqDetailRow(infoRows, infoSeen, "Question number", questionNumber(question));
        addPyqDetailRow(infoRows, infoSeen, "Question ID", question.question_id);
        addPyqDetailRow(infoRows, infoSeen, "Subject", question.subject_id || question.subject);
        addPyqDetailRow(infoRows, infoSeen, "Marks", (question.marks != null) ? question.marks : null);
        addPyqDetailRow(infoRows, infoSeen, "Question", questionText(question));

        const pageValue = (question.page_number != null)
            ? question.page_number
            : (Array.isArray(question.source_pages) ? question.source_pages.join(", ") : question.source_pages);

        const sourceFilename = sourcePdfName(questionSource(question));

        // No backend PDF-serving route is currently available, so keep the
        // filename as plain text instead of inventing a link.
        addPyqDetailRow(sourceRows, sourceSeen, "Source PDF", sourceFilename);
        addPyqDetailRow(sourceRows, sourceSeen, "Source path", question.source_path);
        addPyqDetailRow(sourceRows, sourceSeen, "Page references", pageValue);
        addPyqDetailRow(sourceRows, sourceSeen, "Section", question.section_name);

        function renderRows(title, rows) {
            if (!rows.length) return "";

            return '<section class="pyq-detail-section">' +
                "<h4>" + escapeHTML(title) + "</h4>" +
                '<dl class="pyq-detail-list">' +
                rows.map(function (row) {
                    return "<dt>" + escapeHTML(row.label) + "</dt>" +
                        "<dd>" + escapeHTML(row.value) + "</dd>";
                }).join("") +
                "</dl></section>";
        }

        if (pyqDetailTitle) {
            pyqDetailTitle.textContent = "Question Details";
        }

        pyqDetailBody.innerHTML =
            renderRows("Question information", infoRows) +
            renderRows("Source metadata", sourceRows);

        if (typeof pyqDetailDialog.showModal === "function") {
            openModal("pyqQuestionDetailDialog");
        } else {
            pyqDetailDialog.setAttribute("open", "open");
            syncBodyScroll();
        }
    }

    function closePyqQuestionDetail() {
        if (!pyqDetailDialog) return;

        if (typeof pyqDetailDialog.close === "function") {
            pyqDetailDialog.close();
        } else {
            pyqDetailDialog.removeAttribute("open");
        }
        syncBodyScroll();
    }

    const qbPyqSubject = document.getElementById("qbPyqSubject");
    const qbMarksGroup = document.getElementById("qbMarksGroup");
    const qbPrioritySort = document.getElementById("qbPrioritySort");
    const qbPyqPageSize = document.getElementById("qbPyqPageSize");
    const qbPyqPrev = document.getElementById("pyqQuestionsPrev");
    const qbPyqNext = document.getElementById("pyqQuestionsNext");

    async function loadQuestionBankMarks(subjectId) {
        const marksSelect = document.getElementById("qbMarksGroup");
        const tbody = document.getElementById("pyqQuestionsTableBody");
        if (!marksSelect) return;
        const token = ++pyqMarksLoadToken;
        pyqActiveQuestionLoadToken = ++pyqQuestionLoadToken;
        if (!subjectId) {
            marksSelect.innerHTML = '<option value="">Select marks</option>';
            marksSelect.disabled = false;
            if (tbody) tbody.innerHTML = '<tr><td colspan="1" class="state-cell">Select a subject to view its questions.</td></tr>';
            return;
        }
        marksSelect.innerHTML = '<option value="">Loading marks…</option>';
        marksSelect.disabled = true;
        if (tbody) tbody.innerHTML = '<tr><td colspan="1" class="state-cell">Loading available marks…</td></tr>';
        const pagination = document.getElementById("pyqQuestionsPagination");
        if (pagination) pagination.style.display = "none";
        try {
            const params = new URLSearchParams({ subject_id: subjectId, page: "1", page_size: "1" });
            const data = await api("/api/question-bank?" + params.toString());
            if (token !== pyqMarksLoadToken || document.getElementById("qbPyqSubject")?.value !== subjectId) return;
            const distinct = Array.from(new Set(
                (Array.isArray(data?.available_marks) ? data.available_marks : [])
                    .map(Number)
                    .filter(function (value) { return Number.isFinite(value) && value > 0; })
            ));
            const sorted = distinct.sort(function (a, b) { return a - b; });
            marksSelect.innerHTML = '<option value="">Select marks</option>' +
                '<option value="all">All Questions</option>' + sorted.map(function (value) {
                return '<option value="' + escapeHTML(String(value)) + '">' + escapeHTML(String(value)) + ' ' + (value === 1 ? 'mark' : 'marks') + '</option>';
            }).join("");
            if (tbody) tbody.innerHTML = '<tr><td colspan="1" class="state-cell">' + (sorted.length ? 'Select "All Questions" or a marks value to view questions.' : 'Select "All Questions" to view every question for this subject.') + '</td></tr>';
        } catch (error) {
            if (token !== pyqMarksLoadToken) return;
            marksSelect.innerHTML = '<option value="">Marks unavailable</option>';
            if (tbody) tbody.innerHTML = '<tr><td colspan="1" class="state-cell error">' + escapeHTML('Could not load available marks: ' + error.message) + '</td></tr>';
        } finally {
            if (token === pyqMarksLoadToken) marksSelect.disabled = false;
        }
    }

    if (qbPyqSubject) {
        qbPyqSubject.addEventListener("change", function () {
            qbMarksGroup.value = "";
            loadQuestionBankMarks(qbPyqSubject.value);
        });
    }

    if (qbMarksGroup) {
        qbMarksGroup.addEventListener("change", function () {
            loadPyqQuestions(true).catch(function () {});
        });
    }

    if (qbPyqPageSize) {
        qbPyqPageSize.addEventListener("change", function () {
            loadPyqQuestions(true).catch(function () {});
        });
    }

    if (qbPrioritySort) {
        qbPrioritySort.addEventListener("change", function () {
            pyqPrioritySort = qbPrioritySort.value || "default";
            pyqQuestionsPage = 1;
            loadPyqQuestions(false).catch(function () {});
        });
    }

    if (qbPyqPrev) {
        qbPyqPrev.addEventListener("click", function () {
            if (pyqQuestionsPage > 1) {
                pyqQuestionsPage -= 1;
                loadPyqQuestions(false).catch(function () {});
            }
        });
    }

    if (qbPyqNext) {
        qbPyqNext.addEventListener("click", function () {
            pyqQuestionsPage += 1;
            loadPyqQuestions(false).catch(function () {});
        });
    }

    const pyqQuestionsTableBody = document.getElementById("pyqQuestionsTableBody");

    if (pyqQuestionsTableBody) {
        pyqQuestionsTableBody.addEventListener("click", function (event) {
            const button = event.target.closest(".pyq-detail-button");
            if (button) {
                const index = Number(button.getAttribute("data-pyq-index"));
                if (!isNaN(index)) {
                    openPyqQuestionDetail(index);
                }
                return;
            }

            const figureBtn = event.target.closest(".pyq-figure-button") || event.target.closest(".pyq-attachment-button") || event.target.closest(".qb-attachments");
            if (figureBtn) {
                const index = Number(figureBtn.getAttribute("data-pyq-index"));
                if (!isNaN(index)) {
                    openPyqQuestionFigure(index);
                }
                return;
            }

            const sourceBtn = event.target.closest(".qb-source");
            if (sourceBtn) {
                const index = Number(sourceBtn.getAttribute("data-pyq-index"));
                if (!isNaN(index)) {
                    openPyqQuestionDetail(index);
                }
            }
        });

    }

    if (pyqDetailClose) {
        pyqDetailClose.addEventListener("click", closePyqQuestionDetail);
    }

    const pyqResultClose = document.getElementById("pyqResultClose");
    const pyqResultDialogEl = document.getElementById("pyqResultDialog");
    if (pyqResultClose) {
        pyqResultClose.addEventListener("click", function () {
            if (pyqResultDialogEl && typeof pyqResultDialogEl.close === "function") {
                pyqResultDialogEl.close();
            }
        });
    }
    const pyqResultBodyEl = document.getElementById("pyqResultBody");
    if (pyqResultBodyEl) {
        pyqResultBodyEl.addEventListener("click", function (event) {
            const view = event.target.closest('button[data-action="view-question"]');
            if (!view) return;
            const idx = Number(view.getAttribute("data-idx"));
            if (!Number.isNaN(idx)) {
                pyqQuestionDetailCache = pyqResultQuestions;
                openPyqQuestionDetail(idx);
            }
        });
    }


    if (pyqDetailDialog) {
        pyqDetailDialog.addEventListener("click", function (event) {
            if (event.target === pyqDetailDialog) {
                closePyqQuestionDetail();
            }
        });

        pyqDetailDialog.addEventListener("cancel", function (event) {
            event.preventDefault();
            closePyqQuestionDetail();
        });
    }

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && pyqDetailDialog && pyqDetailDialog.open) {
            closePyqQuestionDetail();
        }
    });

    // Initial load of parsed PYQ questions when the bank page is opened.
    if (document.getElementById("pyqQuestionsTableBody")) {
        loadPyqQuestions(true).catch(function () {});
    }

    /* =============================================
       GENERATED PAPERS HISTORY
       Sourced exclusively from the backend history API:
       GET /api/question-papers/history (newest first, paginated)
       DELETE /api/question-papers/history/{paper_id}
       GET /api/question-papers/{paper_id}/docx
     ============================================== */

    const papersPageSize = 25;
    let papersPage = 1;
    let papersTotal = 0;
    const paperDocxUrls = new Map();

    function formatPaperDate(value) {
        if (!value) return "—";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return "—";
        return parsed.toLocaleString(undefined, {
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit"
        });
    }

    function paperRowActions(paper) {
        const filename = paper.filename || ("question-paper-" + paper.paper_id + ".docx");
        const downloadAttrs = 'class="table-action" data-paper-download="' + escapeHTML(paper.paper_id) +
            '" data-paper-filename="' + escapeHTML(filename) + '" title="' +
            (paper.docx_available ? "Download DOCX" : "DOCX file is not available on the server") + '"';
        if (!paper.docx_available) downloadAttrs += " disabled";
        const downloadBtn = "<button " + downloadAttrs + ">Download</button>";
        const deleteBtn = '<button class="table-action danger" data-paper-delete="' +
            escapeHTML(paper.paper_id) + '" data-paper-filename="' + escapeHTML(filename) +
            '" title="Delete from history">Delete</button>';
        return '<td class="actions-cell">' + downloadBtn + " " + deleteBtn + "</td>";
    }

    function renderPaperRow(paper) {
        const title = paper.paper_title || paper.title || "Untitled paper";
        const marks = paper.total_marks != null ? String(paper.total_marks) : "—";
        return "<tr>" +
            '<td class="paper-title" title="' + escapeHTML(title) + '">' + escapeHTML(title) + "</td>" +
            "<td>" + escapeHTML(paper.subject || "—") + "</td>" +
            "<td>" + escapeHTML(paper.exam_type || "—") + "</td>" +
            "<td>" + escapeHTML(marks) + "</td>" +
            "<td>" + formatPaperDate(paper.generated_at) + "</td>" +
            "<td>" + escapeHTML(paper.duration || "—") + "</td>" +
            paperRowActions(paper) +
            "</tr>";
    }

    function papersLoadingHTML() {
        return tableStateHTML("⟳", "Loading question papers…", "loading", 7);
    }

    async function loadPapers() {
        papersPage = 1;
        renderDraftPapers();
        return fetchPapers();
    }

    async function fetchPapers() {
        const stat = document.getElementById("statPapers");
        const emptyHTML = tableStateHTML("📄",
            "No question papers have been generated yet. Generate a paper to see it here.", "", 7);

        function setLoading(state) {
            ["papersTableBody", "adminPapersTableBody"].forEach(function (id) {
                const tbody = document.getElementById(id);
                if (tbody) tbody.innerHTML = state;
            });
        }

        if (stat) stat.textContent = "Loading…";
        setLoading(papersLoadingHTML());

        let data;
        try {
            data = await api("/api/question-papers/history?page=" + papersPage +
                "&page_size=" + papersPageSize);
        } catch (error) {
            const message = "Could not load question papers: " + error.message;
            setLoading(tableStateHTML("⚠", message, "error", 7));
            updatePapersPagination(0);
            if (stat) stat.textContent = "Unavailable";
            unbindPapersTables();
            return;
        }

        const items = Array.isArray(data.items) ? data.items : [];
        paperDocxUrls.clear();
        items.forEach(function (paper) {
            if (paper && paper.docx_url) paperDocxUrls.set(String(paper.paper_id), paper.docx_url);
        });
        papersTotal = Number(data.total) || items.length;
        updatePapersPagination(papersTotal);
        if (stat) stat.textContent = papersTotal ? (papersTotal + " paper" + (papersTotal === 1 ? "" : "s")) : "Empty";

        setLoading(items.length ? items.map(renderPaperRow).join("") : emptyHTML);
        bindPapersTable();
    }

    function updatePapersPagination(total) {
        const totalPagesCount = Math.max(1, Math.ceil(total / papersPageSize));
        ["papersPageInfo", "adminPapersPageInfo"].forEach(function (id) {
            const info = document.getElementById(id);
            if (info) info.textContent = total
                ? ("Page " + papersPage + " of " + totalPagesCount + " · " + total + " papers")
                : "No question papers";
        });
        ["papersPrev", "adminPapersPrev"].forEach(function (id) {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = papersPage <= 1;
        });
        ["papersNext", "adminPapersNext"].forEach(function (id) {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = papersPage >= totalPagesCount;
        });
    }

    function previousPapersPage() {
        if (papersPage <= 1) return;
        papersPage -= 1;
        fetchPapers();
    }

    function nextPapersPage() {
        const totalPages = Math.max(1, Math.ceil(papersTotal / papersPageSize));
        if (papersPage >= totalPages) return;
        papersPage += 1;
        fetchPapers();
    }

    async function downloadPaper(paperId, filename) {
        try {
            const providedUrl = paperDocxUrls.get(String(paperId));
            let path = "/api/question-papers/" + encodeURIComponent(paperId) + "/docx";
            if (providedUrl) {
                // Support backend-provided authorized storage URLs (relative or absolute).
                if (/^https?:\/\//i.test(providedUrl)) {
                    // Absolute URL: bypass API_BASE prefix by using fetch directly is not possible
                    // through api(); fall back to endpoint path for consistency.
                    path = "/api/question-papers/" + encodeURIComponent(paperId) + "/docx";
                } else {
                    path = providedUrl;
                }
            }
            await downloadFile(path, filename);
            showToast("Paper downloaded.");
        } catch (error) {
            showToast("Could not download DOCX: " + error.message);
        }
    }

    async function deletePaper(paperId, filename) {
        const confirmed = await confirmAction(
            "Delete question paper",
            'Remove "' + (filename || ("paper " + paperId)) + '" from history? The DOCX file and its record will be removed. This cannot be undone.',
            "Delete");
        if (!confirmed) return;
        try {
            await api("/api/question-papers/history/" + encodeURIComponent(paperId),
                { method: "DELETE" });
            if (papersPage > 1 && (papersPage - 1) * papersPageSize >= papersTotal - 1) {
                papersPage -= 1;
            }
            showToast("Question paper removed from history.");
            fetchPapers();
        } catch (error) {
            showToast("Could not delete paper: " + error.message);
        }
    }

    function papersClickHandler(event) {
        const download = event.target.closest("button[data-paper-download]");
        if (download) {
            downloadPaper(download.getAttribute("data-paper-download"),
                download.getAttribute("data-paper-filename"));
            event.preventDefault();
            return;
        }
        const remove = event.target.closest("button[data-paper-delete]");
        if (remove) {
            deletePaper(remove.getAttribute("data-paper-delete"),
                remove.getAttribute("data-paper-filename"));
            event.preventDefault();
        }
    }

    const papersTableRefs = ["papersTableBody", "adminPapersTableBody"];

    function bindPapersTable() {
        papersTableRefs.forEach(function (id) {
            const tbody = document.getElementById(id);
            if (tbody) {
                tbody.removeEventListener("click", papersClickHandler);
                tbody.addEventListener("click", papersClickHandler);
            }
        });
    }

    function unbindPapersTables() {
        papersTableRefs.forEach(function (id) {
            const tbody = document.getElementById(id);
            if (tbody) tbody.removeEventListener("click", papersClickHandler);
        });
    }

    function renderDraftPapers() {
        const list = document.getElementById("draftPapersList");
        if (list) list.innerHTML = stateHTML("▧", "Saved draft listing is unavailable: the backend does not provide a listing endpoint.", "error");
    }

    /* =============================================
       TEACHER FILTERS
    ============================================== */

    const teacherSearchInput = document.getElementById("teacherSearch");

    if (teacherSearchInput) {
        teacherSearchInput.addEventListener("input", debounce(function () { teachersPage = 1; loadTeachers(); }, 350));
    }

    const teacherStatusFilter = document.getElementById("teacherStatusFilter");

    if (teacherStatusFilter) {
        teacherStatusFilter.addEventListener("change", function () { teachersPage = 1; loadTeachers(); });
    }
    document.getElementById("teachersPrev")?.addEventListener("click", function () { if (teachersPage > 1) { teachersPage -= 1; loadTeachers(); } });
    document.getElementById("teachersNext")?.addEventListener("click", function () { teachersPage += 1; loadTeachers(); });

    document.getElementById("papersPrev")?.addEventListener("click", function () { previousPapersPage(); });
    document.getElementById("papersNext")?.addEventListener("click", function () { nextPapersPage(); });
    document.getElementById("adminPapersPrev")?.addEventListener("click", function () { previousPapersPage(); });
    document.getElementById("adminPapersNext")?.addEventListener("click", function () { nextPapersPage(); });

    /* MOBILE / TABLET DRAWER */

    const mobileMenu = document.getElementById("mobileMenu");
    const sidebar = document.getElementById("sidebar");

    function setDrawer(open) {
        const desktop = window.innerWidth >= 1024;
        document.body.classList.toggle("nav-open", open && !desktop);
        document.body.classList.toggle("sidebar-collapsed", !open && desktop);

        if (mobileMenu) {
            mobileMenu.setAttribute("aria-expanded", open ? "true" : "false");
            mobileMenu.setAttribute("aria-label", open ? "Close sidebar" : "Open sidebar");
            mobileMenu.setAttribute("title", open ? "Close sidebar" : "Open sidebar");
        }
    }

    setDrawer(window.innerWidth >= 1024);

    if (mobileMenu && sidebar) {
        mobileMenu.addEventListener("click", function () {
            const isOpen = window.innerWidth >= 1024
                ? !document.body.classList.contains("sidebar-collapsed")
                : document.body.classList.contains("nav-open");
            setDrawer(!isOpen);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") setDrawer(false);
        });

        let wasDesktop = window.innerWidth >= 1024;
        window.addEventListener("resize", function () {
            const isDesktop = window.innerWidth >= 1024;
            if (isDesktop !== wasDesktop) {
                wasDesktop = isDesktop;
                setDrawer(isDesktop);
            }
        });

        document.addEventListener("click", function (event) {
            if (window.innerWidth >= 1024) return;

            if (
                document.body.classList.contains("nav-open") &&
                !sidebar.contains(event.target) &&
                !mobileMenu.contains(event.target)
            ) {
                setDrawer(false);
            }
        });
    }

    async function downloadFile(path, filename, options) {
    const blob = await api(path, options || {});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/* GENERATE QUESTION PAPER (simplified form) */

    const generatePaperForm = document.getElementById("generatePaperForm");
    const sectionTableBody = document.getElementById("sectionTableBody");
    const addSectionButton = document.getElementById("addSectionButton");
    const sectionTotalMessage = document.getElementById("sectionTotalMessage");

    let sections = [];
    let availableMarks = [];
    let blueprints = [];
    let blueprintsLoaded = false;
    let currentBlueprintId = null;
    let generatedDraft = null;
    let questionBankCache = [];
    let questionBankLoadToken = 0;

    function nextSectionName() {
        const used = new Set(sections.map(s => s.name));
        let i = 0;
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        while (i < letters.length && used.has(letters[i])) i++;
        return letters[i] || ("Section " + (sections.length + 1));
    }

    function generateBlueprintId() {
        try {
            if (window.crypto && typeof window.crypto.randomUUID === "function") {
                return window.crypto.randomUUID();
            }
        } catch (e) {}
        return "bp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }

    function renderSections() {
        if (!sectionTableBody) return;
        sectionTableBody.innerHTML = sections.map(function (section, index) {
            const total = (Number(section.questions) || 0) * (Number(section.marks) || 0);
            return "<tr>" +
                '<td><input type="text" class="section-name" data-index="' + index + '" value="' + escapeHTML(section.name) + '"></td>' +
                '<td><input type="number" class="section-questions" data-index="' + index + '" min="1" value="' + escapeHTML(String(section.questions)) + '"></td>' +
                '<td><input type="text" class="section-marks" data-index="' + index + '" inputmode="decimal" list="marksOptions" value="' + escapeHTML(String(section.marks)) + '"></td>' +
                '<td class="section-total-cell">' + total + "</td>" +
                '<td><button type="button" class="btn btn-danger small section-remove" data-index="' + index + '">Remove</button> ' +
                (index > 0 ? '<button type="button" class="btn btn-secondary small section-up" data-index="' + index + '">Up</button> ' : "") +
                (index < sections.length - 1 ? '<button type="button" class="btn btn-secondary small section-down" data-index="' + index + '">Down</button>' : "") +
                "</td></tr>";
        }).join("");

        validateSections();
    }

    function readSectionsFromTable() {
        if (!sectionTableBody) return;
        const rows = Array.prototype.slice.call(sectionTableBody.querySelectorAll("tr"));
        sections = rows.map(function (row, index) {
            const fallback = sections[index] || {};
            const nameInput = row.querySelector(".section-name");
            const qInput = row.querySelector(".section-questions");
            const mInput = row.querySelector(".section-marks");
            return {
                name: nameInput ? (nameInput.value.trim() || fallback.name || ("Section " + (index + 1))) : (fallback.name || ("Section " + (index + 1))),
                questions: qInput ? (Number(qInput.value) || 0) : (Number(fallback.questions) || 0),
                marks: mInput ? (Number(mInput.value) || 0) : (Number(fallback.marks) || 0)
            };
        });
    }

    function validateSections() {
        readSectionsFromTable();
        const total = sections.reduce(function (sum, section) {
            return sum + ((Number(section.questions) || 0) * (Number(section.marks) || 0));
        }, 0);
        const totalMarksInput = document.getElementById("totalMarks");
        let paperTotal = Number(totalMarksInput?.value);
        if (!Number.isFinite(paperTotal) || totalMarksInput?.value === "") {
            const currentBlueprint = Array.isArray(blueprints)
                ? blueprints.find(function (item) { return String(blueprintIdOf(item)) === String(currentBlueprintId); })
                : null;
            if (currentBlueprint && currentBlueprint.total_marks != null) {
                const bpTotal = Number(currentBlueprint.total_marks);
                if (Number.isFinite(bpTotal)) paperTotal = bpTotal;
            }
        }
        const target = Number.isFinite(paperTotal) ? paperTotal : 0;
        const ok = sections.length > 0 && total === target;
        // Keep each section's displayed total in sync with its inputs.
        if (sectionTableBody) {
            const rows = Array.prototype.slice.call(sectionTableBody.querySelectorAll("tr"));
            rows.forEach(function (row, index) {
                const cell = row.querySelector(".section-total-cell");
                if (cell && sections[index]) {
                    cell.textContent = String((Number(sections[index].questions) || 0) * (Number(sections[index].marks) || 0));
                }
            });
        }
        if (sectionTotalMessage) {
            sectionTotalMessage.textContent = "Sections total: " + total + " / " + target;
            sectionTotalMessage.style.color = ok ? "#16a34a" : "#dc2626";
        }
        return ok;
    }

    if (addSectionButton) {
        addSectionButton.addEventListener("click", function () {
            readSectionsFromTable();
            sections.push({ name: nextSectionName(), questions: 1, marks: 1 });
            renderSections();
        });
    }

    if (sectionTableBody) {
        sectionTableBody.addEventListener("input", function () {
            validateSections();
            const totalMarks = document.getElementById("totalMarks");
            if (totalMarks) updateGenerationSummary();
        });

        sectionTableBody.addEventListener("click", function (event) {
            const remove = event.target.closest(".section-remove");
            const up = event.target.closest(".section-up");
            const down = event.target.closest(".section-down");

            if (remove) {
                readSectionsFromTable();
                const index = Number(remove.getAttribute("data-index"));
                sections.splice(index, 1);
                renderSections();
                return;
            }

            if (up) {
                readSectionsFromTable();
                const index = Number(up.getAttribute("data-index"));
                if (index > 0) {
                    [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
                    renderSections();
                }
                return;
            }

            if (down) {
                readSectionsFromTable();
                const index = Number(down.getAttribute("data-index"));
                if (index < sections.length - 1) {
                    [sections[index + 1], sections[index]] = [sections[index], sections[index + 1]];
                    renderSections();
                }
            }
        });
    }

    async function loadSubjectMarks(subject) {
        const datalist = document.getElementById("marksOptions");
        if (!subject) {
            availableMarks = [];
            if (datalist) datalist.innerHTML = "";
            return;
        }
        try {
            const data = await api("/api/question-bank?subject_id=" + encodeURIComponent(subject) + "&page=1&page_size=1");
            availableMarks = (Array.isArray(data.available_marks) ? data.available_marks : [])
                .map(Number).filter(value => Number.isFinite(value) && value > 0)
                .sort(function (a, b) { return a - b; });
            if (datalist) {
                datalist.innerHTML = availableMarks.map(function (mark) {
                    return '<option value="' + mark + '">';
                }).join("");
            }
            const hasUnsupported = availableMarks.length && sections.some(function (section) {
                return !availableMarks.includes(Number(section.marks));
            });
            if (!sections.length || hasUnsupported) {
                sections = [];
                applySubjectDefaults();
            }
            renderSections();
            validateSections();
        } catch (error) {
            availableMarks = [];
            if (datalist) datalist.innerHTML = "";
            showToast("Could not load subject question marks: " + error.message);
        }
    }

    function applySubjectDefaults() {
        renderSections();
        validateSections();
        updateGenerationSummary();
    }

    function buildDefaultSections(total, marksList) {
        const marks = (marksList && marksList.length) ? marksList.slice().sort(function (a, b) { return a - b; }) : [];
        const target = Number(total) || 0;
        if (!marks.length || !target) return [];

        // Try a single supported mark.
        for (let i = marks.length - 1; i >= 0; i -= 1) {
            const mark = marks[i];
            if (mark > 0 && target % mark === 0) {
                return [{ name: "A", questions: target / mark, marks: mark }];
            }
        }

        // Try two supported marks.
        for (let i = 0; i < marks.length; i += 1) {
            for (let j = 0; j < marks.length; j += 1) {
                const m1 = marks[i];
                const m2 = marks[j];
                if (m1 <= 0 || m2 <= 0) continue;
                for (let q1 = 1; q1 <= Math.floor(target / m1); q1 += 1) {
                    const remainder = target - (q1 * m1);
                    if (remainder <= 0) continue;
                    if (remainder % m2 === 0) {
                        const q2 = remainder / m2;
                        if (q2 >= 1) {
                            return [
                                { name: "A", questions: q1, marks: m1 },
                                { name: "B", questions: q2, marks: m2 }
                            ];
                        }
                    }
                }
            }
        }

        // Try three supported marks.
        for (let i = 0; i < marks.length; i += 1) {
            for (let j = 0; j < marks.length; j += 1) {
                for (let k = 0; k < marks.length; k += 1) {
                    const m1 = marks[i];
                    const m2 = marks[j];
                    const m3 = marks[k];
                    if (m1 <= 0 || m2 <= 0 || m3 <= 0) continue;
                    for (let q1 = 1; q1 <= Math.floor(target / m1); q1 += 1) {
                        for (let q2 = 1; q2 <= Math.floor((target - q1 * m1) / m2); q2 += 1) {
                            const remainder = target - (q1 * m1) - (q2 * m2);
                            if (remainder <= 0) continue;
                            if (remainder % m3 === 0) {
                                const q3 = remainder / m3;
                                if (q3 >= 1) {
                                    return [
                                        { name: "A", questions: q1, marks: m1 },
                                        { name: "B", questions: q2, marks: m2 },
                                        { name: "C", questions: q3, marks: m3 }
                                    ];
                                }
                            }
                        }
                    }
                }
            }
        }

        // Fallback: keep total by using the smallest mark and absorb remainder.
        const mark = marks[0];
        const questions = Math.max(1, Math.floor(target / mark));
        const used = questions * mark;
        const remainder = target - used;
        if (remainder > 0) return [];
        return [{ name: "A", questions: questions, marks: mark }];
    }

    function blueprintIdOf(blueprint) {
        return blueprint ? (blueprint.blueprint_id || blueprint.id) : null;
    }

    function isCanonicalDefaultBlueprint(blueprint) {
        if (!blueprint) return false;
        const id = String(blueprintIdOf(blueprint) || "").trim().toLowerCase();
        const name = String(blueprint.name || "").trim().toLowerCase();
        return id === "default-generic" || name === "default-generic" || id === "default" && Boolean(blueprint.is_default);
    }

    function applyBlueprint(blueprint) {
        if (!blueprint) return;
        currentBlueprintId = blueprintIdOf(blueprint);
        const subjectSelect = document.getElementById("paperSubject");
        if (subjectSelect && blueprint.subject_id) {
            subjectSelect.value = blueprint.subject_id;
            if (typeof loadSubjectMarks === "function") loadSubjectMarks(blueprint.subject_id);
            if (typeof loadQuestionBank === "function") loadQuestionBank(blueprint.subject_id);
        }
        const examType = document.getElementById("examType");
        if (examType && blueprint.exam_type) examType.value = blueprint.exam_type;

        if (Array.isArray(blueprint.sections) && blueprint.sections.length) {
            sections = blueprint.sections.map(function (section) {
                return {
                    name: section.name,
                    questions: Number(section.question_count ?? section.questions),
                    marks: Number(section.marks_per_question ?? section.marks)
                };
            });
        } else {
            sections = [];
        }
        const totalMarks = sections.reduce(function (sum, section) {
            return sum + (Number(section.questions) || 0) * (Number(section.marks) || 0);
        }, 0);
        const totalInput = document.getElementById("totalMarks");
        if (totalInput && totalMarks > 0) totalInput.value = String(totalMarks);
        renderSections();
        validateSections();
        updateGenerationSummary();
        renderBlueprintSelect();
    }

    function setBlueprintStatus(message, isError) {
        const status = document.getElementById("blueprintStatus");
        if (!status) return;
        status.textContent = message || "";
        status.style.color = isError ? "#dc2626" : "#16a34a";
    }

    function renderBlueprintSelect() {
        const select = document.getElementById("blueprintSelect");
        if (!select) return;
        const customBlueprints = (Array.isArray(blueprints) ? blueprints : []).filter(function (blueprint) {
            return !isCanonicalDefaultBlueprint(blueprint);
        });
        const current = currentBlueprintId || "";
        if (!customBlueprints.length) {
            select.innerHTML = '<option value="">No saved blueprints</option>';
            select.value = "";
            return;
        }
        select.innerHTML = customBlueprints.map(function (blueprint) {
            const id = blueprintIdOf(blueprint);
            return '<option value="' + escapeHTML(String(id)) + '">' +
                escapeHTML(blueprint.name || "") +
                "</option>";
        }).join("");
        if (current && customBlueprints.some(function (b) { return String(blueprintIdOf(b)) === String(current); })) {
            select.value = current;
        } else {
            select.value = "";
        }
    }

    async function loadBlueprints() {
        setBlueprintStatus("Loading blueprints…", false);
        try {
            const data = blueprintsLoaded
                ? { items: blueprints }
                : await api("/blueprints");
            blueprints = (data.items || data.blueprints || []).filter(function (b) { return !isCanonicalDefaultBlueprint(b); });
            blueprintsLoaded = true;
            renderBlueprintSelect();
            const firstCustom = blueprints[0];
            if (firstCustom) {
                applyBlueprint(firstCustom);
            } else {
                currentBlueprintId = null;
                renderBlueprintSelect();
            }
            setBlueprintStatus(blueprints.length ? "Blueprints loaded." : "No saved blueprints yet.", false);
        } catch (error) {
            blueprints = [];
            renderBlueprintSelect();
            setBlueprintStatus("Could not load blueprints: " + error.message, true);
        }
    }

    function newBlueprint() {
        currentBlueprintId = null;
        const nameInput = document.getElementById("blueprintName");
        const descInput = document.getElementById("blueprintDescription");
        if (nameInput) nameInput.value = "";
        if (descInput) descInput.value = "";
        renderBlueprintSelect();
        setBlueprintStatus("New blueprint. Edit sections, then Save.", false);
    }

    async function renameBlueprint() {
        if (!currentBlueprintId) {
            setBlueprintStatus("Select a saved blueprint to rename.", true);
            return;
        }
        const current = blueprints.find(function (b) { return String(blueprintIdOf(b)) === String(currentBlueprintId); });
        const proposed = window.prompt("Rename blueprint", current ? (current.name || "") : "");
        if (proposed === null) return;
        const nameInput = document.getElementById("blueprintName");
        if (nameInput) nameInput.value = proposed.trim();
        await saveBlueprint();
    }

    async function duplicateBlueprint() {
        if (!currentBlueprintId) {
            setBlueprintStatus("Select a blueprint to duplicate.", true);
            return;
        }
        setBlueprintStatus("Duplicating…", false);
        try {
            const copy = await api("/blueprints/" + encodeURIComponent(currentBlueprintId) + "/duplicate", {
                method: "POST",
                body: {}
            });
            blueprints.push(copy);
            applyBlueprint(copy);
            setBlueprintStatus("Blueprint duplicated.", false);
        } catch (error) {
            setBlueprintStatus("Duplicate failed: " + error.message, true);
        }
    }

    async function deleteBlueprint() {
        if (!currentBlueprintId) {
            setBlueprintStatus("Select a blueprint to delete.", true);
            return;
        }
        if (!window.confirm("Delete this blueprint?")) return;
        setBlueprintStatus("Deleting…", false);
        try {
            await api("/blueprints/" + encodeURIComponent(currentBlueprintId), { method: "DELETE" });
            blueprints = blueprints.filter(function (b) { return String(blueprintIdOf(b)) !== String(currentBlueprintId); });
            currentBlueprintId = null;
            const fallback = blueprints.find(function (b) { return b.is_default; }) || blueprints[0];
            if (fallback) applyBlueprint(fallback);
            else newBlueprint();
            setBlueprintStatus("Blueprint deleted.", false);
        } catch (error) {
            setBlueprintStatus("Delete failed: " + error.message, true);
        }
    }

    async function saveBlueprint() {
        const nameInput = document.getElementById("blueprintName");
        const descInput = document.getElementById("blueprintDescription");
        const name = nameInput ? nameInput.value.trim() : "";
        if (!name) {
            setBlueprintStatus("Blueprint name is required.", true);
            return;
        }
        readSectionsFromTable();
        if (!validateSections()) {
            setBlueprintStatus("Section totals must equal total marks before saving.", true);
            return;
        }
        const subject = document.getElementById("paperSubject")?.value || null;
        const examType = document.getElementById("examType")?.value.trim() || null;
        const current = blueprints.find(item => String(blueprintIdOf(item)) === String(currentBlueprintId));
        if (isCanonicalDefaultBlueprint(current)) {
            setBlueprintStatus("The default blueprint is protected. Duplicate it before saving changes.", true);
            return;
        }
        const blueprintId = currentBlueprintId || generateBlueprintId();
        const payload = {
            blueprint_id: blueprintId,
            name: name,
            description: descInput ? descInput.value.trim() || null : null,
            subject_id: subject,
            exam_type: examType,
            sections: toBackendSections(),
            is_default: current ? Boolean(current.is_default) : blueprints.length === 0
        };
        const saveButton = document.getElementById("saveBlueprintButton");
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = "Saving…";
        }
        setBlueprintStatus("Saving blueprint…", false);
        try {
            let saved;
            if (currentBlueprintId) {
                saved = await api("/blueprints/" + encodeURIComponent(currentBlueprintId), {
                    method: "PATCH",
                    body: payload
                });
            } else {
                saved = await api("/blueprints", {
                    method: "POST",
                    body: payload
                });
            }
            const savedId = blueprintIdOf(saved) || blueprintId;
            blueprintsLoaded = true;
            const existingIndex = blueprints.findIndex(function (b) { return String(blueprintIdOf(b)) === String(savedId); });
            if (existingIndex >= 0) blueprints[existingIndex] = saved;
            else blueprints.push(saved);
            currentBlueprintId = savedId;
            renderBlueprintSelect();
            setBlueprintStatus("Blueprint saved.", false);
        } catch (error) {
            setBlueprintStatus("Save failed: " + error.message, true);
        } finally {
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = "Save";
            }
        }
    }

    function toBackendSections() {
        return sections.map(function (section) {
            return {
                name: section.name,
                question_count: Number(section.questions),
                marks_per_question: Number(section.marks)
            };
        });
    }

    function blueprintMatchesCurrent() {
        const blueprint = blueprints.find(item => String(blueprintIdOf(item)) === String(currentBlueprintId));
        if (!blueprint || !Array.isArray(blueprint.sections)) return false;
        const selectedSubject = document.getElementById("paperSubject")?.value;
        const selectedExamType = document.getElementById("examType")?.value.trim();
        if (blueprint.subject_id && blueprint.subject_id !== selectedSubject) return false;
        if (blueprint.exam_type && blueprint.exam_type !== selectedExamType) return false;
        const savedSections = blueprint.sections.map(section => ({
            name: section.name,
            question_count: Number(section.question_count ?? section.questions),
            marks_per_question: Number(section.marks_per_question ?? section.marks)
        }));
        return JSON.stringify(savedSections) === JSON.stringify(toBackendSections());
    }

    /* Blueprint storage behind generation: the backend contract requires a
       saved blueprint for every draft (S25/S26), and the default blueprint is
       protected. When the displayed sections already match the selected
       blueprint, nothing is written; otherwise the working blueprint is
       PATCHed, or a new one is POSTed when none fits — so the Generate button
       always works without manual blueprint management. */
    async function ensureBlueprintForGeneration(title, examType, subject) {
        const current = blueprints.find(item => String(blueprintIdOf(item)) === String(currentBlueprintId));
        if (current && blueprintMatchesCurrent()) return current;
        const payloadBlueprintId = (current && !current.is_default && currentBlueprintId) ? currentBlueprintId : generateBlueprintId();
        const payload = {
            blueprint_id: payloadBlueprintId,
            name: ((title || "Untitled paper") + (examType ? " — " + examType : "")).trim(),
            description: null,
            subject_id: subject || null,
            exam_type: examType || null,
            sections: toBackendSections(),
            is_default: false
        };
        let saved;
        if (current && !current.is_default) {
            saved = await api("/blueprints/" + encodeURIComponent(blueprintIdOf(current)), {
                method: "PATCH",
                body: payload
            });
        } else {
            saved = await api("/blueprints", { method: "POST", body: payload });
        }
        const savedId = blueprintIdOf(saved);
        const existingIndex = blueprints.findIndex(function (b) { return String(blueprintIdOf(b)) === String(savedId); });
        if (existingIndex >= 0) blueprints[existingIndex] = saved;
        else blueprints.push(saved);
        blueprintsLoaded = true;
        currentBlueprintId = savedId;
        return saved;
    }

    function updateGenerationSummary() {
        const title = document.getElementById("paperTitle");
        const subject = document.getElementById("paperSubject");
        const marks = document.getElementById("totalMarks");
        const duration = document.getElementById("duration");
        const summaryTitle = document.getElementById("summaryTitle");
        const summaryDetails = document.getElementById("summaryDetails");

        if (summaryTitle && title) {
            summaryTitle.textContent = title.value.trim() || "Question Paper";
        }

        if (summaryDetails && subject && marks && duration) {
            const subjectLabel = subject.options && subject.selectedIndex >= 0
                ? (subject.options[subject.selectedIndex].textContent || subject.value || "Subject")
                : (subject.value || "Subject");
            summaryDetails.textContent =
                `${subjectLabel || "Subject"} • ${marks.value || 0} Marks • ${duration.value || "3 Hours"}`.trim();
        }
    }

    function clearFieldErrors() {
        ["paperTitle", "paperSubject", "examType", "totalMarks", "duration"].forEach(function (id) {
            const error = document.getElementById(id + "Error");
            if (error) error.textContent = "";
        });
    }

    function setFieldError(id, message) {
        const error = document.getElementById(id + "Error");
        if (error) error.textContent = message;
    }


    function bankQuestionById(id) {
        return (questionBankCache || []).find(function (item) { return item.question_id === id; });
    }

    function draftQuestionId(question) {
        return question?.bank_question_id || question?.question_id || "";
    }

    async function loadQuestionBank(subject) {
        const token = ++questionBankLoadToken;
        if (!subject) {
            questionBankCache = [];
            return;
        }
        try {
            const all = [];
            let page = 1;
            let totalPages = 1;
            do {
                const data = await api("/api/question-bank?subject_id=" + encodeURIComponent(subject) + "&page=" + page + "&page_size=200");
                if (token !== questionBankLoadToken || document.getElementById("paperSubject")?.value !== subject) return;
                all.push(...(Array.isArray(data.items) ? data.items : []));
                totalPages = Math.max(1, Number(data.pagination?.total_pages) || 1);
                page += 1;
            } while (page <= totalPages);
            questionBankCache = all;
        } catch (error) {
            questionBankCache = [];
            showToast("Could not load question bank: " + error.message);
            throw error;
        }
    }

    /* Source information for the figure/tables popup — only fields the backend
       actually delivers; returns "" when nothing is known. */
    function figureSourceInfo(bank, question) {
        const source = (bank && (bank.source_pdf || bank.sourcePdf)) || question.source_pdf || "";
        const pages = question.source_pages || (bank && bank.source_pages) || null;
        const pageValue = question.page_number != null
            ? question.page_number
            : (Array.isArray(pages) ? pages.join(", ") : pages);
        if (!source && !pageValue) return "";
        const parts = [];
        if (source) parts.push("Source: " + sourcePdfName(String(source)));
        if (pageValue != null && pageValue !== "") parts.push("Page(s): " + pageValue);
        return parts.length ? '<p class="figure-source-info">' + escapeHTML(parts.join(" · ")) + "</p>" : "";
    }

    /* The review shows clean question text only: extraction artifacts such as
       CO/BL book-keeping tags and source marker lines are presentation noise
       and are stripped for display without touching the stored question. */
    function cleanDraftQuestionText(question) {
        let text = String(question.text || "").replace(/\r/g, "");
        text = text.replace(/\[(?:CO|BL)\s*[-–]?\s*\d+\]|\((?:CO|BL)\s*[-–]?\s*\d+\)/gi, " ");
        text = text.split("\n").map(function (line) {
            const stripped = line.trim();
            // Drop lines that are nothing but CO/BL book-keeping tags.
            return /^(?:\[(?:CO|BL)\s*[-–]?\s*\d+\]|\((?:CO|BL)\s*[-–]?\s*\d+\)|(?:CO|BL)\s*[-–]?\s*\d+\s*[:.])(?:\s*[,.:;]|\s)*$/i.test(stripped)
                ? ""
                : stripped.trim();
        }).filter(Boolean).join(" ");
        return text.trim() || "—";
    }

    function figureSummary(bank) {
        if (!bank) return { type: "none", label: "-" };
        const resources = bank.resources || {};
        if (Array.isArray(resources.figures) && resources.figures.length) return { type: "asset", label: "Figures (" + resources.figures.length + ")" };
        if (Array.isArray(resources.tables) && resources.tables.length) return { type: "table", label: "Tables (" + resources.tables.length + ")" };
        return { type: "none", label: "-" };
    }

    function renderDraftReview() {
        const tbody = document.getElementById("draftReviewTableBody");
        if (!tbody || !generatedDraft) return;
        const rows = [];
        let sequence = 0;
        const totalQuestions = generatedDraft.sections.reduce(function (count, section) {
            return count + (Array.isArray(section.questions) ? section.questions.length : 0);
        }, 0);
        if (!totalQuestions) {
            tbody.innerHTML = '<tr><td colspan="5" class="state-cell">' +
                "No questions remain in this draft. Add questions from the subject question bank or generate again." +
                "</td></tr>";
            validateDraft();
            return;
        }
        generatedDraft.sections.forEach(function (section, si) {
            (section.questions || []).forEach(function (question, qi) {
                sequence += 1;
                const bank = question.bank || bankQuestionById(draftQuestionId(question));
                const figure = figureSummary(bank);
                rows.push('<tr data-si="' + si + '" data-qi="' + qi + '">' +
                    '<td data-label="#" class="dr-number-cell">' + sequence + '</td>' +
                    '<td data-label="Question text" class="draft-text-cell">' + escapeHTML(cleanDraftQuestionText(question)) + '</td>' +
                    '<td data-label="Marks">' + escapeHTML(question.marks == null ? "—" : String(question.marks)) + '</td>' +
                    '<td data-label="Figure">' + (figure.label !== "-" ? '<button type="button" class="btn btn-secondary small draft-figure" data-si="' + si + '" data-qi="' + qi + '">' + escapeHTML(figure.label) + '</button>' : '—') + '</td>' +
                    '<td data-label="Actions">' +
                        '<div class="draft-row-actions">' +
                        '<button type="button" class="btn btn-secondary small icon-button draft-edit" data-si="' + si + '" data-qi="' + qi + '" title="Edit question" aria-label="Edit question"><svg class="btn-icon" aria-hidden="true"><use href="#icon-edit"/></svg></button> ' +
                        '<button type="button" class="btn btn-secondary small draft-source" data-si="' + si + '" data-qi="' + qi + '" title="View source" aria-label="View source"><svg class="btn-icon" aria-hidden="true"><use href="#icon-file"/></svg>Source</button> ' +
                        '<button type="button" class="btn btn-secondary small draft-up" data-si="' + si + '" data-qi="' + qi + '">Up</button> ' +
                        '<button type="button" class="btn btn-secondary small draft-down" data-si="' + si + '" data-qi="' + qi + '">Down</button> ' +
                        '<button type="button" class="btn btn-secondary small draft-regenerate" data-si="' + si + '" data-qi="' + qi + '">Regenerate</button> ' +
                        '<button type="button" class="btn btn-danger small draft-remove" data-si="' + si + '" data-qi="' + qi + '">Remove</button>' +
                        '</div>' +
                    '</td>' +
                '</tr>');
            });
        });
        tbody.innerHTML = rows.join("");
        validateDraft();
    }

    function syncDraftFromTable() {
        if (!generatedDraft) return;
        generatedDraft.sections.forEach(function (section, si) {
            section.questions.forEach(function (question, qi) {
                const row = document.querySelector('#draftReviewTableBody tr[data-si="' + si + '"][data-qi="' + qi + '"]');
                if (!row) return;
                const text = row.querySelector(".draft-text");
                const marks = row.querySelector(".draft-marks");
                if (text) question.text = text.value;
                if (marks) {
                    const value = Number(marks.value);
                    if (Number.isFinite(value)) question.marks = value;
                }
            });
        });
    }

    function validateDraft() {
        if (!generatedDraft) return false;
        let currentTotal = 0;
        generatedDraft.sections.forEach(function (section) {
            section.questions.forEach(function (question) {
                currentTotal += Number(question.marks) || 0;
            });
        });
        const requested = Number(document.getElementById("totalMarks")?.value) || 0;
        const hasQuestions = generatedDraft.sections.some(function (section) { return section.questions.length > 0; });
        const ok = hasQuestions && requested > 0 && currentTotal === requested;
        const message = document.getElementById("draftValidationMessage");
        if (message) {
            const shortageNote = generatedDraft.shortages?.length ? " Backend shortages: " + JSON.stringify(generatedDraft.shortages) : "";
            message.textContent = "Current total: " + currentTotal + " / Requested: " + requested + (ok ? " (valid)" : " (mismatch)") + shortageNote;
            message.style.color = ok ? "#16a34a" : "#dc2626";
        }
        const exportButton = document.getElementById("exportDocxButton");
        if (exportButton) exportButton.disabled = !ok;
        return ok;
    }

    async function moveDraftQuestion(si, qi, delta) {
        if (!generatedDraft) return;
        const section = generatedDraft.sections[si];
        if (!section) return;
        const targetIndex = qi + delta;
        if (targetIndex < 0 || targetIndex >= section.questions.length) return;
        const ids = generatedDraft.sections.flatMap(item => item.questions.map(draftQuestionId));
        const sectionStart = generatedDraft.sections.slice(0, si).reduce((n, item) => n + item.questions.length, 0);
        const from = sectionStart + qi;
        const to = sectionStart + targetIndex;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        try {
            generatedDraft = await api("/api/question-papers/drafts/" + encodeURIComponent(generatedDraft.draft_id) + "/question-order", { method: "PUT", body: { question_ids: ids } });
            renderDraftReview();
        } catch (error) { showToast(error.message); }
    }

    async function removeDraftQuestion(si, qi) {
        if (!generatedDraft) return;
        const section = generatedDraft.sections[si];
        if (!section) return;
        const question = section.questions[qi];
        try {
            generatedDraft = await api("/api/question-papers/drafts/" + encodeURIComponent(generatedDraft.draft_id) + "/questions/" + encodeURIComponent(draftQuestionId(question)), { method: "DELETE" });
            renderDraftReview();
        } catch (error) { showToast(error.message); }
    }

    async function regenerateDraftQuestion(si, qi) {
        if (!generatedDraft) return;
        const section = generatedDraft.sections[si];
        if (!section) return;
        const question = section.questions[qi];
        if (!question) return;
        const marks = Number(question.marks);
        const sectionName = section.name;
        const draftId = generatedDraft.draft_id;
        const originalGlobalIndex = generatedDraft.sections.slice(0, si).reduce(function (n, item) {
            return n + (Array.isArray(item.questions) ? item.questions.length : 0);
        }, 0) + qi;
        const existingIds = new Set(generatedDraft.sections.flatMap(function (item) {
            return (item.questions || []).map(draftQuestionId);
        }));
        try {
            await loadQuestionBank(generatedDraft.subject);
        } catch (e) {}
        const candidates = (questionBankCache || []).filter(function (item) {
            if (existingIds.has(item.question_id)) return false;
            if (!Number.isFinite(marks) || marks <= 0) return true;
            return Number(item.marks) === marks;
        });
        if (!candidates.length) {
            showToast("No replacement question available with the same marks.");
            return;
        }
        const replacement = candidates[Math.floor(Math.random() * candidates.length)];
        try {
            generatedDraft = await api("/api/question-papers/drafts/" + encodeURIComponent(draftId) + "/questions/" + encodeURIComponent(draftQuestionId(question)), { method: "DELETE" });
            generatedDraft = await api("/api/question-papers/drafts/" + encodeURIComponent(draftId) + "/questions", { method: "POST", body: { question_id: replacement.question_id, section: sectionName } });
            // Move the replacement into the original slot when possible.
            try {
                const ids = generatedDraft.sections.flatMap(function (item) {
                    return (item.questions || []).map(draftQuestionId);
                });
                const replIndex = ids.indexOf(replacement.question_id);
                if (replIndex !== -1 && replIndex !== originalGlobalIndex && originalGlobalIndex < ids.length) {
                    const moved = ids.splice(replIndex, 1)[0];
                    ids.splice(originalGlobalIndex, 0, moved);
                    generatedDraft = await api("/api/question-papers/drafts/" + encodeURIComponent(draftId) + "/question-order", { method: "PUT", body: { question_ids: ids } });
                }
            } catch (orderError) { /* keep appended position if reorder fails */ }
            renderDraftReview();
            showToast("Question regenerated.");
        } catch (error) {
            showToast(error.message || "Could not regenerate the question.");
        }
    }

    function changeDraftSection(si, qi, newSectionName) {
        if (!generatedDraft) return;
        const section = generatedDraft.sections[si];
        if (!section) return;
        const question = section.questions.splice(qi, 1)[0];
        if (!question) return;
        let target = generatedDraft.sections.find(function (item) { return item.name === newSectionName; });
        if (!target) {
            target = { name: newSectionName, questions: [] };
            generatedDraft.sections.push(target);
        }
        target.questions.push(question);
        renderDraftReview();
    }

    function openAddQuestionModal() {
        lastModalTrigger = document.activeElement;
        closeAllModals();
        const modal = document.getElementById("addQuestionModal");
        if (modal) modal.classList.remove("hidden");
        renderAddQuestionList();
        syncBodyScroll();
        const focusable = modal ? modal.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") : null;
        if (focusable) focusable.focus();
    }

    function closeAddQuestionModal() {
        const modal = document.getElementById("addQuestionModal");
        if (modal) modal.classList.add("hidden");
        syncBodyScroll();
        if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
    }

    function renderAddQuestionList() {
        const tbody = document.getElementById("addQuestionTableBody");
        if (!tbody || !generatedDraft) return;
        const search = (document.getElementById("addQuestionSearch")?.value || "").toLowerCase();
        const existing = new Set(generatedDraft.sections.flatMap(function (section) {
            return section.questions.map(draftQuestionId);
        }));
        const rows = questionBankCache.filter(function (item) {
            if (existing.has(item.question_id)) return false;
            const text = (item.cleaned_text || item.original_text || "").toLowerCase();
            return !search || text.includes(search);
        });
        tbody.innerHTML = rows.map(function (item) {
            const text = item.cleaned_text || item.original_text || "";
            const source = [item.source_pdf, (item.source_pages || []).join(", ")].filter(Boolean).join(" • ");
            return '<tr>' +
                '<td>' + escapeHTML(text.slice(0, 180)) + '</td>' +
                '<td>' + escapeHTML(String(item.marks || "")) + '</td>' +
                '<td>' + escapeHTML(source) + '</td>' +
                '<td><button type="button" class="btn btn-primary small add-bank-question" data-id="' + escapeHTML(item.question_id) + '">Add</button></td>' +
            '</tr>';
        }).join("");
    }

    async function addBankQuestionToDraft(questionId) {
        const bank = bankQuestionById(questionId);
        if (!bank || !generatedDraft) return;
        const sectionName = generatedDraft.sections[0]?.name;
        if (!sectionName) { showToast("The draft has no backend section to add a question to."); return; }
        try {
            generatedDraft = await api("/api/question-papers/drafts/" + encodeURIComponent(generatedDraft.draft_id) + "/questions", { method: "POST", body: { question_id: bank.question_id, section: sectionName } });
            renderDraftReview();
        } catch (error) { showToast(error.message); }
    }

    function openSourceDetail(si, qi) {
        if (!generatedDraft) return;
        const question = generatedDraft.sections[si]?.questions[qi];
        if (!question) return;
        const bank = question.bank || bankQuestionById(draftQuestionId(question));
        const assets = bank?.resources?.figures || [];
        const tables = bank?.resources?.tables || [];
        const sourcePages = question.source_pages || bank?.source_pages || [];
        const content = document.getElementById("sourceDetailContent");
        if (!content) return;
        content.innerHTML =
            '<p><strong>Question ID:</strong> ' + escapeHTML(draftQuestionId(question) || "—") + '</p>' +
            '<p><strong>Original question number:</strong> ' + escapeHTML(question.original_question_number || bank?.original_question_number || "-") + '</p>' +
            '<p><strong>Source PDF:</strong> ' + escapeHTML(question.source_pdf || bank?.source_pdf || "-") + '</p>' +
            '<p><strong>Page(s):</strong> ' + escapeHTML(Array.isArray(sourcePages) ? sourcePages.join(", ") || "-" : String(sourcePages || "-")) + '</p>' +
            '<p><strong>Section:</strong> ' + escapeHTML(question.section_name || bank?.section_name || "-") + '</p>' +
            '<p><strong>Source path:</strong> ' + escapeHTML(bank?.source_path || "-") + '</p>' +
            '<p><strong>Assets:</strong> ' + escapeHTML(assets.length ? JSON.stringify(assets) : "-") + '</p>' +
            '<p><strong>Tables:</strong> ' + escapeHTML(tables.length ? tables.length + " table(s)" : "-") + '</p>';
        lastModalTrigger = document.activeElement;
        closeAllModals();
        const modal = document.getElementById("sourceDetailModal");
        if (modal) modal.classList.remove("hidden");
        syncBodyScroll();
    }

    async function openFigurePreview(si, qi) {
        if (!generatedDraft) return;
        const question = generatedDraft.sections[si]?.questions[qi];
        if (!question) return;
        const bank = question.bank || bankQuestionById(draftQuestionId(question));
        const content = document.getElementById("figurePreviewContent");
        if (!content) return;
        const resources = bank?.resources || {};
        const figures = Array.isArray(resources.figures) ? resources.figures : [];
        const tables = Array.isArray(resources.tables) ? resources.tables : [];
        const sourceLine = figureSourceInfo(bank, question);
        content.innerHTML = "<p>Loading question resources…</p>" + sourceLine;
        lastModalTrigger = document.activeElement;
        closeAllModals();
        const modal = document.getElementById("figurePreviewModal");
        if (modal) modal.classList.remove("hidden");
        syncBodyScroll();
        if (!figures.length && !tables.length) { content.innerHTML = "<p>No retrievable figures or tables are available.</p>" + sourceLine; return; }
        try {
            const subject = bank.subject_id || generatedDraft.subject;
            const fetched = await Promise.all([...figures.map(resource => ["figure", resource]), ...tables.map(resource => ["table", resource])].map(async ([type, resource]) => {
                const id = resource.resource_id || resource.id;
                const query = new URLSearchParams({ subject_id: subject });
                const result = await api("/api/question-bank/" + encodeURIComponent(draftQuestionId(question)) + "/resources/" + type + "/" + encodeURIComponent(id) + "?" + query);
                return { type, result };
            }));
            const markup = fetched.map(({ type, result }) => {
                if (type === "figure" && result.content_base64) return '<img src="data:' + escapeHTML(result.metadata?.content_type || result.metadata?.mime_type || "image/png") + ';base64,' + result.content_base64 + '" alt="Question figure" style="max-width:100%;height:auto">';
                if (type === "table" && result.content) return '<table class="data-table"><thead><tr>' + (result.content.headers || []).map(h => '<th>' + escapeHTML(h) + '</th>').join("") + '</tr></thead><tbody>' + (result.content.rows || []).map(row => '<tr>' + row.map(cell => '<td>' + escapeHTML(cell) + '</td>').join("") + '</tr>').join("") + '</tbody></table>';
                return "";
            }).filter(Boolean).join("");
            content.innerHTML = (markup || "<p>No resource content was returned.</p>") + sourceLine;
        } catch (error) { content.innerHTML = '<p class="error">Could not load resources: ' + escapeHTML(error.message) + '</p>'; }
    }

    async function exportDraftDocx() {
        if (!generatedDraft || !validateDraft()) {
            showToast("Fix validation before export.");
            return;
        }
        const button = document.getElementById("exportDocxButton");
        if (button) {
            button.disabled = true;
            button.textContent = "Exporting...";
        }
        try {
            await downloadFile("/api/question-papers/drafts/" + encodeURIComponent(generatedDraft.draft_id) + "/docx", (generatedDraft.title || "question-paper") + ".docx", { method: "POST", body: {} });
            showToast("DOCX downloaded.");
        } catch (error) {
            showToast(error.message || "DOCX download failed.");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Download DOCX";
            }
            validateDraft();
        }
    }


    const draftTableBody = document.getElementById("draftReviewTableBody");
    if (draftTableBody) {
        draftTableBody.addEventListener("click", function (event) {
            const up = event.target.closest(".draft-up");
            const down = event.target.closest(".draft-down");
            const remove = event.target.closest(".draft-remove");
            const source = event.target.closest(".draft-source");
            const figure = event.target.closest(".draft-figure");
            const regenerate = event.target.closest(".draft-regenerate");
            if (regenerate) {
                regenerateDraftQuestion(Number(regenerate.getAttribute("data-si")), Number(regenerate.getAttribute("data-qi")));
                return;
            }
            if (up) {
                moveDraftQuestion(Number(up.getAttribute("data-si")), Number(up.getAttribute("data-qi")), -1);
                return;
            }
            if (down) {
                moveDraftQuestion(Number(down.getAttribute("data-si")), Number(down.getAttribute("data-qi")), 1);
                return;
            }
            if (remove) {
                removeDraftQuestion(Number(remove.getAttribute("data-si")), Number(remove.getAttribute("data-qi")));
                return;
            }
            if (source) {
                openSourceDetail(Number(source.getAttribute("data-si")), Number(source.getAttribute("data-qi")));
                return;
            }
            if (figure) {
                openFigurePreview(Number(figure.getAttribute("data-si")), Number(figure.getAttribute("data-qi")));
            }
        });
    }

    const addDraftQuestionButton = document.getElementById("addDraftQuestionButton");
    if (addDraftQuestionButton) addDraftQuestionButton.addEventListener("click", openAddQuestionModal);
    const closeAddQuestionModalButton = document.getElementById("closeAddQuestionModal");
    if (closeAddQuestionModalButton) closeAddQuestionModalButton.addEventListener("click", closeAddQuestionModal);
    const addQuestionSearch = document.getElementById("addQuestionSearch");
    if (addQuestionSearch) addQuestionSearch.addEventListener("input", renderAddQuestionList);
    const addQuestionTableBody = document.getElementById("addQuestionTableBody");
    if (addQuestionTableBody) {
        addQuestionTableBody.addEventListener("click", function (event) {
            const button = event.target.closest(".add-bank-question");
            if (!button) return;
            addBankQuestionToDraft(button.getAttribute("data-id"));
            renderAddQuestionList();
        });
    }
    const closeSourceDetailModal = document.getElementById("closeSourceDetailModal");
    if (closeSourceDetailModal) closeSourceDetailModal.addEventListener("click", function () {
        document.getElementById("sourceDetailModal")?.classList.add("hidden");
        syncBodyScroll();
        if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
    });
    const closeFigurePreviewModal = document.getElementById("closeFigurePreviewModal");
    if (closeFigurePreviewModal) closeFigurePreviewModal.addEventListener("click", function () {
        document.getElementById("figurePreviewModal")?.classList.add("hidden");
        syncBodyScroll();
        if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
    });

    if (generatePaperForm) {
        ["paperTitle", "totalMarks", "duration"].forEach(function (id) {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener("input", updateGenerationSummary);
                input.addEventListener("change", updateGenerationSummary);
                if (id === "totalMarks") {
                    input.addEventListener("input", validateSections);
                    input.addEventListener("change", validateSections);
                }
            }
        });

        const paperSubject = document.getElementById("paperSubject");
        if (paperSubject) {
            paperSubject.addEventListener("change", function () {
                clearFieldErrors();
                updateGenerationSummary();
                loadSubjectMarks(paperSubject.value);
                loadQuestionBank(paperSubject.value);
            });
            fillSubjectSelect(paperSubject, '<option value="">Select subject</option>');
        }
        ["paperTitle", "examType", "totalMarks", "duration"].forEach(function (id) {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener("input", function () {
                    const error = document.getElementById(id + "Error");
                    if (error) error.textContent = "";
                });
            }
        });

        generatePaperForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            clearFieldErrors();
            const title = document.getElementById("paperTitle")?.value.trim();
            const subject = document.getElementById("paperSubject")?.value;
            const examType = document.getElementById("examType")?.value.trim();
            const totalMarks = Number(document.getElementById("totalMarks")?.value);
            const duration = document.getElementById("duration")?.value.trim();

            let hasFieldError = false;
            if (!title) {
                setFieldError("paperTitle", "Paper title is required.");
                hasFieldError = true;
            }
            if (!subject) {
                setFieldError("paperSubject", "Subject is required.");
                hasFieldError = true;
            }
            if (!examType) {
                setFieldError("examType", "Exam type is required.");
                hasFieldError = true;
            }
            if (!Number.isInteger(totalMarks) || totalMarks < 1) {
                setFieldError("totalMarks", "Total marks must be a whole number greater than zero.");
                hasFieldError = true;
            }
            if (!duration) {
                setFieldError("duration", "Duration is required, for example 3 Hours.");
                hasFieldError = true;
            }
            if (hasFieldError) {
                showToast("Please complete the required fields.");
                return;
            }

            readSectionsFromTable();
            if (!validateSections()) {
                showToast("Section totals must equal total marks.");
                return;
            }

            // Ensure requested marks are supported by the subject's question bank.
            const unsupported = sections.find(function (section) {
                return availableMarks.length && !availableMarks.includes(Number(section.marks));
            });
            if (unsupported) {
                showToast("Section marks must match available question marks for the selected subject.");
                return;
            }
            if (availableMarks.length === 0) {
                showToast("No parsed questions with marks are available for this subject.");
                return;
            }

            const submitButton = generatePaperForm.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = "Generating...";
            }

            try {
                await ensureBlueprintForGeneration(title, examType, subject);
            } catch (error) {
                showToast("Could not save the section structure: " + error.message);
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = "✦ Generate Question Paper";
                }
                return;
            }

            try {
                // A stable seed keeps the editable draft and the permanently
                // recorded paper (history) in sync: both use the same random
                // selection so history reflects what the generator chose.
                const generationSeed = Math.floor(Math.random() * 2147483647);
                const requestBody = {
                    title: title,
                    subject: subject,
                    exam_type: examType,
                    total_marks: totalMarks,
                    duration: duration,
                    blueprint_id: currentBlueprintId,
                    seed: generationSeed,
                    university_name: document.getElementById("paperUniversity")?.value.trim() || null,
                    college_name: document.getElementById("paperCollege")?.value.trim() || null,
                    department_name: document.getElementById("paperDepartment")?.value.trim() || null,
                    academic_year: document.getElementById("paperAcademicYear")?.value.trim() || null,
                    semester: document.getElementById("paperSemester")?.value.trim() || null,
                    subject_code: document.getElementById("paperSubjectCode")?.value.trim() || null,
                    examination_date: document.getElementById("paperExamDate")?.value || null
                };
                const paper = await api("/api/question-papers/drafts", {
                    method: "POST",
                    body: requestBody
                });
                if (!paper?.draft_id) throw new Error("Draft creation returned no draft_id.");
                const canonicalDraft = await api("/api/question-papers/drafts/" + encodeURIComponent(paper.draft_id));

                // Every successful paper generation is recorded permanently in
                // Question Papers history automatically (no separate save step).
                // The draft review workflow above is preserved unchanged.
                try {
                    await api("/api/question-papers/generate", {
                        method: "POST",
                        body: requestBody
                    });
                } catch (historyError) {
                    showToast("Paper generated, but the history record could not be saved: " + historyError.message);
                }

                const accuracyNotice = document.getElementById("processingAccuracyNotice");
                if (accuracyNotice) {
                    // The accuracy notice is mandatory and owned by the backend;
                    // only server-provided text is shown, never client-side.
                    accuracyNotice.textContent = paper.processing_accuracy_notice || "";
                }

                await loadQuestionBank(subject);
                generatedDraft = {
                    draft_id: canonicalDraft.draft_id,
                    title: canonicalDraft.title || title,
                    subject: canonicalDraft.subject || subject,
                    exam_type: canonicalDraft.exam_type || examType,
                    duration: canonicalDraft.duration || duration,
                    total_marks: canonicalDraft.total_marks,
                    shortages: canonicalDraft.shortages || paper.shortages || [],
                    sections: (canonicalDraft.sections || []).map(function (section) {
                        return {
                            name: section.name,
                            questions: (section.questions || []).map(function (question) {
                                return {
                                    question_id: question.bank_question_id || question.question_id,
                                    bank_question_id: question.bank_question_id || question.question_id,
                                    number: question.number,
                                    text: question.text || question.cleaned_text || question.original_text || "",
                                    marks: question.marks == null ? null : Number(question.marks),
                                    original_question_number: question.original_question_number,
                                    source_pdf: question.source_pdf,
                                    source_pages: question.source_pages || [],
                                    page_number: question.page_number,
                                    section_name: question.section_name,
                                    priority: question.priority,
                                    bank: bankQuestionById(question.bank_question_id || question.question_id)
                                };
                            })
                        };
                    })
                };
                if (!generatedDraft.draft_id) throw new Error("The backend created no draft identifier; draft editing and export are unavailable.");
                if (generatedDraft.total_marks == null || !Number.isFinite(Number(generatedDraft.total_marks))) throw new Error("The backend draft has no total_marks value.");

                const previewTitle = document.getElementById("previewTitle");
                const previewExamType = document.getElementById("previewExamType");
                const previewSubject = document.getElementById("previewSubject");
                const previewDuration = document.getElementById("previewDuration");
                const previewMarks = document.getElementById("previewMarks");
                if (previewTitle) previewTitle.textContent = title || "Question Paper";
                if (previewExamType) previewExamType.textContent = examType || "Examination";
                if (previewSubject) previewSubject.textContent = subject;
                if (previewDuration) previewDuration.textContent = "Duration: " + duration;
                if (previewMarks) previewMarks.textContent = "Maximum Marks: " + generatedDraft.total_marks;

                const result = document.getElementById("generationResult");
                if (result) {
                    result.classList.remove("hidden");
                    result.scrollIntoView({ behavior: "smooth", block: "start" });
                }

                renderDraftReview();
                const exportButton = document.getElementById("exportDocxButton");
                if (exportButton) {
                    exportButton.onclick = async function () {
                        await exportDraftDocx();
                    };
                }
                showToast("Draft generated. Review it before exporting.");
                if (typeof fetchPapers === "function") {
                    fetchPapers().catch(function () {});
                }
            } catch (error) {
                showToast(error.message || "Generation failed.");
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = "✦ Generate Question Paper";
                }
            }
        });

        const blueprintSelectEl = document.getElementById("blueprintSelect");
        if (blueprintSelectEl) {
            blueprintSelectEl.addEventListener("change", async function () {
                const selected = blueprints.find(function (b) { return String(blueprintIdOf(b)) === String(blueprintSelectEl.value); });
                if (selected) {
                    applyBlueprint(selected);
                    setBlueprintStatus('Loaded "' + (selected.name || "blueprint") + '".', false);
                } else {
                    currentBlueprintId = null;
                }
            });
        }
        document.getElementById("newBlueprintButton")?.addEventListener("click", newBlueprint);
        document.getElementById("duplicateBlueprintButton")?.addEventListener("click", duplicateBlueprint);
        document.getElementById("renameBlueprintButton")?.addEventListener("click", renameBlueprint);
        document.getElementById("deleteBlueprintButton")?.addEventListener("click", deleteBlueprint);
        document.getElementById("saveBlueprintButton")?.addEventListener("click", saveBlueprint);

        updateGenerationSummary();
    }

    /* ============================================================
       SAVED BASIC CONFIGURATIONS — S31, backend-backed
       ({"configuration_id", name, is_default, values{...}} per the
       documented contract; no localStorage, no fabricated data.)
       ============================================================ */
    const CONFIG_INPUT_IDS = {
        university: "paperUniversity",
        college: "paperCollege",
        department: "paperDepartment",
        paper_title: "paperTitle",
        academic_year: "paperAcademicYear",
        semester: "paperSemester",
        exam_type: "examType",
        subject: "paperSubject",
        subject_code: "paperSubjectCode",
        exam_date: "paperExamDate",
        duration: "duration",
        total_marks: "totalMarks",
        instructions: "paperInstructions"
    };

    let savedConfigs = [];
    let currentConfigId = null;
    let configValuesBaseline = null;

    function sanitizeSavedConfig(config) {
        const values = (config && typeof config.values === "object" && config.values) || {};
        const cleaned = {};
        Object.keys(CONFIG_INPUT_IDS).forEach(function (key) {
            cleaned[key] = values[key] == null ? "" : String(values[key]);
        });
        return {
            config_id: String(config?.config_id || config?.configuration_id || ""),
            name: String(config?.name || "Configuration"),
            is_default: Boolean(config?.is_default),
            values: cleaned
        };
    }

    function selectedConfig() {
        return savedConfigs.find(function (config) { return config.config_id === currentConfigId; }) || null;
    }

    function collectedConfigValues() {
        const values = {};
        Object.keys(CONFIG_INPUT_IDS).forEach(function (key) {
            values[key] = String(document.getElementById(CONFIG_INPUT_IDS[key])?.value ?? "");
        });
        return values;
    }

    function applyConfigValues(values) {
        const previousSubject = document.getElementById("paperSubject")?.value || "";
        Object.keys(CONFIG_INPUT_IDS).forEach(function (key) {
            const input = document.getElementById(CONFIG_INPUT_IDS[key]);
            if (!input) return;
            const value = String(values[key] ?? "");
            if (key === "subject" && input.tagName === "SELECT") {
                const match = Array.from(input.options || []).some(function (option) { return option.value === value; });
                input.value = match ? value : "";
            } else {
                input.value = value;
            }
        });
        const subject = document.getElementById("paperSubject")?.value || "";
        if (subject && subject !== previousSubject) {
            loadSubjectMarks(subject);
            loadQuestionBank(subject);
        }
        validateSections();
        updateGenerationSummary();
    }

    function isConfigDirty() {
        return configValuesBaseline !== null &&
            JSON.stringify(collectedConfigValues()) !== configValuesBaseline;
    }

    function setConfigStatus(message, isError) {
        const status = document.getElementById("configStatus");
        if (!status) return;
        status.textContent = message || "";
        status.style.color = isError ? "#dc2626" : "#16a34a";
    }

    function renderConfigSelect() {
        const select = document.getElementById("configSelect");
        if (!select) return;
        const ordered = savedConfigs.slice().sort(function (a, b) {
            return (b.is_default === true) - (a.is_default === true);
        });
        select.innerHTML = ordered.length
            ? ordered.map(function (config) {
                return '<option value="' + escapeHTML(config.config_id) + '">' +
                    (config.is_default ? "★ " : "") + escapeHTML(config.name) +
                    "</option>";
            }).join("")
            : '<option value="">No saved configurations yet</option>';
        select.value = currentConfigId && savedConfigs.some(function (config) {
            return config.config_id === currentConfigId;
        }) ? currentConfigId : "";
    }

    async function loadSavedConfigs() {
        const select = document.getElementById("configSelect");
        if (!select) return;
        setConfigStatus("Loading saved configurations…", false);
        try {
            const data = await api("/api/ui-configurations");
            savedConfigs = ((data && Array.isArray(data.items) ? data.items : Array.isArray(data?.configurations) ? data.configurations : []) || [])
                .map(sanitizeSavedConfig).filter(function (config) { return config.config_id; });
            if (!savedConfigs.some(function (config) { return config.is_default; }) && savedConfigs[0]) {
                savedConfigs[0].is_default = true;
            }
            renderConfigSelect();
            applyStartupConfig();
        } catch (error) {
            savedConfigs = [];
            currentConfigId = null;
            renderConfigSelect();
            setConfigStatus("Could not load saved configurations: " + error.message, true);
        }
    }

    function applyStartupConfig() {
        const config = savedConfigs.find(function (item) { return item.is_default; }) || savedConfigs[0];
        const nameInput = document.getElementById("configName");
        if (config) {
            currentConfigId = config.config_id;
            renderConfigSelect();
            if (nameInput) nameInput.value = config.name;
            applyConfigValues(config.values);
            configValuesBaseline = JSON.stringify(collectedConfigValues());
            setConfigStatus('Loaded "' + config.name + '"' + (config.is_default ? " (default)" : "") + ".", false);
        } else {
            currentConfigId = null;
            renderConfigSelect();
            configValuesBaseline = JSON.stringify(collectedConfigValues());
            if (nameInput) nameInput.value = "";
            setConfigStatus("No saved configurations yet — the details on screen are ready to Save.", false);
        }
    }

    async function saveConfiguration() {
        const nameInput = document.getElementById("configName");
        const name = nameInput ? nameInput.value.trim() : "";
        if (!name) {
            setConfigStatus("Configuration name is required.", true);
            if (nameInput) nameInput.focus();
            return;
        }
        const button = document.getElementById("saveConfigButton");
        if (button) setButtonLoading(button, true, "Saving…");
        const values = collectedConfigValues();
        try {
            let saved;
            if (currentConfigId) {
                saved = await api("/api/ui-configurations/" + encodeURIComponent(currentConfigId), {
                    method: "PATCH",
                    body: { name: name, values: values }
                });
            } else {
                saved = await api("/api/ui-configurations", {
                    method: "POST",
                    body: { name: name, values: values, is_default: savedConfigs.length === 0 }
                });
            }
            const savedConfig = sanitizeSavedConfig(saved);
            if (!savedConfig.config_id) throw new Error("The backend returned no configuration_id.");
            const existingIndex = savedConfigs.findIndex(function (c) { return c.config_id === savedConfig.config_id; });
            if (existingIndex >= 0) savedConfigs[existingIndex] = savedConfig;
            else savedConfigs.push(savedConfig);
            if (!savedConfigs.some(function (c) { return c.is_default; }) && savedConfigs.length === 1) {
                savedConfigs[0].is_default = true;
            }
            currentConfigId = savedConfig.config_id;
            configValuesBaseline = JSON.stringify(values);
            renderConfigSelect();
            setConfigStatus('Configuration "' + name + '" saved.', false);
        } catch (error) {
            setConfigStatus("Save failed: " + error.message, true);
        } finally {
            if (button) setButtonLoading(button, false);
        }
    }

    function newConfiguration() {
        if (isConfigDirty() &&
            !window.confirm("You have unsaved configuration changes. Discard them and start a new configuration?")) {
            return;
        }
        currentConfigId = null;
        const nameInput = document.getElementById("configName");
        if (nameInput) nameInput.value = "";
        renderConfigSelect();
        configValuesBaseline = JSON.stringify(collectedConfigValues());
        setConfigStatus("New configuration. The current details stay on screen; edit and Save.", false);
    }

    async function duplicateConfiguration() {
        const source = selectedConfig();
        if (source && isConfigDirty() &&
            !window.confirm("Duplicating overwrites the unsaved changes on screen with the saved values. Continue?")) {
            return;
        }
        const suggestedName = source ? source.name + " copy" : "Configuration copy";
        const proposed = window.prompt("Duplicate configuration as", suggestedName);
        if (proposed === null) return;
        const name = proposed.trim() || suggestedName;
        const button = document.getElementById("duplicateConfigButton");
        if (button) setButtonLoading(button, true, "Duplicating…");
        try {
            const sourceValues = source
                ? source.values
                : collectedConfigValues();
            const saved = await api("/api/ui-configurations", {
                method: "POST",
                body: { name: name, values: sourceValues, is_default: false }
            });
            const savedConfig = sanitizeSavedConfig(saved);
            if (!savedConfig.config_id) throw new Error("The backend returned no configuration_id.");
            savedConfigs.push(savedConfig);
            currentConfigId = savedConfig.config_id;
            renderConfigSelect();
            const nameInput = document.getElementById("configName");
            if (nameInput) nameInput.value = name;
            applyConfigValues(savedConfig.values);
            configValuesBaseline = JSON.stringify(collectedConfigValues());
            setConfigStatus('Duplicated as "' + name + '".', false);
        } catch (error) {
            setConfigStatus("Duplicate failed: " + error.message, true);
        } finally {
            if (button) setButtonLoading(button, false);
        }
    }

    async function renameConfiguration() {
        const source = selectedConfig();
        if (!source) {
            setConfigStatus("Save the configuration first, then rename it.", true);
            return;
        }
        const proposed = window.prompt("Rename configuration", source.name);
        if (proposed === null) return;
        const name = proposed.trim();
        if (!name) {
            setConfigStatus("Configuration name cannot be empty.", true);
            return;
        }
        try {
            const updated = await api("/api/ui-configurations/" + encodeURIComponent(source.config_id), {
                method: "PATCH",
                body: { name: name }
            });
            const updatedConfig = sanitizeSavedConfig(updated);
            const existingIndex = savedConfigs.findIndex(function (c) { return c.config_id === source.config_id; });
            if (existingIndex >= 0) savedConfigs[existingIndex] = updatedConfig;
            source.name = updatedConfig.name;
            renderConfigSelect();
            const nameInput = document.getElementById("configName");
            if (nameInput) nameInput.value = updatedConfig.name;
            setConfigStatus('Renamed to "' + updatedConfig.name + '".', false);
        } catch (error) {
            setConfigStatus("Rename failed: " + error.message, true);
        }
    }

    async function setDefaultConfiguration() {
        const source = selectedConfig();
        if (!source) {
            setConfigStatus("Select a configuration to make it the default.", true);
            return;
        }
        try {
            const updated = await api("/api/ui-configurations/" + encodeURIComponent(source.config_id), {
                method: "PATCH",
                body: { is_default: true }
            });
            const updatedConfig = sanitizeSavedConfig(updated);
            const existingIndex = savedConfigs.findIndex(function (c) { return c.config_id === source.config_id; });
            if (existingIndex >= 0) savedConfigs[existingIndex] = updatedConfig;
            savedConfigs.forEach(function (config) {
                if (config.config_id !== source.config_id) config.is_default = false;
            });
            renderConfigSelect();
            setConfigStatus('"' + updatedConfig.name + '" is now the default configuration.', false);
        } catch (error) {
            setConfigStatus("Could not set default: " + error.message, true);
        }
    }

    async function deleteConfiguration() {
        const source = selectedConfig();
        if (!source) {
            setConfigStatus("Select a configuration to delete.", true);
            return;
        }
        if (!window.confirm('Delete "' + source.name + '"? The form returns to another saved configuration.')) return;
        try {
            await api("/api/ui-configurations/" + encodeURIComponent(source.config_id), { method: "DELETE" });
            savedConfigs = savedConfigs.filter(function (config) { return config.config_id !== source.config_id; });
            currentConfigId = null;
            renderConfigSelect();
            applyStartupConfig();
            const fallback = savedConfigs.find(function (config) { return config.is_default; }) || savedConfigs[0];
            setConfigStatus("Configuration deleted." + (fallback ? ' Loaded "' + fallback.name + '".' : ""), false);
        } catch (error) {
            setConfigStatus("Delete failed: " + error.message, true);
        }
    }

    function chooseConfig(configId) {
        if (configId === currentConfigId) return;
        if (isConfigDirty() &&
            !window.confirm("You have unsaved configuration changes. Discard them and switch?")) {
            renderConfigSelect();
            return;
        }
        const config = savedConfigs.find(function (item) { return item.config_id === configId; });
        if (!config) { renderConfigSelect(); return; }
        currentConfigId = config.config_id;
        renderConfigSelect();
        const nameInput = document.getElementById("configName");
        if (nameInput) nameInput.value = config.name;
        applyConfigValues(config.values);
        configValuesBaseline = JSON.stringify(collectedConfigValues());
        setConfigStatus('Loaded "' + config.name + '".', false);
    }

    if (document.getElementById("configSelect")) {
        Object.values(CONFIG_INPUT_IDS).forEach(function (id) {
            const input = document.getElementById(id);
            if (!input) return;
            ["input", "change"].forEach(function (type) {
                input.addEventListener(type, function () {
                    if (isConfigDirty()) setConfigStatus("Unsaved changes — use Save to keep them.", true);
                });
            });
        });

        document.getElementById("configSelect")?.addEventListener("change", function (event) {
            chooseConfig(event.target.value);
        });
        document.getElementById("newConfigButton")?.addEventListener("click", newConfiguration);
        document.getElementById("saveConfigButton")?.addEventListener("click", saveConfiguration);
        document.getElementById("duplicateConfigButton")?.addEventListener("click", duplicateConfiguration);
        document.getElementById("renameConfigButton")?.addEventListener("click", renameConfiguration);
        document.getElementById("setDefaultConfigButton")?.addEventListener("click", setDefaultConfiguration);
        document.getElementById("deleteConfigButton")?.addEventListener("click", deleteConfiguration);
    }

    document.getElementById("saveGeneratedPaper")?.classList.add("hidden");
    const downloadGeneratedPaper = document.getElementById("downloadGeneratedPaper");
    if (downloadGeneratedPaper) {
        downloadGeneratedPaper.addEventListener("click", function () {
            if (!generatedDraft?.draft_id) {
                showToast("Generate a paper first.");
                return;
            }
            exportDraftDocx();
        });
    }

    const reviewGeneratedPaper = document.getElementById("reviewGeneratedPaper");
    if (reviewGeneratedPaper) {
        reviewGeneratedPaper.addEventListener("click", function () {
            generationResult?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }

    /* ============================================================
       SHARED QUESTION EDITOR (Question Bank + Generate Paper)
       ============================================================ */

    let questionEditorState = {
        mode: "create",
        initial: null,
        subject: null,
        onSave: null,
        figureContext: null
    };

    function fillQuestionEditorSubjects() {
        const select = document.getElementById("qeSubject");
        if (!select) return;
        const current = select.value;
        select.innerHTML = '<option value="">Select subject</option>' +
            subjectsCache.map(function (subject) {
                return '<option value="' + escapeHTML(subject) + '">' + escapeHTML(subject) + '</option>';
            }).join("");
        if (subjectsCache.includes(current)) select.value = current;
    }

    function setQuestionEditorFieldError(id, message) {
        const el = document.getElementById(id + "Error");
        if (el) el.textContent = message || "";
    }

    function openQuestionEditor(options) {
        options = options || {};
        questionEditorState.mode = options.mode || "create";
        questionEditorState.initial = options.initial || null;
        questionEditorState.subject = options.subject || null;
        questionEditorState.onSave = typeof options.onSave === "function" ? options.onSave : null;
        questionEditorState.onRemove = typeof options.onRemove === "function" ? options.onRemove : null;
        questionEditorState.figureContext = options.figureContext || null;

        const modal = document.getElementById("questionEditorModal");
        const title = document.getElementById("questionEditorTitle");
        const subtitle = document.getElementById("questionEditorSubtitle");
        const subjectSelect = document.getElementById("qeSubject");
        const message = document.getElementById("questionEditorMessage");
        const editorGrid = document.querySelector("#questionEditorForm .question-editor-grid");
        if (editorGrid) {
            if (!questionEditorState.createMarkup) questionEditorState.createMarkup = editorGrid.innerHTML;
            if (questionEditorState.mode === "edit") {
                editorGrid.innerHTML = '<div class="form-group form-group-full"><label for="qeText">Question text</label><textarea id="qeText" rows="4" required maxlength="2000" placeholder="Enter question text"></textarea><span class="field-error" id="qeTextError"></span></div>' +
                    '<div class="form-group"><label for="qeMarks">Marks</label><input type="number" id="qeMarks" min="1" max="100" required><span class="field-error" id="qeMarksError"></span></div>' +
                    '<div class="form-group"><label for="qePriority">Priority</label><select id="qePriority"><option value="1">1 — Regular</option><option value="2">2 — Higher priority</option><option value="3">3 — Must come</option></select></div>';
                editorGrid.classList.add("question-editor-edit-grid");
            } else {
                editorGrid.innerHTML = questionEditorState.createMarkup;
                editorGrid.classList.remove("question-editor-edit-grid");
            }
        }

        if (message) { message.textContent = ""; message.classList.remove("success", "error"); }
        setQuestionEditorFieldError("qeText", "");
        setQuestionEditorFieldError("qeSubject", "");
        setQuestionEditorFieldError("qeMarks", "");

        fillQuestionEditorSubjects();

        const initial = questionEditorState.initial || {};
        const textEl = document.getElementById("qeText");
        const marksEl = document.getElementById("qeMarks");
        const sectionEl = document.getElementById("qeSection");
        const draftSectionEl = document.getElementById("qeDraftSection");
        const numberEl = document.getElementById("qeQuestionNumber");
        const sourcePdfEl = document.getElementById("qeSourcePdf");
        const sourcePagesEl = document.getElementById("qeSourcePages");
        const priorityEl = document.getElementById("qePriority");
        const figureSummary = document.getElementById("qeFigureSummary");

        const text = initial.cleaned_text || initial.original_text || initial.text || initial.question_text || "";
        if (textEl) textEl.value = text;
        if (marksEl) marksEl.value = (initial.marks != null) ? initial.marks : "";
        if (sectionEl) sectionEl.value = initial.section_name || initial.section || "";
        if (draftSectionEl) {
            if (questionEditorState.mode === "draft" && typeof generatedDraft !== "undefined" && generatedDraft && Array.isArray(generatedDraft.sections)) {
                const names = generatedDraft.sections.map(function (s) { return s.name; });
                const current = initial.section_name || initial.section || (initial.sectionName) || "";
                // determine current section by locating question in generatedDraft
                let currentSectionName = current;
                if (!currentSectionName && generatedDraft) {
                    generatedDraft.sections.forEach(function (sec) {
                        if (sec.questions.indexOf(initial) !== -1) currentSectionName = sec.name;
                    });
                }
                draftSectionEl.innerHTML = names.map(function (n) {
                    return '<option value="' + escapeHTML(n) + '"' + (n === currentSectionName ? " selected" : "") + '>' + escapeHTML(n) + '</option>';
                }).join("");
                draftSectionEl.style.display = "";
                if (sectionEl) sectionEl.style.display = "none";
            } else {
                draftSectionEl.style.display = "none";
                if (sectionEl) sectionEl.style.display = "";
            }
        }
        if (numberEl) numberEl.value = initial.original_question_number || initial.question_number || initial.number || "";
        if (sourcePdfEl) sourcePdfEl.value = initial.source_pdf || initial.source || "";
        const pages = initial.source_pages || [];
        if (sourcePagesEl) sourcePagesEl.value = Array.isArray(pages) ? pages.join(", ") : (pages || "");
        if (priorityEl) priorityEl.value = String(initial.priority || 1);

        const subjectValue = questionEditorState.subject || initial.subject_id || initial.subject || "";
        if (subjectSelect) {
            if (questionEditorState.mode === "edit" || questionEditorState.mode === "draft") {
                subjectSelect.value = subjectValue;
                subjectSelect.disabled = true;
            } else {
                subjectSelect.disabled = false;
                if (subjectValue) subjectSelect.value = subjectValue;
            }
        }

        const editorResources = questionEditorState.figureContext?.resources || {};
        const hasFigure = (Array.isArray(editorResources.figures) && editorResources.figures.length) || (Array.isArray(editorResources.tables) && editorResources.tables.length);
        const previewButton = document.getElementById("qeFigurePreview");
        if (previewButton) previewButton.classList.toggle("hidden", !hasFigure);
        if (figureSummary) figureSummary.textContent = hasFigure ? "Figure available." : "No figure.";

        if (title) title.textContent = questionEditorState.mode === "create" ? "Add Question" : "Edit Question";
        if (subtitle) subtitle.textContent = questionEditorState.mode === "create"
            ? "Create a new question." : (questionEditorState.mode === "edit"
                ? "Update question text, marks and priority." : "Edit question details.");

        const removeQuestionButton = document.getElementById("questionEditorRemove");
        if (removeQuestionButton) removeQuestionButton.hidden = !(questionEditorState.mode === "edit" && questionEditorState.onRemove);

        if (modal && typeof modal.showModal === "function") {
            lastModalTrigger = document.activeElement;
            modal.showModal();
        } else if (modal) {
            modal.classList.remove("hidden");
        }
        syncBodyScroll();
        const focusable = modal ? modal.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") : null;
        if (focusable) focusable.focus();
    }

    function closeQuestionEditor() {
        const modal = document.getElementById("questionEditorModal");
        if (modal && typeof modal.close === "function") modal.close();
        else if (modal) modal.classList.add("hidden");
        syncBodyScroll();
        if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
    }

    function questionEditorPayload() {
        const textEl = document.getElementById("qeText");
        const marksEl = document.getElementById("qeMarks");
        const priorityEl = document.getElementById("qePriority");

        const text = textEl ? textEl.value.trim() : "";
        const marks = marksEl ? Number(marksEl.value) : NaN;
        const errors = {};

        setQuestionEditorFieldError("qeText", "");
        setQuestionEditorFieldError("qeMarks", "");

        if (!text || text.length > 2000) {
            errors.text = "Question text is required (1-2000 chars).";
            setQuestionEditorFieldError("qeText", errors.text);
        }
        if (!Number.isFinite(marks) || marks < 1 || marks > 100) {
            errors.marks = "Marks must be 1-100.";
            setQuestionEditorFieldError("qeMarks", errors.marks);
        }

        if (questionEditorState.mode === "edit") {
            const priority = priorityEl ? Number(priorityEl.value) : NaN;
            if (!Number.isInteger(priority) || priority < 1 || priority > 3) {
                errors.priority = "Choose a valid priority.";
            }
            if (Object.keys(errors).length) {
                return { ok: false, payload: null, errors: errors };
            }
            return {
                ok: true,
                payload: { cleaned_text: text, marks: marks, priority: priority },
                errors: {}
            };
        }

        const subjectEl = document.getElementById("qeSubject");
        const sectionEl = document.getElementById("qeSection");
        const draftSectionEl = document.getElementById("qeDraftSection");
        const numberEl = document.getElementById("qeQuestionNumber");
        const sourcePdfEl = document.getElementById("qeSourcePdf");
        const sourcePagesEl = document.getElementById("qeSourcePages");
        const subject = subjectEl ? subjectEl.value : "";
        if (!subject) {
            errors.subject = "Subject is required.";
            setQuestionEditorFieldError("qeSubject", errors.subject);
        }
        if (Object.keys(errors).length) {
            return { ok: false, payload: null, errors: errors };
        }

        const pages = (sourcePagesEl ? sourcePagesEl.value : "")
            .split(/[,\s]+/)
            .map(function (v) { return v.trim(); })
            .filter(Boolean)
            .map(function (v) { return Number(v); })
            .filter(function (v) { return Number.isFinite(v) && v >= 0; });

        const payload = {
            cleaned_text: text,
            text: text,
            marks: marks,
            section_name: (draftSectionEl && draftSectionEl.style.display !== "none")
                ? draftSectionEl.value
                : (sectionEl ? sectionEl.value.trim() : ""),
            original_question_number: numberEl ? numberEl.value.trim() : "",
            source_pdf: sourcePdfEl ? sourcePdfEl.value.trim() : "",
            source_pages: pages,
            page_number: pages.length ? pages[0] : null,
            priority: priorityEl ? Number(priorityEl.value) : 1
        };

        if (questionEditorState.mode === "create") {
            payload.subject_id = subject;
            payload.subject = subject;
        }

        return { ok: true, payload: payload, errors: {} };
    }

    async function saveQuestionEditor() {
        const result = questionEditorPayload();
        if (!result.ok) {
            showToast("Fix validation errors.");
            return;
        }

        const saveButton = document.getElementById("questionEditorSave");
        setButtonLoading(saveButton, true, "Saving…");

        const message = document.getElementById("questionEditorMessage");
        try {
            if (typeof questionEditorState.onSave === "function") {
                await questionEditorState.onSave(result.payload);
            }
            if (message) { message.textContent = "Saved."; message.classList.add("success"); }
            closeQuestionEditor();
        } catch (error) {
            if (message) { message.textContent = error.message || "Save failed."; message.classList.add("error"); }
            showToast(error.message || "Save failed.");
        } finally {
            setButtonLoading(saveButton, false);
        }
    }

    /* Question Bank Add/Edit wiring */

    async function createQuestionBankQuestion(payload) {
        const subject = payload.subject_id || payload.subject;
        const body = Object.assign({}, payload);
        delete body.subject;
        body.subject_id = subject;
        const created = await api("/api/question-bank", { method: "POST", body: body });
        showToast("Question added.");
        loadPyqQuestions(true).catch(function () {});
        return created;
    }

    async function updateQuestionBankQuestion(questionId, payload) {
        const body = {
            cleaned_text: payload.cleaned_text,
            marks: payload.marks,
            priority: payload.priority
        };
        const subject = document.getElementById("qbPyqSubject")?.value;
        const query = subject ? "?subject_id=" + encodeURIComponent(subject) : "";
        const updated = await api("/api/question-bank/" + encodeURIComponent(questionId) + query, { method: "PATCH", body: body });
        showToast("Question updated.");
        await loadPyqQuestions(true);
        return updated;
    }

    let questionDeleting = false;

    async function removeQuestionBankQuestion(questionId) {
        if (!questionId || questionDeleting) return;
        if (typeof questionEditorState.onRemove !== "function") return;

        const cached = findQuestionBankItem(questionId) || questionEditorState.initial || {};
        const previewText = questionText(cached).slice(0, 200) || questionId;
        const confirmed = await confirmAction(
            "Remove question",
            "This question will be permanently removed from the question bank.\n\n" + previewText,
            "Remove"
        );
        if (!confirmed || questionDeleting) return;

        const removeButton = document.getElementById("questionEditorRemove");
        const message = document.getElementById("questionEditorMessage");
        questionDeleting = true;
        setButtonLoading(removeButton, true, "Removing…");

        try {
            const deleteSubject = document.getElementById("qbPyqSubject")?.value;
            const deleteQuery = deleteSubject ? "?subject_id=" + encodeURIComponent(deleteSubject) : "";
            await api("/api/question-bank/" + encodeURIComponent(questionId) + deleteQuery, { method: "DELETE" });
            showToast("Question removed.");
            closeQuestionEditor();
            loadPyqQuestions(true).catch(function () {});
        } catch (error) {
            if (message) {
                message.textContent = error.message || "Remove failed.";
                message.classList.add("error");
            }
            showToast(error.message || "Remove failed.");
        } finally {
            questionDeleting = false;
            setButtonLoading(removeButton, false);
        }
    }

    const addQuestionBankButton = document.getElementById("addQuestionBankButton");
    if (addQuestionBankButton) {
        addQuestionBankButton.addEventListener("click", function () {
            const subjectSelect = document.getElementById("qbPyqSubject");
            const subject = subjectSelect ? subjectSelect.value : "";
            openQuestionEditor({
                mode: "create",
                subject: subject || null,
                figureContext: null,
                onSave: function (payload) { return createQuestionBankQuestion(payload); }
            });
        });
    }

    /* Row-level question cache for edit prepopulation */
    const questionBankRowCache = new Map();

    // Wrap loadPyqQuestions to cache rows by question_id. We patch after load by
    // observing the tbody; simpler: cache inside the existing render path is not
    // possible without editing it, so instead look up from pyqQuestionDetailCache.
    function findQuestionBankItem(questionId) {
        const cached = questionBankRowCache.get(questionId);
        if (cached) return cached;
        if (Array.isArray(pyqQuestionDetailCache)) {
            const found = pyqQuestionDetailCache.find(function (q) { return q.question_id === questionId; });
            if (found) { questionBankRowCache.set(questionId, found); return found; }
        }
        if (qbFlaggedCache.has(questionId)) {
            const flaggedItem = qbFlaggedCache.get(questionId);
            questionBankRowCache.set(questionId, flaggedItem);
            return flaggedItem;
        }
        return null;
    }

    const pyqQuestionsTableBodyEl = document.getElementById("pyqQuestionsTableBody");
    if (pyqQuestionsTableBodyEl) {
        pyqQuestionsTableBodyEl.addEventListener("click", async function (event) {
            const editButton = event.target.closest(".qb-edit-question");
            if (!editButton) return;
            const questionId = editButton.getAttribute("data-question-id");
            if (!questionId) return;
            let item = findQuestionBankItem(questionId);
            if (!item) {
                showToast("Question not found. Reload and try again.");
                return;
            }
            const subjectSelect = document.getElementById("qbPyqSubject");
            const subject = item.subject_id || item.subject || (subjectSelect ? subjectSelect.value : "");
            try {
                item = await api("/api/question-bank/" + encodeURIComponent(questionId) + "?subject_id=" + encodeURIComponent(subject));
                questionBankRowCache.set(questionId, item);
            } catch (error) {
                showToast("Could not load question details: " + error.message);
                return;
            }
            openQuestionEditor({
                mode: "edit",
                initial: item,
                subject: subject,
                figureContext: item,
                onSave: function (payload) { return updateQuestionBankQuestion(questionId, payload); },
                onRemove: function () { return removeQuestionBankQuestion(questionId); }
            });
        });
    }

    /* Figure preview from editor */
    const questionEditorForm = document.getElementById("questionEditorForm");
    if (questionEditorForm) {
        questionEditorForm.addEventListener("click", async function (event) {
            if (!event.target.closest("#qeFigurePreview")) return;
            const ctx = questionEditorState.figureContext;
            const resources = ctx?.resources || {};
            const figures = resources.figures || [];
            const tables = resources.tables || [];
            const content = document.getElementById("figurePreviewContent");
            if (!content) return;
            content.innerHTML = "<p>Loading question resources…</p>";
            lastModalTrigger = document.activeElement;
            closeAllModals();
            const modal = document.getElementById("figurePreviewModal");
            if (modal) modal.classList.remove("hidden");
            syncBodyScroll();
            try {
                const subject = ctx.subject_id || questionEditorState.subject;
                const fetched = await Promise.all([...figures.map(resource => ["figure", resource]), ...tables.map(resource => ["table", resource])].map(async ([type, resource]) => {
                    const params = new URLSearchParams({ subject_id: subject });
                    const id = resource.resource_id || resource.id;
                    const result = await api("/api/question-bank/" + encodeURIComponent(ctx.question_id) + "/resources/" + type + "/" + encodeURIComponent(id) + "?" + params);
                    return { type, result };
                }));
                content.innerHTML = fetched.map(({ type, result }) => {
                    if (type === "figure" && result.content_base64) return '<img src="data:' + escapeHTML(result.metadata?.content_type || result.metadata?.mime_type || "image/png") + ';base64,' + result.content_base64 + '" alt="Question figure" style="max-width:100%">';
                    if (type === "table" && result.content) return '<table class="data-table"><thead><tr>' + (result.content.headers || []).map(h => '<th>' + escapeHTML(h) + '</th>').join("") + '</tr></thead><tbody>' + (result.content.rows || []).map(row => '<tr>' + row.map(cell => '<td>' + escapeHTML(cell) + '</td>').join("") + '</tr>').join("") + '</tbody></table>';
                    return "";
                }).join("") || "<p>No resource content was returned.</p>";
            } catch (error) { content.innerHTML = '<p class="error">Could not load resources: ' + escapeHTML(error.message) + '</p>'; }
        });
    }

    /* Modal wiring */
    if (questionEditorForm) {
        questionEditorForm.addEventListener("submit", function (event) {
            event.preventDefault();
            saveQuestionEditor();
        });
    }
    const questionEditorClose = document.getElementById("questionEditorClose");
    if (questionEditorClose) questionEditorClose.addEventListener("click", closeQuestionEditor);
    const questionEditorCancel = document.getElementById("questionEditorCancel");
    if (questionEditorCancel) questionEditorCancel.addEventListener("click", closeQuestionEditor);

    const questionEditorRemove = document.getElementById("questionEditorRemove");
    if (questionEditorRemove) {
        questionEditorRemove.addEventListener("click", function () {
            removeQuestionBankQuestion(questionEditorState.initial?.question_id);
        });
    }

    const qeDialog = document.getElementById("questionEditorModal");
    if (qeDialog) {
        qeDialog.addEventListener("click", function (event) {
            if (event.target === qeDialog) closeQuestionEditor();
        });
    }

    /* Generate page: additive Edit action in draft review (opens same editor) */
    // Hook into existing draft table by delegated click on a new .draft-edit button.
    // The button is injected via a second observer on draftReviewTableBody.
    const draftTableBodyEl = document.getElementById("draftReviewTableBody");

    draftTableBodyEl && draftTableBodyEl.addEventListener("click", function (event) {
        const edit = event.target.closest(".draft-edit");
        if (!edit) return;
        const si = Number(edit.getAttribute("data-si"));
        const qi = Number(edit.getAttribute("data-qi"));
        if (!generatedDraft) return;
        const question = generatedDraft.sections[si]?.questions[qi];
        if (!question) return;
        openQuestionEditor({
            mode: "draft",
            initial: question,
            subject: question.subject || (document.getElementById("paperSubject") ? document.getElementById("paperSubject").value : null),
            figureContext: question.bank || null,
            onSave: async function (payload) {
                const updated = await api("/api/question-papers/drafts/" + encodeURIComponent(generatedDraft.draft_id) + "/questions/" + encodeURIComponent(draftQuestionId(question)), {
                    method: "PATCH",
                    body: { text: payload.cleaned_text || payload.text, marks: payload.marks, section: payload.section_name || question.section_name }
                });
                if (updated?.draft_id) {
                    generatedDraft = updated;
                    renderDraftReview();
                    showToast("Question updated in draft.");
                    return;
                }
                question.text = payload.cleaned_text || payload.text || question.text;
                if (Number.isFinite(payload.marks)) question.marks = payload.marks;
                question.section_name = payload.section_name || question.section_name;
                question.original_question_number = payload.original_question_number || question.original_question_number;
                question.source_pdf = payload.source_pdf || question.source_pdf;
                question.source_pages = payload.source_pages || question.source_pages;
                question.page_number = payload.page_number || question.page_number;
                question.priority = payload.priority || question.priority;
                // Reassign section if changed
                const targetSectionName = payload.section_name;
                if (targetSectionName) {
                    let currentSection = null;
                    generatedDraft.sections.forEach(function (sec) {
                        if (sec.questions.indexOf(question) !== -1) currentSection = sec;
                    });
                    if (currentSection && currentSection.name !== targetSectionName) {
                        const idx = currentSection.questions.indexOf(question);
                        if (idx !== -1) currentSection.questions.splice(idx, 1);
                        let target = generatedDraft.sections.find(function (s) { return s.name === targetSectionName; });
                        if (!target) { target = { name: targetSectionName, questions: [] }; generatedDraft.sections.push(target); }
                        target.questions.push(question);
                    }
                }
                renderDraftReview();
                showToast("Question updated in draft.");
            }
        });
    });

    /* INITIALIZE */

    // Wire backend selector (if present)
    (function wireBackendSelector() {
        const sel = document.getElementById("backendTargetSelect");
        const disp = document.getElementById("backendTargetDisplay");
        if (sel) {
            sel.value = getCurrentBackendTarget();
            sel.addEventListener("change", function () {
                setBackendTarget(sel.value);
            });
        }
        if (disp) disp.textContent = API_BASE;
        // keep display in sync after async init
        if (backendInitPromise && typeof backendInitPromise.then === "function") {
            backendInitPromise.then(function () {
                if (sel) sel.value = getCurrentBackendTarget();
                if (disp) disp.textContent = API_BASE;
            }).catch(function () {});
        }
    })();

    // Wait for backend selection before verifying session
    const startApp = function () {
        if (getToken()) {
            loadCurrentUser().then(function (valid) {
                if (valid) showApplication();
                else showLoginPage();
            }).catch(function (error) {
                showLoginPage();
                showToast("Could not verify your session: " + error.message);
            });
        } else {
            showLoginPage();
        }
        window.history.scrollRestoration = "auto";
    };

    if (backendInitPromise && typeof backendInitPromise.then === "function") {
        backendInitPromise.then(startApp).catch(startApp);
    } else {
        startApp();
    }
});
