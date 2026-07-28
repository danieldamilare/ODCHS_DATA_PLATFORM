const BASE = "/api/enrollment";

async function request(url, options = {}) {
    const response = await fetch(`${BASE}${url}`, options);
    let data = null;
    try {
        data = await response.json();
    } catch {
        data = { success: false, msg: "Invalid server response" };
    }
    if (!response.ok) throw data;
    return data;
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

export async function uploadBatch(formData) {
    return request("/batches", { method: "POST", body: formData });
}

export async function getBatches(page = 1) {
    return request(`/batches?page=${page}`);
}

export async function getBatchDetail(batchId) {
    return request(`/batches/${batchId}`);
}

export async function getForm(formId) {
    return request(`/form/${formId}`);
}

export async function updateForm(formId, fields) {
    return request(`/form/${formId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
    });
}

export async function enrollForm(formId) {
    return request(`/form/${formId}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
    });
}

export async function getCategories() {
    return request("/categories");
}

export async function getBatchForms(batchId, { status, after, count = 20 } = {}) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (after) params.set("after", after);
    params.set("count", count);
    return request(`/batches/${batchId}/forms?${params}`);
}

export function connectBatch(batchId) {
    return new EventSource(`${BASE}/batches/${batchId}/progress`);
}
