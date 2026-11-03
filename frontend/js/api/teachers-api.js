import { apiClient } from './api-client.js';

export async function getTeachers(params = {}) {
    const query = new URLSearchParams(params).toString();
    return apiClient.get('/teachers' + (query ? `?${query}` : ''));
}

export async function createTeacher(data) {
    return apiClient.post('/teachers', data);
}

export async function updateTeacher(id, data) {
    return apiClient.patch(`/teachers/${encodeURIComponent(id)}`, data);
}

export async function deleteTeacher(id) {
    return apiClient.delete(`/teachers/${encodeURIComponent(id)}`);
}
