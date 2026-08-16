import { useEffect, useState } from "react";
import { connectNinBatch } from "../api/nin";

const PHASES = ["validating", "merging", "breakdown", "report"];

// Status snapshots come from Redis hgetall, so every field is a string; the
// pubsub deltas send real ints. Coerce anything we render/compare.
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

// A status snapshot carries more fields than a phase delta (aggregate,
// generate_report) and never carries fewer progress fields than the phase
// delta (completed/total) — so for NIN, spreading the snapshot after the
// delta is always safe: the delta's numbers win, the snapshot's extras land.
function merge(prev, p) {
    return {
        ...prev,
        ...p,
        completed: num(p.completed ?? prev.completed),
        total: num(p.total ?? prev.total),
    };
}

/**
 * SSE progress for a NIN batch validation job.
 *
 * Unlike id-card generation there is no POST-then-connect race: the KV job
 * key exists before the submit response returns, and both endpoints answer
 * for a finished job (progress → instant "complete", status → done snapshot).
 * So no `attempt` gating is needed — connect as soon as a jobId exists.
 *
 * Event contract (nin_validation/tasks.py + nin_validation/routes.py):
 *   - status     connect-time snapshot — extra fields: aggregate (ward|facility)
 *                and generate_report ("true"/"false" strings)
 *   - validating/merging/breakdown/report — phase deltas {status,completed,total}
 *   - complete   terminal {status:"done", completed, total}; stream closes
 *   - error      logical errors carry JSON {message}; transport drops fire it
 *                with no data
 *
 * A job that was already done when the stream opened still emits "complete",
 * so done=true is always the green light for the result/download buttons.
 */
export default function useNinBatchProgress(jobId) {
    const [progress, setProgress] = useState({});
    const [phase, setPhase] = useState(null);
    const [done, setDone] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!jobId) return;

        // Fresh connection — drop any state carried from a previous job.
        setProgress({});
        setPhase(null);
        setDone(false);
        setError(null);

        const source = connectNinBatch(jobId);

        source.addEventListener("status", (event) => {
            const p = JSON.parse(event.data);
            setProgress((prev) => merge(prev, p));
            const phase = p.status ? String(p.status).toLowerCase() : null;
            setPhase(phase === "done" ? "done" : PHASES.includes(phase) ? phase : null);
            if (phase === "done") {
                setDone(true);
                source.close();
            }
        });

        for (const name of PHASES) {
            source.addEventListener(name, (event) => {
                const p = JSON.parse(event.data);
                setPhase(name);
                setProgress((prev) => merge(prev, p));
            });
        }

        source.addEventListener("complete", (event) => {
            const p = JSON.parse(event.data);
            setProgress((prev) => merge(prev, p));
            setPhase("done");
            setDone(true);
            source.close();
        });

        source.addEventListener("error", (event) => {
            if (event.data) {
                let message = "Connection lost";
                try {
                    message = JSON.parse(event.data).message || message;
                } catch {
                    /* keep default */
                }
                setError(message);
            } else {
                setError("Connection lost");
            }
            source.close();
        });

        return () => source.close();
    }, [jobId]);

    return { progress, phase, done, error };
}
