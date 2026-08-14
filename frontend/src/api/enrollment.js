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

/* ── Reprocess / rescan (both return 202; task queue drives the result) ── */

export async function reprocessForm(formId) {
    return request(`/form/${formId}/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
    });
}

export async function rescanForm(formId, file) {
    const formData = new FormData();
    formData.append("image", file); // backend reads request.files["image"]
    return request(`/form/${formId}/rescan`, { method: "POST", body: formData });
}

/* ── ID card generation ── */

export async function startIdCards(batchId) {
    return request(`/batches/${batchId}/idcards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
    });
}

export function connectIdCards(batchId) {
    return new EventSource(`${BASE}/batches/${batchId}/idcards/progress`);
}

/* ── Downloads ──
 * Fetch-to-blob so JSON error bodies (404/400/500) surface as thrown errors
 * a caller can toast, instead of the browser navigating to a raw error page.
 * The real filename comes from the server's Content-Disposition; the fallback
 * is only used if that header is absent.
 */
async function downloadFile(path, fallbackName) {
    const response = await fetch(`${BASE}${path}`);
    if (!response.ok) {
        let data;
        try {
            data = await response.json();
        } catch {
            data = { success: false, msg: "Download failed" };
        }
        throw data;
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    const name = match ? decodeURIComponent(match[1]) : fallbackName;

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name || "download";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export function downloadFormImage(formId) {
    return downloadFile(`/form/${formId}/download?type=img`, `form_${formId}.jpg`);
}

export function downloadFormIdcard(formId) {
    return downloadFile(`/form/${formId}/download?type=idcard`, `idcard_${formId}.png`);
}

export function downloadBatchForms(batchId, status) {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return downloadFile(`/batches/${batchId}/forms/download${query}`, `${batchId}_forms.zip`);
}

export function downloadBatchIdcards(batchId) {
    return downloadFile(`/batches/${batchId}/idcards/download`, `${batchId}_idcards.zip`);
}
