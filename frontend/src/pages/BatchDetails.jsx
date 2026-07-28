import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getBatchDetail, getBatchForms } from "../api/enrollment";
import useBatchProgress from "../hooks/useBatchProgress";
import StatusBadge from "../components/ui/StatusBadge";
import { ArrowLeft, ChevronRight, Play, Loader2, Zap } from "lucide-react";

const STATUS_LABELS = {
    extracting: "EXTRACTING ZIP...",
    processing: "PROCESSING FORMS...",
    done: "PROCESSING COMPLETE",
};

export default function BatchDetails() {
    const { batchId } = useParams();
    const navigate = useNavigate();
    const [batch, setBatch] = useState(null);
    const [forms, setForms] = useState([]);
    const [filter, setFilter] = useState("all");
    const [loading, setLoading] = useState(true);
    const [loadingForms, setLoadingForms] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const queueRef = useRef(null);

    const { progress, events, done: sseDone } = useBatchProgress(batchId);

    useEffect(() => {
        getBatchDetail(batchId)
            .then((res) => setBatch(res.data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [batchId]);

    const isDone = batch?.status === "DONE" || batch?.status === "done" || sseDone || progress.status === "done";

    useEffect(() => {
        if (isDone && forms.length === 0) fetchForms();
    }, [isDone]);

    async function fetchForms(after) {
        setLoadingForms(true);
        try {
            const statusParam = filter === "all" ? undefined : filter;
            const res = await getBatchForms(batchId, { status: statusParam, after, count: 50 });
            setForms((prev) => after ? [...prev, ...(res.data || [])] : (res.data || []));
            setHasMore(res.has_more || false);
        } catch {}
        finally { setLoadingForms(false); }
    }

    useEffect(() => {
        if (isDone) { setForms([]); fetchForms(); }
    }, [filter]);

    const [streamQueue, setStreamQueue] = useState([]);
    useEffect(() => {
        if (events.length === 0) return;
        setStreamQueue((prev) => {
            const existing = new Set(prev.map((f) => f.id));
            const fresh = events.filter((e) => !existing.has(e.id));
            return [...fresh, ...prev];
        });
    }, [events]);

    useEffect(() => {
        if (queueRef.current) queueRef.current.scrollTop = 0;
    }, [streamQueue]);

    useEffect(() => {
        if (sseDone) getBatchDetail(batchId).then((res) => setBatch(res.data)).catch(() => {});
    }, [sseDone]);

    const total = batch?.total || Number(progress.total) || 0;
    const processed = Number(progress.done) || 0;
    const percent = total === 0 ? 0 : Math.round((processed / total) * 100);
    const statusText = progress.status || batch?.status?.toLowerCase() || "—";
    const summary = batch?.summary || {};
    const readyCount = summary.ready || 0;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 text-slate-400">
                <Loader2 size={24} className="animate-spin" />
            </div>
        );
    }

    if (!batch) {
        return <div className="p-8 text-slate-400">Batch not found</div>;
    }

    return (
        <div className="p-8 space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate("/enrollment")} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
                        <ArrowLeft size={20} className="text-slate-500" />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">Batch {batch.id?.slice(0, 8)}</h1>
                        <p className="text-sm text-slate-500">{total} forms</p>
                    </div>
                </div>
                {isDone && readyCount > 0 && (
                    <button
                        onClick={() => navigate(`/enrollment/batches/${batchId}/review`)}
                        className="flex items-center gap-2 gradient-primary rounded-xl text-white px-6 py-2.5 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all"
                    >
                        <Play size={16} />
                        Start Review ({readyCount})
                    </button>
                )}
            </div>

            {/* LIVE STREAM VIEW */}
            {!isDone && (
                <div className="rounded-2xl bg-slate-900 text-white overflow-hidden shadow-elevated">
                    <div className="flex items-center justify-between px-6 py-5">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-white/10">
                                <Zap size={18} className="text-amber-400" />
                            </div>
                            <h2 className="font-semibold text-base">Pipeline Live Stream</h2>
                        </div>
                        <span className={`px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide ${
                            statusText === "done" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        }`}>
                            {STATUS_LABELS[statusText] || statusText}
                        </span>
                    </div>

                    <div className="px-6 pb-5">
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                            <span>{processed} of {total} forms</span>
                            <span className="font-mono font-bold text-white">{percent}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-700/60 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300 transition-all duration-500"
                                style={{ width: `${percent}%`, boxShadow: "0 0 12px rgba(52, 211, 153, 0.4)" }}
                            />
                        </div>
                    </div>

                    <div className="px-6 pb-4">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Output Queue</p>
                        <div ref={queueRef} className="max-h-52 overflow-y-auto rounded-xl bg-slate-800/60 border border-slate-700/50 custom-scrollbar">
                            {streamQueue.length === 0 ? (
                                <div className="p-6 text-center text-slate-500 text-sm">Waiting for forms...</div>
                            ) : (
                                <div className="divide-y divide-slate-700/40">
                                    {streamQueue.map((f) => (
                                        <div key={f.id} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-700/20 transition-colors">
                                            <span className="text-slate-300 font-medium">
                                                {f.surname || f.firstname
                                                    ? `${f.surname || ""} ${f.firstname || ""}`.trim()
                                                    : <span className="text-slate-500 font-mono text-xs">{f.id.slice(0, 8)}</span>
                                                }
                                            </span>
                                            <StatusBadgeDark status={f.status} />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* DONE VIEW */}
            {isDone && (
                <>
                    <div className="flex flex-wrap gap-2">
                        <FilterChip label={`All · ${total}`} active={filter === "all"} onClick={() => setFilter("all")} />
                        {Object.entries(summary).map(([status, count]) => (
                            <FilterChip
                                key={status}
                                label={`${status.replace("_", " ")} · ${count}`}
                                active={filter === status}
                                onClick={() => setFilter(filter === status ? "all" : status)}
                            />
                        ))}
                    </div>

                    <div className="card overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100/80">
                            <h2 className="font-semibold text-slate-800">Forms</h2>
                        </div>

                        {loadingForms && forms.length === 0 ? (
                            <div className="p-12 text-center">
                                <div className="inline-block w-6 h-6 border-2 border-slate-200 border-t-primary-500 rounded-full animate-spin" />
                            </div>
                        ) : forms.length === 0 ? (
                            <div className="p-12 text-center text-slate-400">No forms match this filter</div>
                        ) : (
                            <>
                                <table className="w-full">
                                    <thead>
                                        <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100/80">
                                            <th className="px-6 py-3 font-semibold">#</th>
                                            <th className="px-6 py-3 font-semibold">Name</th>
                                            <th className="px-6 py-3 font-semibold">Status</th>
                                            <th className="px-6 py-3 font-semibold w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {forms.map((form, i) => (
                                            <tr
                                                key={form.id}
                                                onClick={() => navigate(`/enrollment/form/${form.id}`)}
                                                className="border-b border-slate-50 hover:bg-primary-50/30 cursor-pointer transition-colors group"
                                            >
                                                <td className="px-6 py-3.5 text-xs text-slate-400 font-mono">{form.sequence ?? i + 1}</td>
                                                <td className="px-6 py-3.5 text-sm font-medium text-slate-700 group-hover:text-primary-700 transition-colors">
                                                    {form.surname || form.firstname
                                                        ? `${form.surname || ""} ${form.firstname || ""}`.trim()
                                                        : <span className="text-slate-400 italic">—</span>
                                                    }
                                                </td>
                                                <td className="px-6 py-3.5"><StatusBadge status={form.status} /></td>
                                                <td className="px-6 py-3.5 text-slate-300 group-hover:text-primary-400 transition-colors"><ChevronRight size={16} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {hasMore && (
                                    <div className="py-4 text-center border-t border-slate-100/80">
                                        <button
                                            onClick={() => fetchForms(forms[forms.length - 1]?.id)}
                                            disabled={loadingForms}
                                            className="text-sm text-primary-600 hover:text-primary-700 font-semibold disabled:opacity-50 transition-colors"
                                        >
                                            {loadingForms ? "Loading..." : "Load more"}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function FilterChip({ label, active, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-all capitalize ${
                active
                    ? "gradient-primary text-white border-transparent shadow-md shadow-primary-500/20"
                    : "bg-white text-slate-600 border-slate-200 hover:border-primary-300 hover:text-primary-700"
            }`}
        >
            {label}
        </button>
    );
}

function StatusBadgeDark({ status }) {
    const colours = {
        ready: "text-emerald-400",
        error: "text-red-400",
        need_rescan: "text-amber-400",
    };
    return (
        <span className={`text-xs font-semibold uppercase ${colours[status?.toLowerCase()] || "text-slate-400"}`}>
            {status}
        </span>
    );
}
