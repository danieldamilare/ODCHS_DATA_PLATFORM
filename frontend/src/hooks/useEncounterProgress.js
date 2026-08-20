import { useCallback, useEffect, useState } from "react";
import { connectEncounter } from "../api/encounter";

/**
 * Streams encounter job progress over SSE.
 *
 * The backend's opening `status` event is the full job snapshot (status, state,
 * completed, total, current_job, files, pending_question), so a reload mid-job —
 * even mid-question — rehydrates from that single event. Subsequent channel
 * events (validating / analysing / done_validating / done_analysing / done /
 * error) just move counts forward.
 */

// Events that carry counts/status and merge into `progress`.
const MERGE_EVENTS = ["extracting", "validating", "message", "done_validating", "analysing", "done_analysing"];

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

// `files` is an object on live events but a JSON string in the snapshot.
function parseFiles(files) {
    if (!files) return null;
    if (typeof files === "string") {
        try {
            return JSON.parse(files);
        } catch {
            return null;
        }
    }
    return files;
}

// Snapshot stores the pending question as a JSON string under `pending_question`;
// a live `require_user_input` event IS the question object already.
function parseQuestion(raw) {
    if (!raw) return null;
    if (typeof raw === "string") {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }
    return raw;
}

function mergeProgress(prev, p) {
    const next = { ...prev, ...p };
    delete next.pending_question; // tracked separately as `pendingQuestion`
    if ("completed" in p) next.completed = num(p.completed);
    if ("total" in p) next.total = num(p.total);
    if ("current_job" in p) next.current_job = num(p.current_job);
    const files = parseFiles(p.files);
    if (files) next.files = files;
    return next;
}

export default function useEncounterProgress(jobId) {
    const [progress, setProgress] = useState({});
    const [pendingQuestion, setPendingQuestion] = useState(null);
    const [done, setDone] = useState(false);
    const [error, setError] = useState(null);

    // Lets the page optimistically dismiss a question the moment it's answered,
    // before the next require_user_input (or completion) arrives.
    const clearPendingQuestion = useCallback(() => setPendingQuestion(null), []);

    useEffect(() => {
        if (!jobId) return;

        setProgress({});
        setPendingQuestion(null);
        setDone(false);
        setError(null);

        const source = connectEncounter(jobId);

        source.addEventListener("status", (event) => {
            const p = JSON.parse(event.data);
            setProgress((prev) => mergeProgress(prev, p));
            const q = parseQuestion(p.pending_question);
            if (q) setPendingQuestion(q);
            if (String(p.status).toLowerCase() === "done") {
                setDone(true);
                source.close();
            }
        });

        for (const name of MERGE_EVENTS) {
            source.addEventListener(name, (event) => {
                setProgress((prev) => mergeProgress(prev, JSON.parse(event.data)));
            });
        }

        source.addEventListener("require_user_input", (event) => {
            const p = JSON.parse(event.data);
            // Keep the heavy sheet `data` out of `progress`; only the counts belong there.
            setProgress((prev) =>
                mergeProgress(prev, { status: p.status, state: p.state, job_num: p.job_num, total: p.total })
            );
            setPendingQuestion(p);
        });

        source.addEventListener("done", (event) => {
            let p = {};
            try {
                p = JSON.parse(event.data);
            } catch {
                /* completion snapshot missing — treat as done anyway */
            }
            setProgress((prev) => mergeProgress(prev, p));
            setPendingQuestion(null);
            setDone(true);
            source.close();
        });

        source.addEventListener("error", (event) => {
            // Pipeline failures + the server's "Connection lost" carry data; a
            // bare error is EventSource's own transient reconnect — let it retry.
            if (event.data) {
                let message = "Connection lost";
                try {
                    message = JSON.parse(event.data).message || message;
                } catch {
                    /* keep default */
                }
                setError(message);
                source.close();
            }
        });

        return () => source.close();
    }, [jobId]);

    return { progress, pendingQuestion, done, error, clearPendingQuestion };
}
