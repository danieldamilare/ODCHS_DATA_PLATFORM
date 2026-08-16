import { useEffect, useRef, useState, useCallback } from "react";
import { verifyNin } from "../api/nin";

/**
 * Live NIN verification with debounce, latest-wins race guarding, and
 * skip-if-unchanged.
 *
 * Fires `verifyNin(dob, nin)` only when the NIN is a well-formed 11 digits and a
 * DOB is present. Terminal states mirror the API client:
 *   - "idle"      → not enough input to verify yet
 *   - "valid"     → NIN service matched (details populated)
 *   - "invalid"   → NIN service ran and found no match
 *   - "error"     → could not reach/complete verification (transient — retryable)
 *
 * `verifying` is a separate in-flight flag so the UI can show a spinner; while a
 * request is in flight `status` is "idle" and clears any stale prior verdict
 * (a changed NIN must never keep showing an old green check).
 *
 * @param {string} dob         ISO `YYYY-MM-DD` (backend parses flexibly anyway).
 * @param {string} nin         raw NIN string.
 * @param {object} [opts]
 * @param {*}      [opts.formKey]    changes per record (e.g. form id); when it
 *                                   changes, a pre-filled valid NIN verifies
 *                                   immediately instead of waiting out the debounce.
 * @param {number} [opts.debounceMs] keystroke debounce (default 500ms).
 * @returns {{status:string, details:object|null, verifying:boolean, message:string, reverify:function}}
 */
export default function useNinVerification(dob, nin, { formKey, debounceMs = 500 } = {}) {
    const [status, setStatus] = useState("idle");
    const [details, setDetails] = useState(null);
    const [message, setMessage] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [reverifyTick, setReverifyTick] = useState(0);

    // Monotonic request id: only the newest in-flight request may apply its result.
    const latestRef = useRef(0);
    // Last (dob|nin) pair we produced a verdict for — skip re-firing an identical pair.
    const lastKeyRef = useRef(null);
    // Detects a new record so a pre-filled NIN verifies without the typing delay.
    const formKeyRef = useRef(Symbol("init"));
    // Set by reverify() to bypass the skip-unchanged guard and skip the debounce.
    const forceRef = useRef(false);

    const reverify = useCallback(() => {
        forceRef.current = true;
        lastKeyRef.current = null;
        setReverifyTick((t) => t + 1);
    }, []);

    useEffect(() => {
        const eligible = /^\d{11}$/.test(nin) && !!dob;

        if (!eligible) {
            // Invalidate any pending request and reset to a clean idle state.
            latestRef.current += 1;
            lastKeyRef.current = null;
            formKeyRef.current = formKey;
            setStatus("idle");
            setDetails(null);
            setMessage("");
            setVerifying(false);
            return;
        }

        const key = `${dob}|${nin}`;
        const forced = forceRef.current;
        const isNewRecord = formKeyRef.current !== formKey;

        // Already have a verdict for this exact pair and nothing forced a redo.
        if (key === lastKeyRef.current && !forced) return;

        // Immediate for a freshly loaded record or an explicit retry; otherwise
        // debounce so we don't fire on every one of the 11 keystrokes.
        const delay = forced || isNewRecord ? 0 : debounceMs;
        forceRef.current = false;
        formKeyRef.current = formKey;

        setStatus("idle");
        setDetails(null);
        setMessage("");
        setVerifying(true);

        const requestId = (latestRef.current += 1);
        const timer = setTimeout(async () => {
            const result = await verifyNin(dob, nin);
            if (requestId !== latestRef.current) return; // superseded by a newer input
            lastKeyRef.current = key;
            setStatus(result.status);
            setDetails(result.details);
            setMessage(result.message);
            setVerifying(false);
        }, delay);

        return () => clearTimeout(timer);
    }, [dob, nin, formKey, debounceMs, reverifyTick]);

    return { status, details, verifying, message, reverify };
}
