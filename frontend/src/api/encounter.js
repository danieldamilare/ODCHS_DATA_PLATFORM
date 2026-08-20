import { client, downloadFile } from "./client";

const BASE = "/api/encounter";

/**
 * Encounter subsystem API.
 *
 * Pipeline: upload an encounter file (or a zip of several) → the backend
 * validates each file (picking a sheet + header row, asking the user only when
 * it cannot resolve them automatically) → analyses each into an encounter +
 * utilization report. Progress is streamed over SSE; a one-shot /status probe
 * lets the page decide whether a job is already terminal before it connects.
 */

export const ENCOUNTER_TYPES = ["oranghis", "bhcpf"];

/* The 5 columns the ORANGHIS pipeline needs mapped. The backend validates that
 * an answer maps exactly these keys (with spaces), so treat this as canonical. */
export const ORANGHIS_REQUIRED_COLUMNS = ["age", "client name", "diagnosis", "sex", "policy number"];

/**
 * Start an encounter job. Returns { ok, jobId, msg }.
 * BHCPF currently returns 501 with a server-supplied message — surfaced as ok:false.
 */
export async function startEncounterJob({ file, encounterType, chaiOnly = false }) {
    const fd = new FormData();
    fd.append("encounter_file", file);
    fd.append("encounter_type", encounterType);
    fd.append("chai_only", chaiOnly ? "true" : "false");

    try {
        const res = await client(`${BASE}/upload`, { method: "POST", body: fd });
        return { ok: !!res.success, jobId: res.job_id || null, msg: res.msg || "Encounter job started" };
    } catch (err) {
        // 501 (BHCPF) / 400 / 500 all land here with the server's own message.
        return { ok: false, jobId: null, msg: err?.msg || "Could not start encounter job" };
    }
}

/**
 * One-shot status probe. Returns the job hash (status, state, completed, total,
 * files, current_job, pending_question, report_path…). Throws on 400 (no job).
 */
export async function getEncounterStatus(jobId) {
    const res = await client(`${BASE}/${jobId}/status`);
    return res.data;
}

/** Open the SSE progress stream for a job. */
export function connectEncounter(jobId) {
    return new EventSource(`${BASE}/${jobId}/progress`);
}

/**
 * Answer a pending validation question.
 * state === "sheet_verification"        → { sheet_name }
 * state === "header_row_disambiguation" → { header_row, col: { <field>: colIndex } }
 */
export async function answerEncounter(jobId, jobNum, answer) {
    return client(`${BASE}/${jobId}/${jobNum}/answer`, {
        method: "POST",
        body: JSON.stringify(answer),
    });
}

/** Download the finished encounter + utilization report. */
export async function downloadEncounterReport(jobId) {
    return downloadFile(`${BASE}/${jobId}/download`, "encounter_utilization_report.xlsx");
}
