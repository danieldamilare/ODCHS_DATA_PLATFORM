import { client, downloadFile } from "./client";

const BASE = "/api/enrollment";

async function request(url, options = {}) {
    return client(`${BASE}${url}`, options);
}

export async function getLGAs() {
    return request("/lgas");
}

export async function getWards(lgaId) {
    return request(`/wards/${lgaId}`);
}

export async function getFacilities(wardId) {
    return request(`/facilities/${wardId}`);
}

export async function getCategories() {
    return request("/categories");
}

export async function uploadBatch(formData) {
    return request("/batches", { method: "POST", body: formData });
}

export async function getBatches(page = 1) {
    return request(`/batches?page=${page}`);
}

export async function getBatchDetail(batchId) {
    return request(`/batches/${batchId}`);
}

export async function getBatchForms(batchId, { status, after, count = 20 } = {}) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (after) params.set("after", after);
    params.set("count", count);
    return request(`/batches/${batchId}/forms?${params.toString()}`);
}

export async function getForm(formId) {
    return request(`/form/${formId}`);
}

export async function updateForm(formId, fields) {
    return request(`/form/${formId}`, {
        method: "PATCH",
        body: JSON.stringify(fields),
    });
}

export async function uploadPassport(formId, file) {
    const formData = new FormData();
    formData.append("passport", file);
    return request(`/form/${formId}/passport`, {
        method: "POST",
        body: formData,
    });
}

export async function rejectForm(formId, reason) {
    return request(`/form/${formId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
    });
}

export async function enrollForm(formId) {
    return request(`/form/${formId}/enroll`, {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export async function updateAndEnrollForm(formId, fields) {
    return request(`/form/${formId}/update-enroll`, {
        method: "POST",
        body: JSON.stringify(fields),
    });
}

export async function submitVerification(formId, data) {
    return request(`/form/${formId}/verify`, {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function resolveNin(formId, chosenDob) {
    return request(`/form/${formId}/resolve-nin`, {
        method: "POST",
        body: JSON.stringify({ dob: chosenDob }),
    });
}

export async function reprocessForm(formId) {
    return request(`/form/${formId}/reprocess`, {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export async function rescanForm(formId, file) {
    const formData = new FormData();
    formData.append("image", file);
    return request(`/form/${formId}/rescan`, {
        method: "POST",
        body: formData,
    });
}

export async function cancelBatch(batchId) {
    return request(`/batches/${batchId}/cancel`, {
        method: "POST",
    });
}

export function connectBatch(batchId) {
    return new EventSource(`${BASE}/batches/${batchId}/progress`);
}

export function startIdCards(batchId) {
    return request(`/batches/${batchId}/idcards`, {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export function connectIdCards(batchId) {
    return new EventSource(`${BASE}/batches/${batchId}/idcards/progress`);
}

/* ── Downloads ── */
export function downloadFormImage(formId) {
    return downloadFile(`${BASE}/form/${formId}/download?type=img`, `form_${formId}.jpg`);
}

export function downloadFormIdcard(formId) {
    return downloadFile(`${BASE}/form/${formId}/download?type=idcard`, `idcard_${formId}.png`);
}

export function downloadBatchForms(batchId, status) {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return downloadFile(`${BASE}/batches/${batchId}/forms/download${query}`, `${batchId}_forms.zip`);
}

export function downloadBatchIdcards(batchId) {
    return downloadFile(`${BASE}/batches/${batchId}/idcards/download`, `${batchId}_idcards.zip`);
}
