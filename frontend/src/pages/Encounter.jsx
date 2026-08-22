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
        <div className="p-8 space-y-6 animate-fade-in">
            <div>
                <h1 className="text-2xl font-bold gradient-text inline-block">Encounter Analysis</h1>
                <p className="text-sm text-slate-500 mt-1">
                    Process encounter files into encounter and utilization reports
                </p>
            </div>
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

    async function handleSubmit() {
        if (!file) {
            toast?.warn?.("Please choose an encounter file first");
            return;
        }
        setSubmitting(true);
        try {
            const res = await startEncounterJob({ file, encounterType, chaiOnly });
            if (!res.ok) {
                // Includes BHCPF's 501 "not implemented yet" — surface the server's own message.
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
        }
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-5xl">
            <div className="lg:col-span-7 space-y-5">
                {/* File */}
                <div className="card p-6 space-y-4">
                    <div>
                        <h2 className="text-base font-bold text-slate-900">Upload Encounter File</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            A single spreadsheet, or a .zip containing several
                        </p>
                    </div>

                    <input
                        ref={fileRef}
                        type="file"
                        accept={ACCEPT}
                        className="hidden"
                        onChange={(e) => setFile(e.target.files[0] || null)}
                    />

                    {!file ? (
                        <div
                            onDragOver={(e) => {
                                e.preventDefault();
                                setIsDragging(true);
                            }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setIsDragging(false);
                                if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
                            }}
                            onClick={() => fileRef.current?.click()}
                            className={`w-full rounded-2xl border-2 border-dashed p-8 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer text-center ${
                                isDragging
                                    ? "border-primary-500 bg-primary-50/50 text-primary-600 scale-[0.99]"
                                    : "border-slate-200/90 hover:border-primary-400 hover:bg-slate-50/60 text-slate-400"
                            }`}
                        >
                            <div className="p-3 rounded-2xl bg-primary-50 text-primary-600 shadow-sm">
                                <Upload size={24} />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-slate-700">
                                    Drag and drop your file here, or <span className="text-primary-600">browse</span>
                                </p>
                                <p className="text-xs text-slate-400 mt-1">Supports .ZIP, .XLSX, .XLS, .CSV, .ODS</p>
                            </div>
                            <div className="flex items-center gap-1.5 pt-1">
                                {[".ZIP", ".XLSX", ".CSV"].map((ext) => (
                                    <span
                                        key={ext}
                                        className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 font-mono"
                                    >
                                        {ext}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                            <div className="p-2.5 rounded-xl bg-primary-100 text-primary-700">
                                {file.name.toLowerCase().endsWith(".zip") ? (
                                    <FileArchive size={22} />
                                ) : (
                                    <FileSpreadsheet size={22} />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate">{file.name}</p>
                                <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                            </div>
                            <button
                                onClick={() => {
                                    setFile(null);
                                    if (fileRef.current) fileRef.current.value = "";
                                }}
                                className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    )}
                </div>

                {/* Options */}
                <div className="card p-6 space-y-4">
                    <div>
                        <h3 className="text-base font-bold text-slate-900">Processing Options</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Choose the encounter source</p>
                    </div>

                    <div className="space-y-2.5">
                        <label className="block text-xs font-bold text-slate-800">Encounter Type</label>
                        <div className="grid grid-cols-2 gap-2">
                            {["oranghis", "bhcpf"].map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setEncounterType(t)}
                                    className={`py-2.5 px-3 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all cursor-pointer ${
                                        encounterType === t
                                            ? "gradient-primary text-white shadow-xs"
                                            : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                                    }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div
                        onClick={() => setChaiOnly(!chaiOnly)}
                        className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                            chaiOnly ? "border-primary-500 bg-primary-50/30 shadow-xs" : "border-slate-200 hover:bg-slate-50"
                        }`}
                    >
                        <span className="text-xs font-bold text-slate-800">CHAI only</span>
                        <input
                            type="checkbox"
                            checked={chaiOnly}
                            onChange={(e) => setChaiOnly(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                        />
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={!file || submitting}
                        className="w-full gradient-primary rounded-xl text-white py-3 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed mt-2"
                    >
                        {submitting ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
                        <span>{submitting ? "Starting analysis…" : "Start Encounter Analysis"}</span>
                    </button>
                </div>
            </div>

            {/* Guide */}
            <div className="lg:col-span-5">
                <div className="card p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-primary-50 text-primary-600">
                            <Files size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">How it works</h3>
                            <p className="text-xs text-slate-400">Each file is validated, then analysed</p>
                        </div>
                    </div>
                    <ol className="space-y-2.5 text-xs text-slate-600">
                        {[
                            "Upload one file or a zip of several.",
                            "For each file, confirm the sheet and header columns if they can't be detected automatically.",
                            "Files are analysed into a combined encounter and utilization report.",
                            "Download the report when processing completes.",
                        ].map((step, i) => (
                            <li key={i} className="flex gap-2.5">
                                <span className="shrink-0 w-5 h-5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center">
                                    {i + 1}
                                </span>
                                <span className="leading-relaxed">{step}</span>
                            </li>
                        ))}
                    </ol>
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

    const { progress, pendingQuestion, done, error, clearPendingQuestion } = useEncounterProgress(activeJobId);

    // Probe status before opening the stream — a terminal job never connects.
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

    useEffect(() => {
        if (done) setPhase("done");
    }, [done]);

    useEffect(() => {
        if (error) {
            setPhase("error");
            toast?.error?.(error);
        }
    }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

    function reset() {
        navigate("/encounter");
    }

    async function submitAnswer(answer) {
        if (!pendingQuestion) return;
        setSubmitting(true);
        try {
            const res = await answerEncounter(routeJobId, pendingQuestion.job_num, answer);
            if (res.success) {
                clearPendingQuestion();
                toast?.success?.("Answer submitted");
            } else {
                toast?.error?.(res.msg || "Could not submit answer");
            }
        } catch (err) {
            toast?.error?.(err?.msg || "Could not submit answer");
        } finally {
            setSubmitting(false);
        }
    }

    if (phase === "checking") {
        return (
            <div className="card p-12 max-w-xl flex flex-col items-center justify-center text-center space-y-3 animate-fade-in">
                <Loader2 size={28} className="animate-spin text-primary-500" />
                <p className="text-sm font-semibold text-slate-700">Checking Encounter Job…</p>
                <p className="text-xs text-slate-400">Locating records for job {routeJobId.slice(0, 8)}…</p>
            </div>
        );
    }

    if (phase === "not_found") return <JobNotFound jobId={routeJobId} onReset={reset} />;

    return (
        <ProgressView
            progress={progress}
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
        <div className="card p-8 space-y-6 max-w-xl animate-scale-in">
            <div className="flex items-start gap-4">
                <div className="p-3.5 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100 shrink-0">
                    <FileQuestion size={26} />
                </div>
                <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-900">Job Not Found or Expired</h2>
                    <p className="text-xs text-slate-500 leading-relaxed">
                        No active encounter job exists for ID{" "}
                        <span className="font-mono font-semibold text-slate-700">{jobId}</span>. Temporary sessions
                        expire automatically after 24 hours or if the cache is cleared.
                    </p>
                </div>
            </div>
            <div className="pt-2 border-t border-slate-100 flex items-center justify-end">
                <button
                    onClick={onReset}
                    className="gradient-primary text-white px-5 py-2.5 rounded-xl text-xs font-semibold hover:shadow-md hover:shadow-primary-500/20 transition-all flex items-center gap-2 cursor-pointer"
                >
                    <RefreshCw size={14} />
                    Start New Encounter Job
                </button>
            </div>
        </div>
    );
}

/* ═══════════════════════ Progress ═══════════════════════ */

const FILE_STATE = {
    queued: { bg: "bg-slate-50", text: "text-slate-500", dot: "bg-slate-400", label: "Queued", spin: false },
    validating: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Validating", spin: true },
    needs_input: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", label: "Needs input", spin: false },
    analysing: { bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500", label: "Analysing", spin: true },
    done: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Done", spin: false },
};

/**
 * Coarse per-file state. Validation is strictly sequential, so `current_job` is
 * a true frontier: everything below it has been dispatched to analysis,
 * everything above is untouched. Once validation finishes (status analysing/done
 * or state done_validating) every file is analysing. We deliberately don't track
 * which individual analysis finished first — invisible to the user.
 */
function fileStateFor(idx, { currentJob, status, state, hasQuestion, isDone }) {
    if (isDone) return "done";
    const validationComplete = status === "analysing" || state === "done_validating";
    if (validationComplete) return "analysing";
    if (idx < currentJob) return "analysing";
    if (idx === currentJob) return hasQuestion ? "needs_input" : "validating";
    return "queued";
}

function ProgressView({ progress, pendingQuestion, phase, error, jobId, submitting, onSubmitAnswer, onReset }) {
    const [downloading, setDownloading] = useState(false);
    const toast = useToast();

    const status = String(progress.status || "").toLowerCase();
    const state = String(progress.state || "").toLowerCase();
    const total = progress.total || 0;
    const completed = progress.completed || 0;
    const currentJob = progress.current_job || 0;

    const isDone = phase === "done";
    const isError = phase === "error";
    const validationComplete = status === "analysing" || state === "done_validating" || isDone;

    const files = progress.files || {};
    const fileEntries = Object.entries(files)
        .map(([idx, name]) => [Number(idx), name])
        .sort((a, b) => a[0] - b[0]);

    // Progress bar: analysis completion once validation is done, else the validation frontier.
    const pct = isDone
        ? 100
        : validationComplete
        ? total > 0
            ? Math.round((completed / total) * 100)
            : 0
        : total > 0
        ? Math.round((Math.max(currentJob - 1, 0) / total) * 100)
        : 0;

    const label = isError
        ? "Analysis Failed"
        : isDone
        ? "Analysis Complete"
        : status === "extracting"
        ? "Extracting files…"
        : validationComplete
        ? "Analysing files…"
        : "Validating files…";

    const subtitle = isError
        ? error || "An unexpected error occurred"
        : isDone
        ? `${total.toLocaleString()} file${total === 1 ? "" : "s"} processed`
        : validationComplete
        ? `${completed.toLocaleString()} of ${total.toLocaleString()} files analysed`
        : total > 0
        ? `Validating file ${Math.min(currentJob, total)} of ${total}`
        : "Preparing…";

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
        <div className="space-y-5 max-w-3xl">
            <div className="card p-8 space-y-6 animate-scale-in">
                <div className="flex items-center justify-between pb-6 border-b border-slate-100">
                    <div className="flex items-center gap-3.5">
                        <div
                            className={`p-3 rounded-2xl ${
                                isDone
                                    ? "bg-emerald-50 text-emerald-600"
                                    : isError
                                    ? "bg-rose-50 text-rose-600"
                                    : "bg-primary-50 text-primary-600"
                            }`}
                        >
                            {isDone ? <CheckCircle2 size={24} /> : isError ? <XCircle size={24} /> : <ScanLine size={24} />}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">{label}</h2>
                            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
                        </div>
                    </div>
                    {!isDone && !isError && <Loader2 size={22} className="animate-spin text-primary-500" />}
                </div>

                {!isError && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                            <span>{validationComplete ? "Analysis" : "Validation"}</span>
                            <span className="font-mono">{pct}%</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                                className={`h-full transition-all duration-300 ${isDone ? "bg-emerald-500" : "gradient-primary"}`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>
                )}

                {isDone && (
                    <div className="pt-1">
                        <button
                            onClick={download}
                            disabled={downloading}
                            className="w-full gradient-primary text-white py-3 rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                        >
                            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                            <span>{downloading ? "Preparing download…" : "Download Encounter & Utilization Report"}</span>
                        </button>
                    </div>
                )}

                <div className="pt-1 flex items-center justify-end">
                    <button
                        onClick={onReset}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                        <RefreshCw size={14} />
                        {isError ? "Try Another File" : "Process Another File"}
                    </button>
                </div>
            </div>

            {/* Pending question */}
            {!isDone && !isError && pendingQuestion && (
                <QuestionPanel question={pendingQuestion} submitting={submitting} onSubmit={onSubmitAnswer} />
            )}

            {/* File queue */}
            {fileEntries.length > 0 && (
                <div className="card p-6 space-y-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Files ({fileEntries.length})
                    </h3>
                    <div className="space-y-1.5">
                        {fileEntries.map(([idx, name]) => {
                            const st =
                                FILE_STATE[
                                    fileStateFor(idx, {
                                        currentJob,
                                        status,
                                        state,
                                        hasQuestion: !!pendingQuestion && pendingQuestion.job_num === idx,
                                        isDone,
                                    })
                                ];
                            return (
                                <div
                                    key={idx}
                                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-slate-100 bg-white"
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <FileSpreadsheet size={16} className="text-slate-400 shrink-0" />
                                        <span className="text-xs font-medium text-slate-700 truncate" title={name}>
                                            {name}
                                        </span>
                                    </div>
                                    <span
                                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shrink-0 ${st.bg} ${st.text}`}
                                    >
                                        {st.spin ? (
                                            <Loader2 size={10} className="animate-spin" />
                                        ) : (
                                            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                                        )}
                                        {st.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════ Questions ═══════════════════════ */

function QuestionPanel({ question, submitting, onSubmit }) {
    if (question.state === "sheet_verification") {
        return <SheetVerification question={question} submitting={submitting} onSubmit={onSubmit} />;
    }
    if (question.state === "header_row_disambiguation") {
        return <HeaderDisambiguation question={question} submitting={submitting} onSubmit={onSubmit} />;
    }
    return null;
}

function cellText(v) {
    return v === null || v === undefined ? "" : String(v);
}

function QuestionShell({ icon: Icon, title, hint, children }) {
    return (
        <div className="card p-6 space-y-4 border-2 border-amber-200/80 animate-scale-in">
            <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                    <Icon size={18} />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                    <p className="text-xs text-slate-500">{hint}</p>
                </div>
            </div>
            {children}
        </div>
    );
}

// Sheet selection: a tab per sheet, the active tab previews its rows and is the choice.
function SheetVerification({ question, submitting, onSubmit }) {
    const sheets = useMemo(() => Object.keys(question.data || {}), [question]);
    const [active, setActive] = useState(sheets[0] ?? null);

    useEffect(() => {
        setActive(sheets[0] ?? null);
    }, [sheets]);

    const rows = (active != null && question.data[active]) || [];

    return (
        <QuestionShell icon={Layers} title="Select the data sheet" hint="Preview each sheet and choose the one to process">
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-1">
                {sheets.map((name) => (
                    <button
                        key={name}
                        type="button"
                        onClick={() => setActive(name)}
                        className={`px-3.5 py-1.5 rounded-t-lg text-xs font-semibold transition-all cursor-pointer border-b-2 -mb-px ${
                            active === name
                                ? "border-primary-500 text-primary-700 bg-primary-50/40"
                                : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                        }`}
                    >
                        {name}
                    </button>
                ))}
            </div>

            <PreviewTable rows={rows} maxRows={20} />

            <div className="flex items-center justify-end pt-1">
                <button
                    onClick={() => active != null && onSubmit({ state: "sheet_verification", sheet_name: active })}
                    disabled={active == null || submitting}
                    className="gradient-primary text-white px-5 py-2.5 rounded-xl text-xs font-semibold hover:shadow-md hover:shadow-primary-500/20 transition-all disabled:opacity-40 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    Use “{active}” sheet
                </button>
            </div>
        </QuestionShell>
    );
}

// Header + column mapping: pick the header row from the preview, then map each
// required column to one of that row's cells. No client-side matching — the
// backend already tried and only asks when it couldn't resolve them.
function HeaderDisambiguation({ question, submitting, onSubmit }) {
    const rows = question.data || [];
    const needed = question.needed_columns || [];
    const [headerRow, setHeaderRow] = useState(null);
    const [mapping, setMapping] = useState({});

    const headerCells = headerRow != null ? rows[headerRow] || [] : [];
    const complete = headerRow != null && needed.every((c) => mapping[c] !== undefined && mapping[c] !== "");

    function submit() {
        if (!complete) return;
        const col = {};
        for (const c of needed) col[c] = Number(mapping[c]);
        onSubmit({ state: "header_row_disambiguation", header_row: Number(headerRow), col });
    }

    return (
        <QuestionShell
            icon={Table}
            title="Identify the header row and columns"
            hint="Click on the row in the table below that contains your column titles, then map the 5 required fields."
        >
            <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="block text-[11px] uppercase font-bold tracking-wider text-slate-400">
                        1 · Select the header row
                    </span>
                    {headerRow != null && (
                        <span className="text-[11px] font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-md">
                            Row {headerRow + 1} selected as header
                        </span>
                    )}
                </div>
                <PreviewTable rows={rows} maxRows={20} selectable selected={headerRow} onSelect={setHeaderRow} />
            </div>

            {headerRow != null && (
                <div className="space-y-2.5 pt-1">
                    <span className="block text-[11px] uppercase font-bold tracking-wider text-slate-400">
                        2 · Match required columns
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {needed.map((col) => (
                            <div key={col} className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 capitalize">{col}</label>
                                <select
                                    value={mapping[col] ?? ""}
                                    onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs input-focus bg-white cursor-pointer"
                                >
                                    <option value="">Select column…</option>
                                    {headerCells.map((cell, i) => (
                                        <option key={i} value={i}>
                                            {cellText(cell) ? `Col ${i + 1}: ${cellText(cell)}` : `Col ${i + 1} (Empty)`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex items-center justify-end pt-1">
                <button
                    onClick={submit}
                    disabled={!complete || submitting}
                    className="gradient-primary text-white px-5 py-2.5 rounded-xl text-xs font-semibold hover:shadow-md hover:shadow-primary-500/20 transition-all disabled:opacity-40 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    Confirm columns
                </button>
            </div>
        </QuestionShell>
    );
}

function PreviewTable({ rows, maxRows = 20, selectable = false, selected = null, onSelect }) {
    const shown = rows.slice(0, maxRows);
    const colCount = shown.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);

    if (shown.length === 0) {
        return <p className="text-xs text-slate-400 italic py-4 text-center">No preview rows available.</p>;
    }

    return (
        <div className="max-h-80 overflow-auto rounded-xl border border-slate-200 bg-white shadow-inner custom-scrollbar">
            <table className="w-full border-collapse text-left font-mono text-[11px] whitespace-nowrap">
                <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 shadow-xs">
                    <tr>
                        <th className="w-12 px-2.5 py-2 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider border-r border-slate-200 bg-slate-100/90">
                            #
                        </th>
                        {Array.from({ length: colCount }).map((_, c) => (
                            <th
                                key={c}
                                className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-r border-slate-200 bg-slate-50 min-w-[130px]"
                            >
                                Col {c + 1} ({String.fromCharCode(65 + (c % 26))})
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {shown.map((row, r) => {
                        const isSel = selectable && selected === r;
                        return (
                            <tr
                                key={r}
                                onClick={() => selectable && onSelect?.(r)}
                                className={`transition-colors ${
                                    selectable ? "cursor-pointer" : ""
                                } ${
                                    isSel
                                        ? "bg-primary-50/90 font-medium text-primary-950"
                                        : selectable
                                        ? "hover:bg-slate-50/80 bg-white"
                                        : "odd:bg-white even:bg-slate-50/50"
                                }`}
                            >
                                <td
                                    className={`px-2.5 py-2 text-center border-r border-slate-200 sticky left-0 z-[1] select-none ${
                                        isSel ? "bg-primary-100/80 text-primary-700 font-bold" : "bg-slate-50 text-slate-400"
                                    }`}
                                >
                                    <div className="flex items-center justify-center gap-1.5">
                                        {selectable && (
                                            <span
                                                className={`flex items-center justify-center w-3.5 h-3.5 rounded-full border transition-all ${
                                                    isSel
                                                        ? "border-primary-600 bg-primary-600 text-white"
                                                        : "border-slate-300 bg-white"
                                                }`}
                                            >
                                                {isSel && <span className="w-1 h-1 rounded-full bg-white" />}
                                            </span>
                                        )}
                                        <span className="text-[10px] font-mono">{r + 1}</span>
                                    </div>
                                </td>
                                {Array.from({ length: colCount }).map((_, c) => (
                                    <td
                                        key={c}
                                        className={`px-3 py-2 border-r border-slate-200 max-w-[240px] truncate ${
                                            isSel ? "text-primary-950 font-medium" : "text-slate-700"
                                        }`}
                                        title={cellText(row?.[c])}
                                    >
                                        {cellText(row?.[c]) || <span className="text-slate-300 italic">null</span>}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
