import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    Upload,
    FileSpreadsheet,
    FileArchive,
    Loader2,
    ScanLine,
    CheckCircle2,
    XCircle,
    X,
    Download,
    RefreshCw,
    FileQuestion,
    Layers,
    Table,
    Files,
    ArrowRight,
    User,
    CreditCard,
    Users,
    Calendar,
    Activity,
    Check,
    AlertCircle,
    SkipForward,
    ChevronRight,
    Database,
    ClipboardList,
} from "lucide-react";
import {
    startEncounterJob,
    getEncounterStatus,
    answerEncounter,
    downloadEncounterReport,
} from "../api/encounter";
import useEncounterProgress from "../hooks/useEncounterProgress";
import { useToast } from "../components/ui/Toast";

const ACCEPT = ".zip,.csv,.xlsx,.xls,.ods";

export default function Encounter() {
    const { jobId } = useParams();
    return (
        <div className="animate-fade-in p-4 md:p-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-6">
                Encounter Analysis
                {jobId && <span className="ml-3 text-sm font-mono font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded">REF: {jobId.slice(0,8).toUpperCase()}</span>}
            </h1>
            {jobId ? <EncounterJob routeJobId={jobId} /> : <UploadForm />}
        </div>
    );
}

/* ═══════════════════════ Upload ═══════════════════════ */

function UploadForm() {
    const toast = useToast();
    const navigate = useNavigate();
    const fileRef = useRef();
    const [file, setFile] = useState(null);
    const [encounterType, setEncounterType] = useState("oranghis");
    const [chaiOnly, setChaiOnly] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    async function handleSubmit() {
        if (!file) {
            toast?.warn?.("Please choose an encounter file first");
            return;
        }
        setSubmitting(true);
        setUploadProgress(0);
        try {
            const res = await startEncounterJob({ 
                file, 
                encounterType, 
                chaiOnly,
                onProgress: (pct) => setUploadProgress(pct)
            });
            if (!res.ok) {
                toast?.error?.(res.msg);
                return;
            }
            if (!res.jobId) throw { msg: "Server did not return a job reference" };
            toast?.success?.(res.msg);
            navigate(`/encounter/${res.jobId}`);
        } catch (err) {
            toast?.error?.(err?.msg || "Could not start encounter job");
        } finally {
            setSubmitting(false);
            setUploadProgress(0);
        }
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
            {/* Main form column */}
            <div className="lg:col-span-8 space-y-5">

                {/* File upload card */}
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center">
                            <Upload size={15} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">Upload Encounter File</h3>
                            <p className="text-xs text-slate-500">Single spreadsheet or a .zip archive of multiple files</p>
                        </div>
                    </div>
                    <div className="p-5">
                        <input
                            ref={fileRef}
                            type="file"
                            accept={ACCEPT}
                            className="hidden"
                            onChange={(e) => setFile(e.target.files[0] || null)}
                        />

                        {!file ? (
                            <div
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    setIsDragging(false);
                                    if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
                                }}
                                onClick={() => fileRef.current?.click()}
                                className={`w-full rounded-lg border-2 border-dashed p-10 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer ${
                                    isDragging
                                        ? "border-slate-700 bg-slate-50"
                                        : "border-slate-200 hover:border-slate-400 hover:bg-slate-50/70"
                                }`}
                            >
                                <div className="p-3 rounded-lg bg-slate-100 text-slate-600">
                                    <Files size={22} />
                                </div>
                                <div className="text-center">
                                    <p className="text-sm font-semibold text-slate-700">
                                        Drag and drop, or{" "}
                                        <span className="text-slate-900 underline underline-offset-2">browse</span>
                                    </p>
                                    <p className="text-xs text-slate-400 mt-1">
                                        Accepted: .ZIP, .XLSX, .XLS, .CSV, .ODS
                                    </p>
                                </div>
                                <div className="flex items-center gap-1.5 mt-1">
                                    {[".ZIP", ".XLSX", ".CSV"].map((ext) => (
                                        <span
                                            key={ext}
                                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 font-mono border border-slate-200"
                                        >
                                            {ext}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 relative overflow-hidden">
                                {submitting && (
                                    <div 
                                        className="absolute inset-y-0 left-0 bg-slate-200/50 transition-all duration-300"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                )}
                                <div className="p-2.5 rounded-lg bg-slate-200 text-slate-700 relative z-10">
                                    {file.name.toLowerCase().endsWith(".zip") ? (
                                        <FileArchive size={20} />
                                    ) : (
                                        <FileSpreadsheet size={20} />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0 relative z-10">
                                    <p className="text-sm font-bold text-slate-800 truncate">{file.name}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        {(file.size / 1024).toFixed(1)} KB
                                    </p>
                                </div>
                                <button
                                    onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                                    disabled={submitting}
                                    className="p-1.5 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer relative z-10 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <X size={15} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Processing options card */}
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center">
                            <Database size={15} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">Processing Options</h3>
                            <p className="text-xs text-slate-500">Select encounter engine and output scope</p>
                        </div>
                    </div>
                    <div className="p-5 space-y-4">
                        {/* Engine selection */}
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">
                                Encounter Engine
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    {
                                        id: "oranghis",
                                        label: "ORANGHIS",
                                        desc: "Ondo State Health Insurance",
                                    },
                                    {
                                        id: "bhcpf",
                                        label: "BHCPF",
                                        desc: "Basic Health Care Provision Fund",
                                    },
                                ].map((engine) => (
                                    <button
                                        key={engine.id}
                                        type="button"
                                        disabled={submitting}
                                        onClick={() => setEncounterType(engine.id)}
                                        className={`text-left p-3.5 rounded-lg border-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                            encounterType === engine.id
                                                ? "border-slate-800 bg-slate-900 text-white"
                                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                                        }`}
                                    >
                                        <p className="text-xs font-black uppercase tracking-wider">
                                            {engine.label}
                                        </p>
                                        <p
                                            className={`text-[11px] mt-0.5 ${
                                                encounterType === engine.id
                                                    ? "text-slate-300"
                                                    : "text-slate-500"
                                            }`}
                                        >
                                            {engine.desc}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* CHAI only toggle */}
                        <div
                            onClick={() => !submitting && setChaiOnly(!chaiOnly)}
                            className={`flex items-center justify-between p-3.5 rounded-lg border-2 transition-all ${
                                submitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                            } ${
                                chaiOnly
                                    ? "border-slate-800 bg-slate-900"
                                    : "border-slate-200 hover:border-slate-400 hover:bg-slate-50"
                            }`}
                        >
                            <div>
                                <p
                                    className={`text-xs font-bold uppercase tracking-wide ${
                                        chaiOnly ? "text-white" : "text-slate-800"
                                    }`}
                                >
                                    CHAI Output Only
                                </p>
                                <p
                                    className={`text-[11px] mt-0.5 ${
                                        chaiOnly ? "text-slate-400" : "text-slate-500"
                                    }`}
                                >
                                    Restrict report generation to CHAI-format output
                                </p>
                            </div>
                            <div
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                                    chaiOnly
                                        ? "border-white bg-white"
                                        : "border-slate-300 bg-white"
                                }`}
                            >
                                {chaiOnly && <Check size={12} className="text-slate-900" />}
                            </div>
                        </div>

                        {/* Submit */}
                        <button
                            onClick={handleSubmit}
                            disabled={!file || submitting}
                            className="w-full relative overflow-hidden rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
                        >
                            <div 
                                className="absolute inset-0 bg-slate-800"
                                style={{
                                    background: submitting || !file ? "#94a3b8" : "linear-gradient(135deg, #1e293b 0%, #334155 100%)"
                                }}
                            />
                            {submitting && uploadProgress < 100 && (
                                <div 
                                    className="absolute inset-y-0 left-0 bg-slate-900/40 transition-all duration-300" 
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            )}
                            <div className="relative py-3 flex items-center justify-center gap-2 text-sm font-bold text-white z-10">
                                {submitting ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <ScanLine size={16} />
                                )}
                                {submitting 
                                    ? uploadProgress < 100 
                                        ? `Uploading... ${uploadProgress}%` 
                                        : "Starting analysis…" 
                                    : "Start Encounter Analysis"}
                            </div>
                        </button>
                    </div>
                </div>
            </div>

            {/* Right column — technical reference */}
            <div className="lg:col-span-4 space-y-5">
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center">
                            <ClipboardList size={15} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">Pipeline Overview</h3>
                            <p className="text-xs text-slate-500">Processing stages and requirements</p>
                        </div>
                    </div>
                    <div className="p-5">
                        <ol className="space-y-4">
                            {[
                                {
                                    n: 1,
                                    title: "File Extraction",
                                    body: "ZIP archives are unpacked; each spreadsheet file is staged independently for validation.",
                                },
                                {
                                    n: 2,
                                    title: "Sheet & Header Verification",
                                    body: "The engine auto-detects the active sheet and header row. Manual confirmation is requested only when detection fails.",
                                },
                                {
                                    n: 3,
                                    title: "Column Mapping",
                                    body: "Five required fields are mapped: client name, policy number, sex, age, diagnosis. Auto-matched by header text.",
                                },
                                {
                                    n: 4,
                                    title: "Encounter Analysis",
                                    body: "Each validated file is analysed concurrently. A combined encounter and utilisation report is generated on completion.",
                                },
                            ].map((step) => (
                                <li key={step.n} className="flex gap-3.5">
                                    <span className="shrink-0 w-6 h-6 rounded bg-slate-800 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">
                                        {step.n}
                                    </span>
                                    <div>
                                        <p className="text-xs font-bold text-slate-900">{step.title}</p>
                                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                                            {step.body}
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </div>
                </div>

                {/* Required columns reference */}
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-50 px-5 py-3 border-b border-slate-200">
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                            ORANGHIS — Required Column Headers
                        </p>
                    </div>
                    <div className="p-4">
                        <div className="space-y-2">
                            {[
                                ["Client Name", "Patient full name"],
                                ["Policy Number", "Insurance / ORIN identifier"],
                                ["Sex", "M / F classification"],
                                ["Age", "Age at encounter (years)"],
                                ["Diagnosis", "Primary clinical diagnosis"],
                            ].map(([col, desc]) => (
                                <div key={col} className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
                                    <span className="text-xs font-bold text-slate-800 font-mono">{col}</span>
                                    <span className="text-[11px] text-slate-500 text-right">{desc}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════════ Job (status-first, then stream) ═══════════════════════ */

function EncounterJob({ routeJobId }) {
    const navigate = useNavigate();
    const toast = useToast();
    const [activeJobId, setActiveJobId] = useState(null);
    const [phase, setPhase] = useState("checking"); // checking | running | done | not_found | error
    const [submitting, setSubmitting] = useState(false);

    const { progress, fileStatuses, pendingQuestion, done, error, clearPendingQuestion } =
        useEncounterProgress(activeJobId);

    useEffect(() => {
        setPhase("checking");
        getEncounterStatus(routeJobId)
            .then((s) => {
                const status = String(s.status || "").toLowerCase();
                if (status === "done") {
                    setActiveJobId(null);
                    setPhase("done");
                } else if (status === "failed") {
                    setActiveJobId(null);
                    setPhase("error");
                } else {
                    setActiveJobId(routeJobId);
                    setPhase("running");
                }
            })
            .catch(() => {
                setActiveJobId(null);
                setPhase("not_found");
            });
    }, [routeJobId]);

    useEffect(() => { if (done) setPhase("done"); }, [done]);

    useEffect(() => {
        if (error) {
            setPhase("error");
            toast?.error?.(error);
        }
    }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

    // Unblock the form if the question changes naturally via SSE
    useEffect(() => {
        setSubmitting(false);
    }, [pendingQuestion?.job_num]);

    function reset() { navigate("/encounter"); }

    async function submitAnswer(answer) {
        if (!pendingQuestion) return;
        const targetJobNum = pendingQuestion.job_num;
        setSubmitting(true);
        try {
            const res = await answerEncounter(routeJobId, targetJobNum, answer);
            if (res.success) {
                clearPendingQuestion(targetJobNum);
                toast?.success?.(res.msg || "Response recorded");
            } else {
                toast?.error?.(res.msg || "Could not submit response");
                setSubmitting(false);
            }
        } catch (err) {
            toast?.error?.(err?.msg || "Could not submit response");
            setSubmitting(false);
        }
    }

    if (phase === "checking") {
        return (
            <div className="bg-white rounded-lg border border-slate-200 p-12 max-w-lg flex flex-col items-center text-center gap-3">
                <Loader2 size={24} className="animate-spin text-slate-500" />
                <div>
                    <p className="text-sm font-bold text-slate-800">Locating Job Record</p>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono">{routeJobId.slice(0, 8).toUpperCase()}</p>
                </div>
            </div>
        );
    }

    if (phase === "not_found") return <JobNotFound jobId={routeJobId} onReset={reset} />;

    return (
        <ProgressView
            progress={progress}
            fileStatuses={fileStatuses}
            pendingQuestion={pendingQuestion}
            phase={phase}
            error={error}
            jobId={routeJobId}
            submitting={submitting}
            onSubmitAnswer={submitAnswer}
            onReset={reset}
        />
    );
}

function JobNotFound({ jobId, onReset }) {
    return (
        <div className="bg-white rounded-lg border border-slate-200 p-8 max-w-lg space-y-5">
            <div className="flex items-start gap-4">
                <div className="p-3 rounded-lg bg-slate-100 text-slate-600 shrink-0">
                    <FileQuestion size={22} />
                </div>
                <div>
                    <h2 className="text-sm font-bold text-slate-900">Job Not Found or Expired</h2>
                    <p className="text-xs text-slate-500 leading-relaxed mt-1">
                        No encounter job exists for reference{" "}
                        <span className="font-mono font-bold text-slate-800">{jobId.slice(0, 8).toUpperCase()}</span>.
                        Sessions expire automatically after 24 hours or when the cache is cleared.
                    </p>
                </div>
            </div>
            <div className="pt-3 border-t border-slate-100 flex justify-end">
                <button
                    onClick={onReset}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold text-white cursor-pointer"
                    style={{ background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)" }}
                >
                    <RefreshCw size={13} />
                    New Encounter Job
                </button>
            </div>
        </div>
    );
}

/* ═══════════════════════ Progress ═══════════════════════ */

const FILE_STATUS_STYLE = {
    queued:      { badge: "bg-slate-100 text-slate-600 border-slate-200",   dot: "bg-slate-400",    label: "Queued",     spin: false },
    validating:  { badge: "bg-blue-50 text-blue-700 border-blue-200",       dot: "bg-blue-500",     label: "Validating", spin: true  },
    needs_input: { badge: "bg-amber-50 text-amber-800 border-amber-200",    dot: "bg-amber-500",    label: "Input Required", spin: false },
    analysing:   { badge: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500",   label: "Analysing",  spin: true  },
    done:        { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500", label: "Complete",  spin: false },
    skipped:     { badge: "bg-slate-100 text-slate-500 border-slate-200",   dot: "bg-slate-400",    label: "Skipped",    spin: false },
    failed:      { badge: "bg-rose-50 text-rose-700 border-rose-200",       dot: "bg-rose-500",     label: "Failed",     spin: false },
};

function ProgressView({ progress, fileStatuses, pendingQuestion, phase, error, jobId, submitting, onSubmitAnswer, onReset }) {
    const [downloading, setDownloading] = useState(false);
    const toast = useToast();

    const isDone     = phase === "done";
    const isError    = phase === "error";
    const total      = progress.total      || 0;
    const files       = progress.files || {};
    const fileEntries = Object.entries(files)
        .map(([idx, name]) => [Number(idx), name])
        .sort((a, b) => a[0] - b[0]);

    // Compute counts from actual per-file statuses instead of inferring from global state.
    const validatedCount = fileEntries.filter(([idx]) => {
        const s = fileStatuses[idx];
        return s && s !== "queued" && s !== "validating" && s !== "needs_input";
    }).length;
    const analysedCount = fileEntries.filter(([idx]) => {
        const s = fileStatuses[idx];
        return s === "done" || s === "failed" || s === "skipped";
    }).length;

    const hasActiveValidation = fileEntries.some(([idx]) => {
        const s = fileStatuses[idx];
        return s === "queued" || s === "validating" || s === "needs_input";
    });
    const validationComplete = !hasActiveValidation || isDone;

    const pct = isDone
        ? 100
        : total > 0
        ? Math.round((analysedCount / total) * 100)
        : 0;

    const status     = String(progress.status || "").toLowerCase();
    const stageName = isError
        ? "Failed"
        : isDone
        ? "Complete"
        : status === "extracting"
        ? "Extracting"
        : validationComplete
        ? "Analysing"
        : "Validating";

    async function download() {
        setDownloading(true);
        try {
            await downloadEncounterReport(jobId);
        } catch (err) {
            toast?.error?.(err?.msg || "Download failed");
        } finally {
            setDownloading(false);
        }
    }

    return (
        <div className="space-y-6 w-full">

            {/* ── Status banner ── */}
            <div
                className="rounded-lg overflow-hidden border border-slate-700 shadow-md"
                style={{ background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)" }}
            >
                <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className={`p-2.5 rounded-lg ${
                            isDone ? "bg-emerald-500/20"
                            : isError ? "bg-rose-500/20"
                            : pendingQuestion ? "bg-amber-500/20"
                            : "bg-white/10"
                        }`}>
                            {isDone
                                ? <CheckCircle2 size={20} className="text-emerald-400" />
                                : isError
                                ? <XCircle size={20} className="text-rose-400" />
                                : pendingQuestion
                                ? <AlertCircle size={20} className="text-amber-400" />
                                : <ScanLine size={20} className="text-slate-300" />}
                        </div>
                        <div>
                            <div className="flex items-center gap-2.5">
                                <h2 className="text-base font-bold text-white">
                                    {isError
                                        ? "Processing Failed"
                                        : isDone
                                        ? "Analysis Complete"
                                        : pendingQuestion
                                        ? `Input Required — File ${pendingQuestion.job_num} of ${total}`
                                        : `Encounter Processing — ${stageName}`}
                                </h2>
                                {!isDone && !isError && !pendingQuestion && (
                                    <Loader2 size={15} className="animate-spin text-slate-400" />
                                )}
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
                                    isDone ? "bg-emerald-500/20 text-emerald-300"
                                    : isError ? "bg-rose-500/20 text-rose-300"
                                    : pendingQuestion ? "bg-amber-500/20 text-amber-300"
                                    : "bg-white/10 text-slate-300"
                                }`}>
                                    {pendingQuestion ? "Awaiting Response" : stageName}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 font-mono">
                                REF: {jobId.slice(0, 8).toUpperCase()}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {isDone && (
                            <button
                                onClick={download}
                                disabled={downloading}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-slate-800 text-xs font-bold hover:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                                {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                {downloading ? "Preparing…" : "Download Report"}
                            </button>
                        )}
                        <button
                            onClick={onReset}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-white/10 text-xs font-semibold transition-colors cursor-pointer"
                        >
                            <RefreshCw size={13} />
                            New Job
                        </button>
                    </div>
                </div>

                {/* Progress bar — replaced with input-required notice when a question is pending */}
                {!isError && pendingQuestion && (
                    <div className="px-6 pb-4">
                        <div className="flex items-center gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                            <AlertCircle size={13} className="text-amber-400 shrink-0" />
                            <p className="text-xs text-amber-300">
                                Processing is paused on file <span className="font-bold font-mono">{pendingQuestion.job_num}</span>.
                                Scroll down to provide the required information.
                            </p>
                        </div>
                    </div>
                )}
                {!isError && !pendingQuestion && (
                    <div className="px-6 pb-4">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1.5">
                            <span>
                                {validationComplete ? "Analysis progress" : "Validation progress"}
                            </span>
                            <span className="font-mono">{pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${isDone ? "bg-emerald-400" : "bg-sky-400"}`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* ── KPI strip ── */}
            {total > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                        {
                            label: "Total Files",
                            value: total,
                            bg: "bg-slate-800",
                        },
                        {
                            label: "Validated",
                            value: validatedCount,
                            bg: isDone ? "bg-emerald-700" : "bg-blue-800",
                        },
                        {
                            label: "Analysed",
                            value: analysedCount,
                            bg: isDone ? "bg-emerald-700" : "bg-indigo-800",
                        },
                        {
                            label: "Awaiting Input",
                            value: pendingQuestion ? 1 : 0,
                            bg: pendingQuestion ? "bg-amber-700" : "bg-slate-700",
                        },
                    ].map((kpi) => (
                        <div key={kpi.label} className={`${kpi.bg} rounded-lg p-4 text-white`}>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-white/60 mb-2">
                                {kpi.label}
                            </p>
                            <p className="text-3xl font-bold">{kpi.value}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Pending question (disambiguation studio) ── */}
            {!isDone && !isError && pendingQuestion && (
                <QuestionPanel
                    question={pendingQuestion}
                    submitting={submitting}
                    onSubmit={onSubmitAnswer}
                />
            )}

            {/* ── File queue table ── */}
            {fileEntries.length > 0 && (
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Files size={15} className="text-slate-500" />
                            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                                File Queue
                            </h3>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                            {fileEntries.length} file{fileEntries.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-slate-100">
                                <th className="px-5 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide w-10">#</th>
                                <th className="px-5 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide">File Name</th>
                                <th className="px-5 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {fileEntries.map(([idx, name]) => {
                                const stateKey = fileStatuses[idx] || "queued";
                                const st = FILE_STATUS_STYLE[stateKey] || FILE_STATUS_STYLE.queued;
                                return (
                                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                                        <td className="px-5 py-3 text-xs font-mono text-slate-400">{idx}</td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <FileSpreadsheet size={14} className="text-slate-400 shrink-0" />
                                                <span className="text-xs font-medium text-slate-700 truncate max-w-xs" title={name}>
                                                    {name}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <span className={`inline-flex items-center gap-1.5 border rounded px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${st.badge}`}>
                                                {st.spin
                                                    ? <Loader2 size={10} className="animate-spin" />
                                                    : <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />}
                                                {st.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════ Disambiguation Studio ═══════════════════════ */

const FIELD_META = {
    "client name":   { label: "Client / Patient Name",      icon: User,        desc: "Full name of the patient" },
    "policy number": { label: "Policy Number / ORIN",       icon: CreditCard,  desc: "Insurance policy identifier" },
    "sex":           { label: "Gender / Sex",               icon: Users,       desc: "M / F classification" },
    "age":           { label: "Age (Years)",                icon: Calendar,    desc: "Patient age at encounter" },
    "diagnosis":     { label: "Primary Diagnosis",          icon: Activity,    desc: "Clinical illness or condition" },
};

function cellText(v) {
    return v === null || v === undefined ? "" : String(v).trim();
}

function getSampleValues(rows, headerRow, colIdx, count = 2) {
    if (headerRow == null || colIdx == null || colIdx === "" || !Array.isArray(rows)) return [];
    const samples = [];
    for (let r = Number(headerRow) + 1; r < rows.length; r++) {
        const val = cellText(rows[r]?.[colIdx]);
        if (val && !samples.includes(val)) {
            samples.push(val);
            if (samples.length >= count) break;
        }
    }
    return samples;
}

function QuestionPanel({ question, submitting, onSubmit }) {
    if (question.state === "sheet_verification")
        return <SheetVerification question={question} submitting={submitting} onSubmit={onSubmit} />;
    if (question.state === "header_row_disambiguation")
        return <HeaderDisambiguation question={question} submitting={submitting} onSubmit={onSubmit} />;
    return null;
}

/* Studio card wrapper */
function StudioCard({ icon: Icon, stepLabel, title, hint, badge, children }) {
    return (
        <div className="bg-white border border-slate-300 shadow-sm overflow-hidden rounded-sm">
            {/* Header */}
            <div className="bg-slate-800 px-6 py-4 border-b border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded bg-slate-700/50 border border-slate-600 text-sky-400">
                        <Icon size={18} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            {stepLabel} — User Action Required
                        </p>
                        <h3 className="text-sm font-bold text-white mt-0.5">{title}</h3>
                    </div>
                </div>
                {badge}
            </div>
            <div className="p-6">{children}</div>
        </div>
    );
}

/* ── Sheet Verification ── */
function SheetVerification({ question, submitting, onSubmit }) {
    const sheets = useMemo(() => Object.keys(question.data || {}), [question]);
    const [active, setActive] = useState(sheets[0] ?? null);

    useEffect(() => { setActive(sheets[0] ?? null); }, [sheets]);

    const rows = (active != null && question.data[active]) || [];

    return (
        <StudioCard
            icon={Layers}
            stepLabel="Sheet Verification"
            title="Select the Encounter Data Sheet"
            hint="This workbook contains multiple sheets. Select the tab that holds the encounter records."
            badge={
                <span className="text-xs font-bold text-sky-300 bg-sky-500/20 border border-sky-500/30 px-3 py-1.5 rounded">
                    {sheets.length} Sheet{sheets.length !== 1 ? "s" : ""} Detected
                </span>
            }
        >
            <div className="space-y-4">
                {/* Sheet tabs */}
                <div className="flex flex-wrap gap-2 p-1.5 rounded-lg bg-slate-100 border border-slate-200">
                    {sheets.map((name) => {
                        const count = question.data?.[name]?.length || 0;
                        const isSel = active === name;
                        return (
                            <button
                                key={name}
                                type="button"
                                onClick={() => setActive(name)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                                    isSel
                                        ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                                        : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                                }`}
                            >
                                <FileSpreadsheet size={13} className={isSel ? "text-slate-700" : "text-slate-400"} />
                                {name}
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                                    isSel ? "bg-slate-100 text-slate-700" : "bg-slate-200/60 text-slate-500"
                                }`}>
                                    {count}r
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Table preview */}
                <div>
                    <div className="flex items-center justify-between text-xs text-slate-500 font-medium px-0.5 mb-1.5">
                        <span>Previewing: <strong className="text-slate-800">"{active}"</strong></span>
                        <span className="text-[11px] text-slate-400">Scroll horizontally to view all columns</span>
                    </div>
                    <PreviewTable rows={rows} />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <button
                        type="button"
                        onClick={() => onSubmit({ action: "skip" })}
                        disabled={submitting}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50 transition-all cursor-pointer disabled:opacity-40"
                    >
                        <SkipForward size={13} />
                        Skip This File
                    </button>
                    <button
                        onClick={() => active != null && onSubmit({ state: "sheet_verification", sheet_name: active })}
                        disabled={active == null || submitting}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                        style={{ background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)" }}
                    >
                        {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                        Confirm Sheet — "{active}"
                    </button>
                </div>
            </div>
        </StudioCard>
    );
}

/* ── Header & Column Disambiguation ── */
function HeaderDisambiguation({ question, submitting, onSubmit }) {
    const rows   = question.data || [];
    const needed = question.needed_columns || [];
    const [headerRow, setHeaderRow] = useState(null);
    const [mapping, setMapping]     = useState({});

    const headerCells = headerRow != null ? rows[headerRow] || [] : [];

    useEffect(() => {
        if (headerRow == null) { setMapping({}); return; }
        const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const newMap = {};
        const taken = new Set();
        for (const req of needed) {
            const reqNorm = norm(req);
            for (let i = 0; i < headerCells.length; i++) {
                if (taken.has(i)) continue;
                const cellVal = norm(headerCells[i]);
                if (cellVal && (cellVal === reqNorm || cellVal.includes(reqNorm) || reqNorm.includes(cellVal))) {
                    newMap[req] = i;
                    taken.add(i);
                    break;
                }
            }
        }
        setMapping(newMap);
    }, [headerRow, headerCells]); // eslint-disable-line react-hooks/exhaustive-deps

    const mappedCount = needed.filter((c) => mapping[c] !== undefined && mapping[c] !== "").length;
    const complete    = headerRow != null && mappedCount === needed.length;

    function submit() {
        if (!complete) return;
        const col = {};
        for (const c of needed) col[c] = Number(mapping[c]);
        onSubmit({ state: "header_row_disambiguation", header_row: Number(headerRow), col });
    }

    return (
        <StudioCard
            icon={Table}
            stepLabel="Column Mapping"
            title="Identify Header Row & Map Required Columns"
            hint="Step 1: Click the row that contains column headers. Step 2: Confirm each required field mapping."
            badge={
                <span className={`text-xs font-bold px-3 py-1.5 rounded border flex items-center gap-1.5 ${
                    complete
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        : "bg-sky-500/20 text-sky-300 border-sky-500/30"
                }`}>
                    {complete ? <Check size={13} /> : <AlertCircle size={13} />}
                    {mappedCount} / {needed.length} Mapped
                </span>
            }
        >
            <div className="space-y-6">
                {/* Step 1 */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded bg-slate-800 text-white text-[11px] font-bold flex items-center justify-center">1</span>
                            <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                                Select the header row
                            </span>
                        </div>
                        {headerRow != null ? (
                            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded flex items-center gap-1.5">
                                <Check size={12} /> Row {headerRow + 1} Selected
                            </span>
                        ) : (
                            <span className="text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded border border-amber-200 animate-pulse">
                                Click any row below
                            </span>
                        )}
                    </div>
                    <PreviewTable rows={rows} selectable selected={headerRow} onSelect={setHeaderRow} />
                </div>

                {/* Step 2 */}
                {headerRow != null && (
                    <div className="space-y-3 pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded bg-slate-800 text-white text-[11px] font-bold flex items-center justify-center">2</span>
                                <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                                    Map the 5 required encounter fields
                                </span>
                            </div>
                            <span className="text-[11px] text-slate-400">
                                Assigned columns are excluded from other dropdowns
                            </span>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            {needed.map((colName) => {
                                const meta = FIELD_META[colName] || { label: colName, icon: Table, desc: "Required field" };
                                const FieldIcon = meta.icon;
                                const currentVal = mapping[colName];
                                const isMapped   = currentVal !== undefined && currentVal !== "";
                                const selectedIdx = isMapped ? Number(currentVal) : null;
                                const samples = getSampleValues(rows, headerRow, selectedIdx, 2);

                                const takenByOtherFields = new Set(
                                    Object.entries(mapping)
                                        .filter(([k, v]) => k !== colName && v !== "" && v !== undefined)
                                        .map(([, v]) => Number(v))
                                );

                                return (
                                    <div
                                        key={colName}
                                        className={`rounded-lg border p-4 transition-all ${
                                            isMapped ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/30"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-2 mb-3">
                                            <div className="flex items-center gap-2.5">
                                                <div className="p-1.5 rounded-md bg-slate-100 text-slate-600">
                                                    <FieldIcon size={14} />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-1">
                                                        <p className="text-xs font-bold text-slate-900">{meta.label}</p>
                                                        <span className="text-[10px] text-rose-500 font-bold">*</span>
                                                    </div>
                                                </div>
                                            </div>
                                            {isMapped ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                                                    <Check size={10} /> Mapped
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                                                    Unassigned
                                                </span>
                                            )}
                                        </div>

                                        <select
                                            value={currentVal ?? ""}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setMapping((prev) => ({
                                                    ...prev,
                                                    [colName]: val === "" ? "" : Number(val),
                                                }));
                                            }}
                                            className={`w-full rounded-md border px-3 py-2 text-xs font-medium bg-white cursor-pointer transition-all ${
                                                isMapped
                                                    ? "border-slate-200 text-slate-800 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                                    : "border-amber-300 text-slate-500"
                                            }`}
                                        >
                                            <option value="">Select column from spreadsheet…</option>
                                            {headerCells.map((cell, i) => {
                                                if (takenByOtherFields.has(i)) return null;
                                                const text = cellText(cell);
                                                const letter = String.fromCharCode(65 + (i % 26));
                                                return (
                                                    <option key={i} value={i}>
                                                        Col {i + 1} ({letter}): {text ? `"${text}"` : "(blank)"}
                                                    </option>
                                                );
                                            })}
                                        </select>

                                        {isMapped && (
                                            <div className="mt-2 px-2.5 py-1.5 rounded bg-slate-50 border border-slate-100 flex items-center gap-2 text-[11px]">
                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
                                                    Sample:
                                                </span>
                                                {samples.length > 0 ? (
                                                    <span className="font-mono text-slate-600 truncate">
                                                        {samples.join("  ·  ")}
                                                    </span>
                                                ) : (
                                                    <span className="italic text-slate-400">No data in rows below header</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-100">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => onSubmit({ action: "skip" })}
                            disabled={submitting}
                            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50 transition-all cursor-pointer disabled:opacity-40"
                        >
                            <SkipForward size={13} />
                            Skip This File
                        </button>
                        <span className="text-xs text-slate-500">
                            {complete ? (
                                <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                                    <Check size={13} /> All 5 fields mapped
                                </span>
                            ) : headerRow == null ? (
                                "Select a header row above"
                            ) : (
                                `${needed.length - mappedCount} field(s) unassigned`
                            )}
                        </span>
                    </div>
                    <button
                        onClick={submit}
                        disabled={!complete || submitting}
                        className="flex items-center justify-center gap-2 px-7 py-2.5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                        style={{ background: complete ? "linear-gradient(135deg, #1e293b 0%, #334155 100%)" : undefined }}
                    >
                        {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                        Confirm Mapping & Continue
                    </button>
                </div>
            </div>
        </StudioCard>
    );
}

/* ═══════════════════════ Spreadsheet Grid ═══════════════════════ */

function PreviewTable({ rows = [], selectable = false, selected = null, onSelect }) {
    const colCount = useMemo(
        () => rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0),
        [rows]
    );

    if (!rows || rows.length === 0) {
        return (
            <div className="p-8 text-center bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-400 italic">No preview rows available.</p>
            </div>
        );
    }

    return (
        <div className="max-h-[380px] overflow-auto rounded-lg border border-slate-200 bg-white shadow-xs custom-scrollbar">
            <table className="w-full border-collapse text-left font-mono text-xs whitespace-nowrap">
                <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200 select-none">
                    <tr>
                        <th className="w-16 px-3 py-2.5 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider border-r border-slate-200 bg-slate-200/70 sticky left-0 z-20">
                            #
                        </th>
                        {Array.from({ length: colCount }).map((_, c) => {
                            const letter = String.fromCharCode(65 + (c % 26));
                            return (
                                <th
                                    key={c}
                                    className="px-4 py-2.5 text-[11px] font-bold text-slate-600 uppercase tracking-wider border-r border-slate-200 min-w-[140px] max-w-[400px]"
                                >
                                    Col {c + 1} ({letter})
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {rows.map((row, r) => {
                        const isSel = selectable && selected === r;
                        return (
                            <tr
                                key={r}
                                onClick={() => selectable && onSelect?.(r)}
                                className={`transition-colors ${
                                    selectable ? "cursor-pointer" : ""
                                } ${
                                    isSel
                                        ? "bg-slate-800 text-white"
                                        : selectable
                                        ? "hover:bg-slate-50 bg-white"
                                        : "odd:bg-white even:bg-slate-50/40"
                                }`}
                            >
                                <td
                                    className={`px-3 py-2.5 text-center border-r border-slate-200 sticky left-0 z-[1] select-none ${
                                        isSel ? "bg-slate-900 text-white font-bold" : "bg-slate-100 text-slate-400"
                                    }`}
                                >
                                    <div className="flex items-center justify-center gap-2">
                                        {selectable && (
                                            <span
                                                className={`flex items-center justify-center w-4 h-4 rounded-full border transition-all ${
                                                    isSel
                                                        ? "border-white bg-white"
                                                        : "border-slate-300 bg-white hover:border-slate-500"
                                                }`}
                                            >
                                                {isSel && <span className="w-1.5 h-1.5 rounded-full bg-slate-800" />}
                                            </span>
                                        )}
                                        <span className="text-[11px] font-mono">{r + 1}</span>
                                    </div>
                                </td>
                                {Array.from({ length: colCount }).map((_, c) => {
                                    const val = cellText(row?.[c]);
                                    return (
                                        <td
                                            key={c}
                                            className={`px-4 py-2.5 border-r border-slate-100 max-w-[400px] truncate ${
                                                isSel ? "text-white/90" : "text-slate-700"
                                            }`}
                                            title={val}
                                        >
                                            {val || <span className={isSel ? "text-white/30 italic" : "text-slate-300 italic"}>null</span>}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
