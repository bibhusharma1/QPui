import { apiClient } from './api-client.js';

export async function getSubjects() {
    const response = await apiClient.get('/subjects');
    return response?.subjects || [];
}

export async function createSubject(name) {
    return apiClient.post('/subjects', { name });
}

export async function renameSubject(subject, name) {
    return apiClient.patch(`/subjects/${encodeURIComponent(subject)}`, { name });
}

export async function deleteSubject(subject) {
    return apiClient.delete(`/subjects/${encodeURIComponent(subject)}`);
}

export async function getSubjectPdfs(subject) {
    return apiClient.get(`/subjects/${encodeURIComponent(subject)}/pdfs`);
}

export async function uploadPdfs(subject, files) {
    const formData = new FormData();
    for (const file of files) {
        formData.append('files', file);
    }
    return apiClient.request(`/subjects/${encodeURIComponent(subject)}/pdfs`, {
        method: 'POST',
        form: formData
    });
}

export async function deletePdf(subject, filename) {
    return apiClient.delete(`/subjects/${encodeURIComponent(subject)}/pdfs/${encodeURIComponent(filename)}`);
}

export async function updatePdfReview(subject, filename, review_status) {
    return apiClient.patch(`/subjects/${encodeURIComponent(subject)}/pdfs/${encodeURIComponent(filename)}`, { review_status });
}

export async function processPdf(subject, filename, force = true) {
    return apiClient.post(`/subjects/${encodeURIComponent(subject)}/pdfs/${encodeURIComponent(filename)}/process`, { force });
}

export async function getJobStatus(jobId) {
    return apiClient.get(`/jobs/${jobId}`);
}

export async function getPdfStatus(subject, filename) {
    return apiClient.get(`/subjects/${encodeURIComponent(subject)}/pdfs/${encodeURIComponent(filename)}/status`);
}

export async function getPdfResult(subject, filename, includeQuestions = false) {
    const query = includeQuestions ? '?include_questions=true' : '';
    return apiClient.get(`/subjects/${encodeURIComponent(subject)}/pdfs/${encodeURIComponent(filename)}/result${query}`);
}

export async function reconstructPdf(subject, filename) {
    return apiClient.post(`/subjects/${encodeURIComponent(subject)}/pdfs/${encodeURIComponent(filename)}/reconstruct`);
}

export async function downloadReconstruction(subject, filename) {
    return apiClient.get(`/subjects/${encodeURIComponent(subject)}/pdfs/${encodeURIComponent(filename)}/reconstruction`);
}
