// DOM Utilities
export function $(selector, parent = document) {
    return parent.querySelector(selector);
}

export function $$(selector, parent = document) {
    return Array.from(parent.querySelectorAll(selector));
}

export function createElement(tag, className = "", attributes = {}) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    Object.entries(attributes).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
            element.setAttribute(key, value);
        }
    });
    return element;
}

export function escapeHtml(value) {
    const amp = "&amp;";
    const map = {
        "&": amp,
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    };
    return String(value ?? "").replace(/[&<>"']/g, char => map[char]);
}

export function show(element) {
    if (element) element.classList.remove("hidden");
}

export function hide(element) {
    if (element) element.classList.add("hidden");
}

export function toggle(element, condition) {
    if (!element) return;
    if (condition) show(element);
    else hide(element);
}
