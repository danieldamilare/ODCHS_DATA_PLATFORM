import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, CheckCircle2, XCircle, Loader2, RefreshCw, CreditCard } from "lucide-react";
import { startIdCards, downloadBatchIdcards } from "../api/enrollment";
import useIdCardProgress from "../hooks/useIdCardProgress";
import { useToast } from "../components/ui/Toast";

/**
 * Batch ID card generation job page.
 *
 * State machine (reconnect-safe):
 * - IDLE → page owns POST (once on mount, or on Retry click)
 * - STARTING → back off 2s when hook reports `noJob`, bump attempt to reconnect
 * - RUNNING → fetch phase (show fetched/total), then generation (show completed/total)
 * - DONE → show success/failed counts, Download ZIP button, Retry button (re-POST for failures)
 * - ERROR → show error, Retry button (re-POST)
 *
 * The POST hands off to Celery; the KV status key isn't set until the worker picks it up.
 * SSE opens immediately and answers "No generation job has started" if the key isn't there yet.
 * That's a race, not a failure → back off and reconnect (hook depends on `attempt`).
 */
export default function IdCardJob() {
    const { batchId } = useParams();
    const navigate = useNavigate();
    const toast = useToast();

    const [phase, setPhase] = useState("idle"); // idle | starting | running | done | error
    const [attempt, setAttempt] = useState(0);
    const [downloading, setDownloading] = useState(false);

    const { progress, done, error, noJob } = useIdCardProgress(batchId, attempt);

    // Page owns POST — call once on mount
    useEffect(() => {
        post(false);
    }, []);

    async function post(isRetry) {
        setPhase("starting");
        try {
            await startIdCards(batchId);
            // POST hands off to Celery; the worker sets the KV status key a
            // moment later. On retry the previous run's "done" lingers in KV
            // until the worker overwrites it, so wait longer before opening
            // the stream to avoid reading stale terminal state.
            const delay = isRetry ? 2500 : 400;
            setTimeout(() => setAttempt((a) => a + 1), delay);
        } catch (err) {
            setPhase("error");
            toast.error(err?.msg || "Could not start generation");
        }
    }

    // Race backoff: stream opened but the worker hasn't set the KV key yet → reconnect
    useEffect(() => {
        if (noJob && phase === "starting") {
            const timer = setTimeout(() => setAttempt((a) => a + 1), 2000);
            return () => clearTimeout(timer);
        }
    }, [noJob, phase]);

    // Once we get a total, we're connected → running. Guard on !done so the
    // all-cached path (complete arrives at connect, total + done in one batch)
    // doesn't flip through running.
    useEffect(() => {
        if (phase === "starting" && progress.total && !done) {
            setPhase("running");
        }
    }, [phase, progress.total, done]);

    // Terminal. Allow starting → done directly (all-cached completes before we
    // ever see a running frame), not just running → done.
    useEffect(() => {
        if (done && phase !== "done" && phase !== "error") setPhase("done");
    }, [done, phase]);

    useEffect(() => {
        if (error && phase !== "error") {
            setPhase("error");
            toast.error(error);
        }
    }, [error, phase]);

    async function handleDownload() {
        setDownloading(true);
        try {
            await downloadBatchIdcards(batchId);
        } catch (err) {
            toast.error(err?.msg || "Download failed");
        } finally {
            setDownloading(false);
        }
    }

    const total = progress.total || 0;
    const fetched = progress.fetched || 0;
    const completed = progress.completed || 0;
    const success = progress.success || 0;
    const failed = progress.failed || 0;
    const status = (progress.status || "").toLowerCase();

    // Status-derived phase label
    let statusLabel = "Starting...";
    if (phase === "running") {
        // status is authoritative once the worker's hset lands; until then
        // fetch_progress (no status field) can arrive with status still
        // "started" — fall back to the fetched count so we don't show "Processing".
        if (status === "generating") statusLabel = "Generating cards";
        else if (status === "fetching" || fetched > 0) statusLabel = "Fetching from HIS";
        else statusLabel = "Processing";
    } else if (phase === "done") {
        statusLabel = "Complete";
    } else if (phase === "error") {
        statusLabel = "Failed";
    }

    const percentFetched = total > 0 ? Math.round((fetched / total) * 100) : 0;
    const percentCompleted = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
        <div className="p-8 space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate(`/enrollment/batches/${batchId}`)}
                        className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
                    >
                        <ArrowLeft size={20} className="text-slate-500" />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">ID Card Generation</h1>
                        <p className="text-sm text-slate-500">Batch {batchId.slice(0, 8)}</p>
                    </div>
                </div>

                {phase === "done" && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => post(true)}
                            disabled={failed === 0}
                            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-primary-300 hover:text-primary-700 hover:bg-primary-50/40 transition-all disabled:opacity-40"
                        >
                            <RefreshCw size={14} />
                            Retry Failed
                        </button>
                        <button
                            onClick={handleDownload}
                            disabled={downloading || success === 0}
                            className="flex items-center gap-2 gradient-primary rounded-xl text-white px-6 py-2.5 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-50"
                        >
                            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            Download ZIP
                        </button>
                    </div>
                )}
            </div>

            <div className="card p-8 space-y-6">
                {/* Status banner */}
                <div className="flex items-center justify-between pb-6 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${
                            phase === "done" ? "bg-emerald-50" :
                            phase === "error" ? "bg-red-50" :
                            "bg-primary-50"
                        }`}>
                            {phase === "done" ? <CheckCircle2 size={20} className="text-emerald-600" /> :
                             phase === "error" ? <XCircle size={20} className="text-red-600" /> :
                             <CreditCard size={20} className="text-primary-600" />}
                        </div>
                        <div>
                            <h2 className="font-semibold text-slate-900">{statusLabel}</h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                {phase === "starting" && noJob && "Worker starting..."}
                                {phase === "starting" && !noJob && "Connecting..."}
                                {phase === "running" && `${completed} of ${total} processed`}
                                {phase === "done" && `${success} succeeded, ${failed} failed`}
                                {phase === "error" && error}
                            </p>
                        </div>
                    </div>
                    {phase === "starting" && <Loader2 size={20} className="animate-spin text-slate-400" />}
                </div>

                {/* Fetch phase progress (only when fetching or after) */}
                {(status === "fetching" || fetched > 0) && (
                    <div>
                        <div className="flex items-center justify-between text-sm mb-2">
                            <span className="font-medium text-slate-700">Fetching from HIS</span>
                            <span className="font-mono text-xs text-slate-500">{fetched} / {total}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-blue-400 to-blue-300 transition-all duration-500"
                                style={{ width: `${percentFetched}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Generate phase progress (only when generating or after) */}
                {(status === "generating" || status === "done" || completed > 0) && (
                    <div>
                        <div className="flex items-center justify-between text-sm mb-2">
                            <span className="font-medium text-slate-700">Generating cards</span>
                            <span className="font-mono text-xs text-slate-500">{completed} / {total}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-emerald-400 to-emerald-300 transition-all duration-500"
                                style={{ width: `${percentCompleted}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Summary stats (done phase) */}
                {phase === "done" && (
                    <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-100">
                        <div className="text-center p-4 rounded-xl bg-slate-50">
                            <div className="text-2xl font-bold text-slate-900">{total}</div>
                            <div className="text-xs text-slate-500 mt-1">Total</div>
                        </div>
                        <div className="text-center p-4 rounded-xl bg-emerald-50">
                            <div className="text-2xl font-bold text-emerald-700">{success}</div>
                            <div className="text-xs text-emerald-600 mt-1">Success</div>
                        </div>
                        <div className="text-center p-4 rounded-xl bg-red-50">
                            <div className="text-2xl font-bold text-red-700">{failed}</div>
                            <div className="text-xs text-red-600 mt-1">Failed</div>
                        </div>
                    </div>
                )}

                {/* Error retry */}
                {phase === "error" && (
                    <div className="pt-4 border-t border-slate-100 text-center">
                        <button
                            onClick={() => post(true)}
                            className="flex items-center gap-2 gradient-primary rounded-xl text-white px-6 py-2.5 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all mx-auto"
                        >
                            <RefreshCw size={14} />
                            Retry
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
