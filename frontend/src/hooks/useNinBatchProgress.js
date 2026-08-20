import { useEffect, useState } from "react";
import { connectNinBatch } from "../api/nin";

const PHASES = ["validating", "merging", "breakdown", "report"];

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function merge(prev, p) {
    return {
        ...prev,
        ...p,
        completed: num(p.completed ?? prev.completed),
        total: num(p.total ?? prev.total),
    };
}

export default function useNinBatchProgress(jobId) {
    const [progress, setProgress] = useState({});
    const [phase, setPhase] = useState(null);
    const [done, setDone] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!jobId) return;

        setProgress({});
        setPhase(null);
        setDone(false);
        setError(null);

        const source = connectNinBatch(jobId);

        source.addEventListener("status", (event) => {
            const p = JSON.parse(event.data);
            setProgress((prev) => merge(prev, p));
            const currentStatus = p.status ? String(p.status).toLowerCase() : null;
            if (currentStatus === "done") {
                setPhase("done");
                setDone(true);
                source.close();
            } else {
                setPhase(PHASES.includes(currentStatus) ? currentStatus : null);
                setDone(false);
            }
        });

        for (const name of PHASES) {
            source.addEventListener(name, (event) => {
                const p = JSON.parse(event.data);
                setPhase(name);
                setDone(false);
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
