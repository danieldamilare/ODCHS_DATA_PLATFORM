const BASE = "/api/nin";

/**
 * Verify a NIN against the government service via POST /api/nin/validate.
 *
 * The endpoint has THREE outcomes we must distinguish — do NOT collapse them:
 *   - HTTP 200 + success:true   → the NIN service matched the DOB/NIN  → "valid"
 *   - HTTP 200 + success:false  → the NIN service ran and found no match → "invalid"
 *   - HTTP 500 (sys_err)        → the NIN service was unreachable/failed → "error"
 *                                 (transient — this is "couldn't verify", NOT "invalid")
 *
 * Because a 500 carries a meaningful body, this intentionally does not reuse the
 * throw-on-!ok request() helper used elsewhere; it normalises every case into a
 * plain result object the caller can branch on without try/catch.
 *
 * @param {string} dob - date of birth; ISO `YYYY-MM-DD` is preferred (the backend
 *                        parses flexibly via dateutil, so slashes/dashes also work).
 * @param {string} nin - 11-digit NIN.
 * @returns {Promise<{status:"valid"|"invalid"|"error", details:object|null, message:string}>}
 *          `details` is the NIN server payload (firstName/middleName/lastName/
 *          dateOfBirth/gender/…) and is only populated when status === "valid".
 */
export async function verifyNin(dob, nin) {
    let response;
    try {
        response = await fetch(`${BASE}/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dob, nin }),
        });
    } catch {
        // Never reached the server — treat as "couldn't verify", not "invalid".
        return { status: "error", details: null, message: "Network error — could not verify NIN" };
    }

    let data;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    // 500 → sys_err: the NIN service failed/timed out. Transient; the NIN itself
    // was never actually judged. Surface as "error", never "invalid".
    if (response.status >= 500) {
        return {
            status: "error",
            details: null,
            message: data?.message || "Could not verify NIN — service unavailable",
        };
    }

    // 400 → the request payload was rejected (malformed dob/nin). The hook only
    // fires on a well-formed 11-digit NIN + present DOB, so this is unexpected;
    // treat as "couldn't verify" rather than a false "invalid" verdict.
    if (!response.ok) {
        return { status: "error", details: null, message: "Could not verify NIN" };
    }

    // 200 → the service answered. success distinguishes matched vs. no-match.
    if (data?.success) {
        return { status: "valid", details: data.data || null, message: data.message || "NIN verified" };
    }
    return { status: "invalid", details: null, message: data?.message || "NIN could not be matched" };
}

/**
 * Warm the NIN service's auth token via POST /api/nin/warm.
 *
 * Fire-and-forget: the endpoint returns 204 with an empty body, so there is
 * nothing to parse. Call once when a review session mounts so the first real
 * verification isn't paying the token-acquisition latency. Failures are ignored.
 */
export async function warmNin() {
    try {
        await fetch(`${BASE}/warm`, { method: "POST" });
    } catch {
        // Best-effort; a cold token just means the first verify is a little slower.
    }
}

/* ═══════════════════════ Batch NIN validation ═══════════════════════ */

/** The backend returns a server-relative `job_url` pointing at either the
 *  progress-stream or status endpoint; both embed the job id as the segment
 *  after `/batch/`. Pull it out so we can drive the stream/status/download. */
function jobIdFromUrl(url) {
    const m = String(url || "").match(/\/batch\/([^/]+)\/(?:progress|status)/);
    return m ? m[1] : null;
}

/**
 * Start a batch NIN validation job via POST /api/nin/batch/validate (multipart).
 *
 * `aggregateBy` is a single value — null | "ward" | "facility" — mapped to the
 * two mutually-exclusive backend flags. Modelling it as one field makes the
 * "can't break down by both" rule unrepresentable on the client.
 *
 * Outcomes:
 *   - 200 success   → { ok:true, duplicate:false, jobId, msg }
 *   - 409 duplicate → { ok:true, duplicate:true,  jobId, msg }  (same file already
 *                      submitted; jobId points at the existing job so we can still
 *                      attach to its progress/result — the stream handles a done job)
 *   - 400 / 500     → throws { success:false, msg } (msg is a human string)
 *
 * @param {object}   opts
 * @param {File}      opts.file            csv/xlsx/xls with dob,nin columns.
 * @param {boolean}  [opts.generateReport] also produce the PDF report.
 * @param {"ward"|"facility"|null} [opts.aggregateBy] breakdown dimension.
 * @returns {Promise<{ok:boolean, duplicate:boolean, jobId:string|null, msg:string}>}
 */
export async function startNinBatch({ file, generateReport = false, aggregateBy = null }) {
    const fd = new FormData();
    fd.append("batch_file", file);
    fd.append("generate_report", generateReport ? "true" : "false");
    fd.append("aggregate_by_lga_ward", aggregateBy === "ward" ? "true" : "false");
    fd.append("aggregate_by_lga_facility", aggregateBy === "facility" ? "true" : "false");

    const response = await fetch(`${BASE}/batch/validate`, { method: "POST", body: fd });
    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (response.status === 409) {
        return {
            ok: true,
            duplicate: true,
            jobId: jobIdFromUrl(data?.data?.job_url),
            msg: data?.msg || "You already submitted this document",
        };
    }
    if (!response.ok || !data?.success) {
        throw data || { success: false, msg: "Batch submission failed" };
    }
    return {
        ok: true,
        duplicate: false,
        jobId: jobIdFromUrl(data?.data?.job_url),
        msg: data?.msg || "Batch validation started",
    };
}

/** Open the batch progress SSE stream. Events: `status` (connect snapshot),
 *  `validating`/`merging`/`breakdown`/`report` (phase deltas), `complete`
 *  (terminal), `error`. Consumed by useNinBatchProgress. */
export function connectNinBatch(jobId) {
    return new EventSource(`${BASE}/batch/${jobId}/progress`);
}

/**
 * Fetch a batch job's current status via GET /api/nin/batch/<jobId>/status.
 *
 * The authoritative source for which artefacts exist: `data.aggregate`
 * (breakdown available) and `data.generate_report` (report available). Used
 * after `done` to gate the download buttons — reliable even for a duplicate
 * job whose original options differ from the current form selections.
 *
 * @returns {Promise<{status, completed, total, aggregate, generate_report}>}
 */
export async function getNinBatchStatus(jobId) {
    const response = await fetch(`${BASE}/batch/${jobId}/status`);
    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }
    if (!response.ok || !data?.success) {
        throw data || { success: false, msg: "Could not load job status" };
    }
    return data.data;
}

const DL_FALLBACK = {
    result: "nin_result.csv",
    breakdown: "nin_breakdown.csv",
    report: "nin_report.pdf",
};

/**
 * Download a batch artefact via GET /api/nin/batch/<jobId>/download.
 *
 * NOTE the query key is hyphenated `download-type` (matches the backend's
 * request.args.get("download-type")). `type` is one of result | breakdown |
 * report. The real filename comes from Content-Disposition; the fallback is
 * only used when that header is absent.
 */
export async function downloadNinBatch(jobId, type) {
    const response = await fetch(`${BASE}/batch/${jobId}/download?download-type=${encodeURIComponent(type)}`);
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
    const name = match ? decodeURIComponent(match[1]) : DL_FALLBACK[type] || `nin_${type}`;

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
