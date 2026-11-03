// Error Handling
export function getErrorMessage(error) {
    if (typeof error === "string") return error;
    if (error?.message) return error.message;
    return "An unexpected error occurred";
}

export function formatApiError(error) {
    const message = getErrorMessage(error);
    // Remove technical details and make user-friendly
    if (message.includes("Cannot reach server")) {
        return "Unable to connect to server. Please check if the backend is running.";
    }
    if (message.includes("Session expired")) {
        return "Your session has expired. Please log in again.";
    }
    if (message.includes("Unauthorized")) {
        return "You are not authorized to perform this action.";
    }
    return message;
}
