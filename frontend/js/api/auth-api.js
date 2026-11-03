import { apiClient } from './api-client.js';

export async function login(email, password) {
    const response = await apiClient.post('/auth/login', { email, password });
    if (response?.access_token) {
        apiClient.setToken(response.access_token);
    }
    return response;
}

export async function getCurrentUser() {
    try {
        return await apiClient.get('/auth/me');
    } catch (error) {
        // Fallback for cases where endpoint might not exist
        throw error;
    }
}

export function logout() {
    apiClient.clearSession();
}
