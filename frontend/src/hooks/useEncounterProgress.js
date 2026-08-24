import { useCallback, useEffect, useRef, useState } from "react";
import { connectEncounter } from "../api/encounter";

/**
 * Streams encounter job progress over SSE.
 *
 * Instead of inferring per-file status from the global `currentJob` counter
 * (which is racy and inaccurate), we track each file's lifecycle from the
 * SSE events that carry a `job_num`:
 *
 *   validating          → file is being validated
 *   require_user_input  → file needs user input (paused)
 *   done_validating     → file validation complete, analysis starting
 *   done_analysing      → file analysis complete
 *   message (Skipped)   → file was skipped
 *
 * On initial load the snapshot gives us global state; we bootstrap per-file
 * statuses from that, then live events override them one-by-one.
 */

// ── helpers ──

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function parseFiles(files) {
    if (!files) return null;
    if (typeof files === "string") {
        try { return JSON.parse(files); } catch { return null; }
    }
    return files;
}

function parseQuestion(raw) {
    if (!raw) return null;
    if (typeof raw === "string") {
        try { return JSON.parse(raw); } catch { return null; }
    }
    return raw;
}

/**
 * Merge a progress snapshot into the current state, keeping only the
 * scalar/count fields. Per-file statuses live in a separate map.
 */
function mergeProgress(prev, p) {
    const next = { ...prev };
    if ("status" in p) next.status = String(p.status || "").toLowerCase();
    if ("state" in p) next.state = String(p.state || "").toLowerCase();
    if ("completed" in p) next.completed = num(p.completed);
    if ("total" in p) next.total = num(p.total);
    if ("current_job" in p) next.current_job = num(p.current_job);
    const files = parseFiles(p.files);
    if (files) next.files = files;
    return next;
}

/**
 * Bootstrap a per-file status map from the snapshot.
 * Returns a plain object: { [fileIndex]: statusString }
 */
function initFileStatuses(snapshot) {
    const total = num(snapshot.total);
    const currentJob = num(snapshot.current_job);
    const status = String(snapshot.status || "").toLowerCase();
    const pendingQuestion = parseQuestion(snapshot.pending_question);
    const result = {};

    for (let i = 1; i <= total; i++) {
        if (status === "done") {
            result[i] = "done";
        } else if (status === "failed") {
            result[i] = "failed";
        } else if (status === "analysing") {
            // All validation is done. Files 1..completed are analysed,
            // the rest are waiting for/undergoing analysis.
            result[i] = i <= num(snapshot.completed) ? "done" : "analysing";
        } else {
            // status is "validating", "extracting", "Starting", etc.
            if (i < currentJob) {
                result[i] = "analysing"; // validated, analysis pending
            } else if (i === currentJob) {
                if (pendingQuestion && num(pendingQuestion.job_num) === i) {
                    result[i] = "needs_input";
                } else {
                    result[i] = "validating";
                }
            } else {
                result[i] = "queued";
            }
        }
    }
    return result;
}

/**
 * Map an SSE event type + payload to the new status for a specific file.
 * Returns null if the event doesn't map to a file status.
 */
function eventToFileStatus(eventType, data) {
    switch (eventType) {
        case "validating":
            return "validating";
        case "require_user_input":
            return "needs_input";
        case "done_validating":
            return "analysing";
        case "done_analysing":
            return "done";
        case "message": {
            const msg = String(data.message || "").toLowerCase();
            if (msg.includes("skip")) return "skipped";
            return null; // other messages don't change file status
        }
        default:
            return null;
    }
}

// ── hook ──

export default function useEncounterProgress(jobId) {
    const [progress, setProgress] = useState({});
    const [fileStatuses, setFileStatuses] = useState({});
    const [pendingQuestion, setPendingQuestion] = useState(null);
    const [done, setDone] = useState(false);
    const [error, setError] = useState(null);

    // Refs so event listeners always see latest state without re-subscribing.
    const fileStatusesRef = useRef(fileStatuses);
    fileStatusesRef.current = fileStatuses;
    const progressRef = useRef(progress);
    progressRef.current = progress;

    const clearPendingQuestion = useCallback((answeredJobNum) => {
        setPendingQuestion((prev) => {
            if (!prev) return null;
            if (answeredJobNum && prev.job_num !== answeredJobNum) {
                return prev; // a newer question already arrived
            }
            return null;
        });
    }, []);

    useEffect(() => {
        if (!jobId) return;

        setProgress({});
        setFileStatuses({});
        setPendingQuestion(null);
        setDone(false);
        setError(null);

        const source = connectEncounter(jobId);

        // ── snapshot event (opening state) ──
        source.addEventListener("status", (event) => {
            const p = JSON.parse(event.data);
            setProgress((prev) => mergeProgress(prev, p));

            // Bootstrap per-file statuses from the snapshot
            setFileStatuses(initFileStatuses(p));

            const q = parseQuestion(p.pending_question);
            if (q) setPendingQuestion(q);

            if (String(p.status).toLowerCase() === "done") {
                setDone(true);
                source.close();
            }
        });

        // ── per-file lifecycle events ──
        // These carry `job_num` and update a single file's status.
        const FILE_LIFECYCLE_EVENTS = [
            "validating",
            "done_validating",
            "done_analysing",
        ];
        for (const name of FILE_LIFECYCLE_EVENTS) {
            source.addEventListener(name, (event) => {
                const data = JSON.parse(event.data);
                setProgress((prev) => mergeProgress(prev, data));
                const jobNum = num(data.job_num);
                if (jobNum > 0) {
                    const newStatus = eventToFileStatus(name, data);
                    if (newStatus) {
                        setFileStatuses((prev) => ({
                            ...prev,
                            [jobNum]: newStatus,
                        }));
                    }
                }
            });
        }

        // ── user input required ──
        source.addEventListener("require_user_input", (event) => {
            const p = JSON.parse(event.data);
            setProgress((prev) =>
                mergeProgress(prev, {
                    status: p.status,
                    state: p.state,
                    job_num: p.job_num,
                    total: p.total,
                })
            );
            const jobNum = num(p.job_num);
            if (jobNum > 0) {
                setFileStatuses((prev) => ({
                    ...prev,
                    [jobNum]: "needs_input",
                }));
            }
            setPendingQuestion(p);
        });

        // ── informational messages (e.g. "Skipped empty file") ──
        source.addEventListener("message", (event) => {
            const data = JSON.parse(event.data);
            setProgress((prev) => mergeProgress(prev, data));
            const jobNum = num(data.job_num);
            if (jobNum > 0) {
                const newStatus = eventToFileStatus("message", data);
                if (newStatus) {
                    setFileStatuses((prev) => ({
                        ...prev,
                        [jobNum]: newStatus,
                    }));
                }
            }
        });

        // ── analysis status events (global) ──
        for (const name of ["extracting", "analysing"]) {
            source.addEventListener(name, (event) => {
                setProgress((prev) => mergeProgress(prev, JSON.parse(event.data)));
            });
        }

        // ── job complete ──
        source.addEventListener("done", (event) => {
            let p = {};
            try { p = JSON.parse(event.data); } catch { /* empty */ }
            setProgress((prev) => mergeProgress(prev, p));

            // Mark all files as done
            setFileStatuses((prev) => {
                const next = { ...prev };
                const total = num(p.total) || num(progressRef.current.total);
                for (let i = 1; i <= total; i++) next[i] = "done";
                return next;
            });

            setPendingQuestion(null);
            setDone(true);
            source.close();
        });

        // ── errors ──
        source.addEventListener("error", (event) => {
            if (event.data) {
                let message = "Connection lost";
                try { message = JSON.parse(event.data).message || message; } catch { /* keep */ }
                setError(message);
                source.close();
            }
        });

        return () => source.close();
    }, [jobId]);

    return { progress, fileStatuses, pendingQuestion, done, error, clearPendingQuestion };
}
