// Validators
export function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

export function isValidSubjectName(name) {
    if (!name || name.trim().length === 0) return false;
    const nameRegex = /^[a-zA-Z0-9 _-]+$/;
    return nameRegex.test(name.trim());
}

export function required(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim().length > 0;
    return value !== null && value !== undefined;
}
