import { useEffect, useState } from "react";
import { connectIdCards } from "../api/enrollment";

const NO_JOB_MSG = "No generation job has started for this batch";

// Snapshot events come from Redis `hgetall`, so every field is a string;
// the pubsub deltas send real ints. Coerce anything we do math on or compare
// against 0 (the done-phase Download/Retry gates test `success === 0`).
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

// Merge a payload that carries cumulative counts (status snapshot,
// generate_progress, complete). Spreads the raw payload for any extra fields
// (status, time_started) then normalizes the numerics.
function mergeCounts(prev, p) {
    return {
        ...prev,
        ...p,
        total: num(p.total ?? prev.total),
        fetched: num(p.fetched ?? prev.fetched),
        completed: num(p.completed ?? prev.completed),
        success: num(p.success ?? prev.success),
        failed: num(p.failed ?? prev.failed),
    };
}

/**
 * Reconnect-safe SSE hook for batch ID card generation.
 *
 * Gated on `attempt`: attempt === 0 means "don't connect yet" so the page can
 * POST first and only open the stream once the job is handed off. Bumping
 * `attempt` tears down any existing EventSource and opens a fresh one — used
 * both for the race backoff and for retry.
 *
 * The POST hands off to a Celery task, so the KV status key isn't set the
 * instant the stream opens — the backend answers with an `error` event
 * ("No generation job has started"). That's a race, not a failure, so we
 * surface it as `noJob` and let the caller back off + bump `attempt`.
 *
 * Event contract (see enrollment/routes.py get_idcard_progress_stream):
 * - status           connect-time hgetall snapshot (string values)
 * - fetch_progress   {fetched, total, success} — success is a PER-FETCH bool
 * - generate_progress {completed, success, failed, total, status} cumulative
 * - complete         final hgetall snapshot; stream ends
 * - error            {message}; NO_JOB_MSG is the retryable race
 *
 * State is reset on each (re)connect so a retry doesn't inherit stale progress.
 */
export default function useIdCardProgress(batchId, attempt = 0) {
    const [progress, setProgress] = useState({});
    const [done, setDone] = useState(false);
    const [error, setError] = useState(null);
    const [noJob, setNoJob] = useState(false);

    useEffect(() => {
        if (!batchId || attempt === 0) return;

        // Fresh connection — clear any state carried from a prior attempt.
        setProgress({});
        setDone(false);
        setError(null);
        setNoJob(false);

        const source = connectIdCards(batchId);

        // Full snapshot (connect-time, string-valued). Also the defensive
        // terminal catch for the all-cached race: if the worker flipped
        // status to "done" in the microseconds between the route's status
        // check and its snapshot read, the pubsub "done" was never seen but
        // the snapshot still carries it.
        source.addEventListener("status", (event) => {
            const p = JSON.parse(event.data);
            setProgress((prev) => mergeCounts(prev, p));
            if ((p.status || "").toLowerCase() === "done") {
                setDone(true);
                source.close();
            }
        });

        // Fetch phase: take ONLY fetched + total. `success` here is this one
        // enrollee's HIS-fetch outcome (a boolean), not the cumulative tally —
        // merging it would clobber the real success count with true/false.
        source.addEventListener("fetch_progress", (event) => {
            const p = JSON.parse(event.data);
            setProgress((prev) => ({
                ...prev,
                fetched: num(p.fetched ?? prev.fetched),
                total: num(p.total ?? prev.total),
            }));
        });

        // Generate phase: cumulative completed/success/failed (+ total, status).
        source.addEventListener("generate_progress", (event) => {
            const p = JSON.parse(event.data);
            setProgress((prev) => mergeCounts(prev, p));
        });

        source.addEventListener("complete", (event) => {
            const p = JSON.parse(event.data);
            setProgress((prev) => mergeCounts(prev, p));
            setDone(true);
            source.close();
        });

        // Server-sent logical errors carry a JSON body; native transport
        // errors (drop/close) fire the same event with no data.
        source.addEventListener("error", (event) => {
            if (event.data) {
                let message = "Connection lost";
                try {
                    message = JSON.parse(event.data).message || message;
                } catch {
                    /* keep default */
                }
                if (message === NO_JOB_MSG) {
                    setNoJob(true);
                } else {
                    setError(message);
                }
            } else {
                setError("Connection lost");
            }
            source.close();
        });

        return () => source.close();
    }, [batchId, attempt]);

    return { progress, done, error, noJob };
}
