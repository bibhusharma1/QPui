import { API_BASE, TOKEN_KEY } from '../config.js';

export class ApiClient {
    constructor() {
        this.onUnauthorized = null;
    }

    getToken() {
        return sessionStorage.getItem(TOKEN_KEY);
    }

    setToken(token) {
        sessionStorage.setItem(TOKEN_KEY, token);
    }

    clearSession() {
        sessionStorage.removeItem(TOKEN_KEY);
    }

    async request(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        const token = this.getToken();
        const startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
        const sensitiveKeys = ["password", "token", "access_token", "authorization", "secret", "api_key", "apikey"];
        const redact = (value) => {
            if (value === null || value === undefined) return value;
            if (Array.isArray(value)) return value.map(redact);
            if (typeof value === "object") {
                const out = {};
                for (const key of Object.keys(value)) {
                    if (sensitiveKeys.indexOf(String(key).toLowerCase()) !== -1) out[key] = "[REDACTED]";
                    else out[key] = redact(value[key]);
                }
                return out;
            }
            return value;
        };
        try {
            if (typeof console !== "undefined" && console.debug) {
                const body = options.form ? "[FormData]" : (options.body !== undefined ? redact(options.body) : undefined);
                console.debug("[api] request", options.method || "GET", path, { headers: Object.keys(headers).reduce((acc, key) => { acc[key] = sensitiveKeys.indexOf(String(key).toLowerCase()) !== -1 || String(key).toLowerCase() === "authorization" ? "[REDACTED]" : headers[key]; return acc; }, {}), body });
            }
        } catch (e) {}

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        if (options.form) {
            options.body = options.form;
        } else if (options.body !== undefined) {
            headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(options.body);
        }

        let response;

        try {
            response = await fetch(API_BASE + path, { ...options, headers });
        } catch (error) {
            throw new Error("Cannot reach server at " + API_BASE);
        }

        try {
            if (typeof console !== "undefined" && console.debug) {
                const duration = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
                console.debug("[api] response", options.method || "GET", path, response.status, response.statusText, { duration_ms: duration });
            }
        } catch (e) {}

        if (response.status === 401) {
            let detail = "Unauthorized";
            try {
                const data = await response.json();
                if (typeof data.detail === "string") detail = data.detail;
                else if (data.message) detail = data.message;
            } catch {}
            this.clearSession();
            if (typeof this.onUnauthorized === "function") this.onUnauthorized();
            const error = new Error(detail);
            error.status = 401;
            throw error;
        }

        if (response.status === 403) {
            const error = new Error("Your account does not have permission to perform this action.");
            error.status = 403;
            throw error;
        }

        if (!response.ok) {
            let message = response.status + " " + response.statusText;

            try {
                const data = await response.json();
                if (Array.isArray(data.errors)) {
                    message = data.errors.map(item => [item.field, item.message].filter(Boolean).join(": ")).join("; ");
                } else if (data.detail) {
                    if (typeof data.detail === "string") {
                        message = data.detail;
                    } else if (Array.isArray(data.detail)) {
                        message = data.detail.map(item => {
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
            } catch {
                // keep status text
            }

            throw new Error(message);
        }

        if (response.status === 204) return null;

        const contentType = response.headers.get("Content-Type") || "";

        if (contentType.includes("application/json")) return response.json();
        if (contentType.includes("text/")) return response.text();
        return response.blob();
    }

    async get(path, options = {}) {
        return this.request(path, { ...options, method: "GET" });
    }

    async post(path, body, options = {}) {
        return this.request(path, { ...options, method: "POST", body });
    }

    async put(path, body, options = {}) {
        return this.request(path, { ...options, method: "PUT", body });
    }

    async delete(path, options = {}) {
        return this.request(path, { ...options, method: "DELETE" });
    }

    async patch(path, body, options = {}) {
        return this.request(path, { ...options, method: "PATCH", body });
    }
}

export const apiClient = new ApiClient();
