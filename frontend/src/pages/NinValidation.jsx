import { useState, useEffect, useRef } from "react";
import {
    ShieldCheck, ShieldAlert, AlertTriangle, Loader2, RefreshCw,
    ScanLine, Upload, FileSpreadsheet, Download, CheckCircle2, XCircle, X,
} from "lucide-react";
import { verifyNin, startNinBatch, getNinBatchStatus, downloadNinBatch } from "../api/nin";
import useNinBatchProgress from "../hooks/useNinBatchProgress";
import { useToast } from "../components/ui/Toast";

/**
 * Standalone NIN validation tool.
 *
 *  - Single: one DOB + NIN → live verdict against the government service.
 *  - Batch:  upload a csv/xlsx of dob,nin (+ optional lga/ward/facility) → a
 *            Celery job validates every row; stream progress, then download the
 *            annotated result, an optional LGA breakdown, and an optional PDF.
 */
export default function NinValidation() {
    const [tab, setTab] = useState("single");

    return (
        <div className="p-8 space-y-6 animate-fade-in">
            <div>
                <h1 className="text-2xl font-bold gradient-text inline-block">NIN Validation</h1>
                <p className="text-sm text-slate-500 mt-1">Verify a single NIN or validate a whole spreadsheet</p>
            </div>

            <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <TabButton active={tab === "single"} onClick={() => setTab("single")} icon={ScanLine}>Single Check</TabButton>
                <TabButton active={tab === "batch"} onClick={() => setTab("batch")} icon={FileSpreadsheet}>Batch Validation</TabButton>
            </div>

            {tab === "single" ? <SingleCheck /> : <BatchValidation />}
        </div>
    );
}

function TabButton({ active, onClick, icon: Icon, children }) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
        >
            <Icon size={15} />
            {children}
        </button>
    );
}

/* ═══════════════════════ Single check ═══════════════════════ */

function SingleCheck() {
    const [dob, setDob] = useState("");
    const [nin, setNin] = useState("");
    const [result, setResult] = useState(null); // {status, details, message}
    const [checking, setChecking] = useState(false);

    const eligible = /^\d{11}$/.test(nin) && !!dob;

    async function handleVerify() {
        if (!eligible || checking) return;
        setChecking(true);
        setResult(null);
        const res = await verifyNin(dob, nin);
        setResult(res);
        setChecking(false);
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
            <div className="card p-6 space-y-5">
                <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Date of Birth</label>
                    <input
                        type="date" value={dob} onChange={(e) => setDob(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm input-focus"
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">NIN</label>
                    <input
                        type="text" value={nin} placeholder="00000000000"
                        onChange={(e) => setNin(e.target.value.replace(/\D/g, "").slice(0, 11))}
                        onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
                        className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm input-focus font-mono tracking-wide"
                        maxLength={11}
                    />
                    <p className="text-[11px] text-slate-400 mt-1">{nin.length}/11 digits</p>
                </div>
                <button
                    onClick={handleVerify} disabled={!eligible || checking}
                    className="w-full gradient-primary rounded-xl text-white py-2.5 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                >
                    {checking ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />}
                    {checking ? "Verifying…" : "Verify NIN"}
                </button>
            </div>

            <SingleResult result={result} checking={checking} />
        </div>
    );
}

const SINGLE_TONES = {
    valid: { card: "border-emerald-200 bg-emerald-50/50", icon: "text-emerald-500", title: "text-emerald-800", Icon: ShieldCheck, heading: "NIN verified" },
    invalid: { card: "border-red-200 bg-red-50/50", icon: "text-red-500", title: "text-red-800", Icon: ShieldAlert, heading: "NIN could not be matched" },
    error: { card: "border-amber-200 bg-amber-50/50", icon: "text-amber-500", title: "text-amber-800", Icon: AlertTriangle, heading: "Couldn't verify NIN" },
};

function SingleResult({ result, checking }) {
    if (checking) {
        return (
            <div className="card p-6 flex items-center justify-center text-slate-400">
                <Loader2 size={22} className="animate-spin" />
            </div>
        );
    }
    if (!result) {
        return (
            <div className="card p-6 flex flex-col items-center justify-center text-center text-slate-400 border-dashed">
                <ScanLine size={30} className="mb-2 text-slate-300" />
                <p className="text-sm">Enter a date of birth and NIN, then verify.</p>
            </div>
        );
    }

    const tone = SINGLE_TONES[result.status] || SINGLE_TONES.error;
    const Icon = tone.Icon;
    const d = result.details;

    return (
        <div className={`card p-6 border ${tone.card} space-y-4`}>
            <div className="flex items-start gap-3">
                <Icon size={22} className={`${tone.icon} shrink-0 mt-0.5`} />
                <div>
                    <h3 className={`font-semibold ${tone.title}`}>{tone.heading}</h3>
                    {result.message && <p className="text-xs text-slate-500 mt-0.5">{result.message}</p>}
                </div>
            </div>

            {result.status === "valid" && d && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 border-t border-emerald-100">
                    <Detail label="First Name" value={d.firstName} />
                    <Detail label="Middle Name" value={d.middleName} />
                    <Detail label="Last Name" value={d.lastName} />
                    <Detail label="Date of Birth" value={d.dateOfBirth} />
                    <Detail label="Gender" value={d.gender} />
                </dl>
            )}
        </div>
    );
}

function Detail({ label, value }) {
    return (
        <div>
            <dt className="text-[11px] text-slate-400 uppercase tracking-wide">{label}</dt>
            <dd className="text-sm font-medium text-slate-800 mt-0.5">{value || "—"}</dd>
        </div>
    );
}

/* ═══════════════════════ Batch validation ═══════════════════════ */

const ACCEPT = ".csv,.xlsx,.xls";

function BatchValidation() {
    const toast = useToast();
    const [file, setFile] = useState(null);
    const [generateReport, setGenerateReport] = useState(false);
    const [aggregateBy, setAggregateBy] = useState("none"); // none | ward | facility
    const [jobId, setJobId] = useState(null);
    const [phase, setPhase] = useState("form"); // form | submitting | running | done | error
    const [meta, setMeta] = useState(null); // {aggregate, generate_report} — download gating
    const fileRef = useRef();

    const { progress, phase: streamPhase, done, error } = useNinBatchProgress(jobId);

    async function handleSubmit() {
        if (!file) { toast.warn("Choose a csv or excel file first"); return; }
        setPhase("submitting");
        try {
            const res = await startNinBatch({
                file,
                generateReport,
                aggregateBy: aggregateBy === "none" ? null : aggregateBy,
            });
            if (res.duplicate) toast.warn(res.msg);
            else toast.success(res.msg);
            if (!res.jobId) throw { msg: "Server did not return a job reference" };
            setJobId(res.jobId);
            setPhase("running");
        } catch (err) {
            setPhase("form");
            toast.error(err?.msg || "Could not start validation");
        }
    }

    // Terminal → capture the authoritative artefact flags for download gating.
    // (A duplicate job that was already done never streams a status snapshot,
    // so we can't trust local form selections — ask the backend.)
    useEffect(() => {
        if (!done || !jobId) return;
        setPhase("done");
        getNinBatchStatus(jobId)
            .then((s) => setMeta({ aggregate: s.aggregate, generate_report: s.generate_report }))
            .catch(() => setMeta({ aggregate: progress.aggregate, generate_report: progress.generate_report }));
    }, [done, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (error) { setPhase("error"); toast.error(error); }
    }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

    function reset() {
        setJobId(null);
        setPhase("form");
        setMeta(null);
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
    }

    if (phase !== "form" && phase !== "submitting") {
        return (
            <BatchProgress
                progress={progress} streamPhase={streamPhase} phase={phase}
                error={error} jobId={jobId} meta={meta} onReset={reset}
            />
        );
    }

    const submitting = phase === "submitting";

    return (
        <div className="card p-7 space-y-6 max-w-2xl">
            {/* File picker */}
            <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2">Spreadsheet</label>
                <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
                    onChange={(e) => setFile(e.target.files[0] || null)} />
                {!file ? (
                    <button
                        onClick={() => fileRef.current?.click()}
                        className="w-full rounded-xl border-2 border-dashed border-slate-200 py-10 flex flex-col items-center gap-2 text-slate-400 hover:border-primary-300 hover:text-primary-500 hover:bg-primary-50/30 transition-all"
                    >
                        <Upload size={26} />
                        <span className="text-sm font-medium">Click to choose a .csv or .xlsx file</span>
                        <span className="text-[11px]">Must contain <span className="font-mono">dob</span> and <span className="font-mono">nin</span> columns</span>
                    </button>
                ) : (
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <FileSpreadsheet size={20} className="text-primary-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                            <p className="text-[11px] text-slate-400">{(file.size / 1024).toFixed(0)} KB</p>
                        </div>
                        <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 transition-colors">
                            <X size={15} />
                        </button>
                    </div>
                )}
            </div>

            {/* Options */}
            <div className="space-y-4">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input type="checkbox" checked={generateReport} onChange={(e) => setGenerateReport(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
                    <span>
                        <span className="block text-sm font-medium text-slate-700">Generate PDF report</span>
                        <span className="block text-[11px] text-slate-400">Charts + valid/invalid breakdown. Needs lga, ward &amp; facility columns.</span>
                    </span>
                </label>

                <div>
                    <p className="text-xs font-semibold text-slate-500 mb-2">LGA breakdown</p>
                    <div className="flex flex-wrap gap-2">
                        {[
                            { v: "none", label: "None" },
                            { v: "ward", label: "By ward" },
                            { v: "facility", label: "By facility" },
                        ].map((o) => (
                            <button key={o.v} onClick={() => setAggregateBy(o.v)}
                                className={`rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-all ${
                                    aggregateBy === o.v
                                        ? "border-primary-300 bg-primary-50 text-primary-700"
                                        : "border-slate-200 text-slate-500 hover:bg-slate-50"
                                }`}>
                                {o.label}
                            </button>
                        ))}
                    </div>
                    {aggregateBy !== "none" && (
                        <p className="text-[11px] text-slate-400 mt-1.5">Needs lga, ward &amp; facility columns in the file.</p>
                    )}
                </div>
            </div>

            <button
                onClick={handleSubmit} disabled={!file || submitting}
                className="w-full gradient-primary rounded-xl text-white py-3 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />}
                {submitting ? "Starting…" : "Start Validation"}
            </button>
        </div>
    );
}

const PHASE_LABELS = {
    loading: "Preparing file…",
    validating: "Validating NINs",
    merging: "Assembling results",
    breakdown: "Building LGA breakdown",
    report: "Rendering PDF report",
    done: "Complete",
};

function BatchProgress({ progress, streamPhase, phase, error, jobId, meta, onReset }) {
    const [downloading, setDownloading] = useState(null); // which type is downloading
    const toast = useToast();

    const total = progress.total || 0;
    const completed = progress.completed || 0;
    const status = (progress.status || "").toLowerCase();
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const isDone = phase === "done";
    const isError = phase === "error";
    const label = isError ? "Validation failed" : PHASE_LABELS[status] || PHASE_LABELS[streamPhase] || "Working…";

    // Download availability. Prefer the backend's authoritative flags (meta);
    // fall back to the connect-time snapshot the stream merged into progress.
    const truthy = (v) => v != null && !["", "false", "0", "none"].includes(String(v).toLowerCase());
    const hasBreakdown = truthy(meta?.aggregate ?? progress.aggregate);
    const hasReport = truthy(meta?.generate_report ?? progress.generate_report);

    async function download(type) {
        setDownloading(type);
        try {
            await downloadNinBatch(jobId, type);
        } catch (err) {
            toast.error(err?.msg || "Download failed");
        } finally {
            setDownloading(null);
        }
    }

    return (
        <div className="card p-8 space-y-6 max-w-2xl">
            <div className="flex items-center justify-between pb-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${isDone ? "bg-emerald-50" : isError ? "bg-red-50" : "bg-primary-50"}`}>
                        {isDone ? <CheckCircle2 size={20} className="text-emerald-600" />
                            : isError ? <XCircle size={20} className="text-red-600" />
                                : <ScanLine size={20} className="text-primary-600" />}
                    </div>
                    <div>
                        <h2 className="font-semibold text-slate-900">{label}</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {isError ? (error || "Something went wrong")
                                : isDone ? `${total.toLocaleString()} record${total !== 1 ? "s" : ""} validated`
                                    : total > 0 ? `${completed.toLocaleString()} of ${total.toLocaleString()} processed`
                                        : "Counting records…"}
                        </p>
                    </div>
                </div>
                {!isDone && !isError && <Loader2 size={20} className="animate-spin text-slate-400" />}
            </div>

            {!isError && (
                <div>
                    <div className="flex items-center justify-between text-sm mb-2">
                        <span className="font-medium text-slate-700">Validation</span>
                        <span className="font-mono text-xs text-slate-500">
                            {total > 0 ? `${completed.toLocaleString()} / ${total.toLocaleString()}` : "…"}
                        </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                            className={`h-full transition-all duration-500 ${isDone ? "bg-gradient-to-r from-emerald-400 to-emerald-300" : "bg-gradient-to-r from-primary-400 to-primary-300"}`}
                            style={{ width: `${isDone ? 100 : pct}%` }}
                        />
                    </div>
                </div>
            )}

            {isDone && (
                <div className="space-y-3 pt-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Downloads</p>
                    <DownloadRow
                        label="Validated results" hint="Original rows annotated with nin_valid + reason"
                        onClick={() => download("result")} busy={downloading === "result"} available
                    />
                    <DownloadRow
                        label="LGA breakdown" hint="Per-LGA valid/invalid aggregates"
                        onClick={() => download("breakdown")} busy={downloading === "breakdown"} available={hasBreakdown}
                    />
                    <DownloadRow
                        label="PDF report" hint="Charts and summary"
                        onClick={() => download("report")} busy={downloading === "report"} available={hasReport}
                    />
                </div>
            )}

            <div className="pt-2">
                <button onClick={onReset}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-primary-300 hover:text-primary-700 hover:bg-primary-50/40 transition-all">
                    <RefreshCw size={14} />
                    {isError ? "Try another file" : "Validate another file"}
                </button>
            </div>
        </div>
    );
}

function DownloadRow({ label, hint, onClick, busy, available }) {
    return (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${available ? "border-slate-200" : "border-slate-100 bg-slate-50/50"}`}>
            <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${available ? "text-slate-700" : "text-slate-400"}`}>{label}</p>
                <p className="text-[11px] text-slate-400">{available ? hint : "Not generated for this job"}</p>
            </div>
            <button
                onClick={onClick} disabled={!available || busy}
                className="flex items-center gap-2 rounded-lg gradient-primary text-white px-4 py-2 text-xs font-semibold hover:shadow-md hover:shadow-primary-500/25 transition-all disabled:opacity-30 disabled:shadow-none shrink-0"
            >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                Download
            </button>
        </div>
    );
}
