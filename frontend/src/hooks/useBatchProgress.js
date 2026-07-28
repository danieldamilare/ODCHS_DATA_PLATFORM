import { useEffect, useState, useRef } from "react";
import { connectBatch } from "../api/enrollment";

export default function useBatchProgress(batchId) {
    const [progress, setProgress] = useState({});
    const [events, setEvents] = useState([]);
    const [done, setDone] = useState(false);
    const sourceRef = useRef(null);

    useEffect(() => {
        if (!batchId) return;

        const source = connectBatch(batchId);
        sourceRef.current = source;

        source.addEventListener("status", (event) => {
            setProgress(JSON.parse(event.data));
        });

        source.addEventListener("form_ready", (event) => {
            const payload = JSON.parse(event.data);
            setEvents((old) => [payload, ...old]);
        });

        source.addEventListener("complete", (event) => {
            setProgress(JSON.parse(event.data));
            setDone(true);
            source.close();
        });

        source.addEventListener("error", () => {
            source.close();
        });

        return () => source.close();
    }, [batchId]);

    return { progress, events, done };
}
