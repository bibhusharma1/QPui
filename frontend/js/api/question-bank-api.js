import { apiClient } from './api-client.js';

export async function getQuestionBank({ subjectId, marks, page = 1, pageSize = 25 }) {
    if (!subjectId) throw new Error('Select a subject before loading questions.');
    const query = new URLSearchParams({ subject_id: subjectId, page: String(page), page_size: String(pageSize) });
    if (marks !== undefined && marks !== null && marks !== '') query.set('marks', String(marks));
    return apiClient.get(`/api/question-bank?${query}`);
}

export async function getQuestion(questionId, subjectId) {
    return apiClient.get(`/api/question-bank/${encodeURIComponent(questionId)}?subject_id=${encodeURIComponent(subjectId)}`);
}

export async function getQuestionResource(questionId, subjectId, type, resourceId) {
    return apiClient.get(`/api/question-bank/${encodeURIComponent(questionId)}/resources/${encodeURIComponent(type)}/${encodeURIComponent(resourceId)}?subject_id=${encodeURIComponent(subjectId)}`);
}

export async function createQuestion(data) {
    return apiClient.post('/api/question-bank', data);
}

export async function updateQuestion(questionId, subjectId, data) {
    return apiClient.patch(`/api/question-bank/${encodeURIComponent(questionId)}?subject_id=${encodeURIComponent(subjectId)}`, data);
}

export async function getQuestionPriorities(subjectId) {
    const query = subjectId ? `?subject_id=${encodeURIComponent(subjectId)}` : '';
    return apiClient.get(`/api/question-priorities${query}`);
}

export async function updateQuestionPriority(questionId, priority, subjectId) {
    return apiClient.put('/api/question-priorities', { question_id: questionId, priority, subject_id: subjectId });
}

export async function resetQuestionPriority(questionId, subjectId) {
    const query = subjectId ? `?subject_id=${encodeURIComponent(subjectId)}` : '';
    return apiClient.delete(`/api/question-priorities/${encodeURIComponent(questionId)}${query}`);
}
