import { client, downloadFile } from "./client";

const BASE = "/api/nin";

/**
 * Verify a NIN against the government service via POST /api/nin/validate.
 */
export async function verifyNin(dob, nin) {
    try {
        const res = await client(`${BASE}/validate`, {
            method: "POST",
            body: JSON.stringify({ dob, nin }),
        });

        if (res.success) {
            return {
                status: "valid",
                details: res.data || null,
                message: res.message || "NIN verified",
            };
        }
        return {
            status: "invalid",
            details: null,
            message: res.message || "NIN could not be matched",
        };
    } catch (err) {
        // Distinguish system/network error from invalid match
        return {
            status: "error",
            details: null,
            message: err?.message || err?.msg || "Could not verify NIN — service unavailable",
        };
    }
}

/**
 * Warm the NIN service's auth token via POST /api/nin/warm.
 */
export async function warmNin() {
    try {
        await client(`${BASE}/warm`, { method: "POST" });
    } catch {
        // Best-effort
    }
}

/* ═══════════════════════ Batch NIN validation ═══════════════════════ */

function jobIdFromUrl(url) {
    const m = String(url || "").match(/\/batch\/([^/]+)\/(?:progress|status)/);
    return m ? m[1] : null;
}

export async function startNinBatch({ file, generateReport = false, aggregateBy = null }) {
    const fd = new FormData();
    fd.append("batch_file", file);
    fd.append("generate_report", generateReport ? "true" : "false");
    fd.append("aggregate_by_lga_ward", aggregateBy === "ward" ? "true" : "false");
    fd.append("aggregate_by_lga_facility", aggregateBy === "facility" ? "true" : "false");

    try {
        const res = await client(`${BASE}/batch/validate`, {
            method: "POST",
            body: fd,
        });

        return {
            ok: true,
            duplicate: false,
            jobId: jobIdFromUrl(res?.data?.job_url),
            msg: res?.msg || "Batch validation started",
        };
    } catch (err) {
        // Handle 409 duplicate
        if (err?.data?.job_url) {
            return {
                ok: true,
                duplicate: true,
                jobId: jobIdFromUrl(err.data.job_url),
                msg: err.msg || "You already submitted this document",
            };
        }
        throw err || { success: false, msg: "Batch submission failed" };
    }
}

export function connectNinBatch(jobId) {
    return new EventSource(`${BASE}/batch/${jobId}/progress`);
}

export async function getNinBatchStatus(jobId) {
    const res = await client(`${BASE}/batch/${jobId}/status`);
    return res.data;
}

const DL_FALLBACK = {
    result: "nin_result.csv",
    breakdown: "nin_breakdown.zip",
    report: "nin_report.pdf",
};

export async function downloadNinBatch(jobId, type) {
    const fallbackName = DL_FALLBACK[type] || `nin_${type}`;
    return downloadFile(
        `${BASE}/batch/${jobId}/download?download-type=${encodeURIComponent(type)}`,
        fallbackName
    );
}
