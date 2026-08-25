import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    ShieldCheck,
    ShieldAlert,
    AlertTriangle,
    Loader2,
    RefreshCw,
    ScanLine,
    Upload,
    FileSpreadsheet,
    Download,
    CheckCircle2,
    XCircle,
    X,
    FileText,
    Copy,
    Check,
    Info,
    Calendar,
    User,
    Sparkles,
    FileCheck,
    Table,
    FileQuestion,
} from "lucide-react";
import { verifyNin, startNinBatch, getNinBatchStatus, downloadNinBatch } from "../api/nin";
import useNinBatchProgress from "../hooks/useNinBatchProgress";
import { useToast } from "../components/ui/Toast";

export default function NinValidation() {
    const { jobId } = useParams();
    const navigate = useNavigate();
    const [tab, setTab] = useState(jobId ? "batch" : "single");

    useEffect(() => {
        if (jobId) {
            setTab("batch");
        }
    }, [jobId]);

    function handleTabChange(nextTab) {
        if (jobId && nextTab === "single") {
            navigate("/nin");
        }
        setTab(nextTab);
    }

    return (
        <div className="p-4 md:p-8 space-y-6 animate-fade-in">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold gradient-text inline-block">NIN Validation</h1>
                <p className="text-sm text-slate-500 mt-1">
                    Verify single citizen identification numbers or process bulk spreadsheet records
                </p>
            </div>

            {/* Tab Navigation */}
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <TabButton active={tab === "single"} onClick={() => handleTabChange("single")} icon={ScanLine}>
                    Single Check
                </TabButton>
                <TabButton active={tab === "batch"} onClick={() => handleTabChange("batch")} icon={FileSpreadsheet}>
                    Batch Validation
                </TabButton>
            </div>

            {tab === "single" ? <SingleCheck /> : <BatchValidation routeJobId={jobId} />}
        </div>
    );
}

function TabButton({ active, onClick, icon: Icon, children }) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
                active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
        >
            <Icon size={16} />
            {children}
        </button>
    );
}

/* ═══════════════════════ Single Check ═══════════════════════ */

function SingleCheck() {
    const [dob, setDob] = useState("");
    const [nin, setNin] = useState("");
    const [result, setResult] = useState(null);
    const [checking, setChecking] = useState(false);
    const [copied, setCopied] = useState(false);

    const eligible = /^\d{11}$/.test(nin) && !!dob;

    async function handleVerify() {
        if (!eligible || checking) return;
        setChecking(true);
        setResult(null);
        try {
            const res = await verifyNin(dob, nin);
            setResult(res);
        } catch {
            setResult({
                status: "error",
                message: "Service temporarily unavailable. Please try again.",
            });
        } finally {
            setChecking(false);
        }
    }

    function handleCopy() {
        if (!result?.details) return;
        const d = result.details;
        const text = `Name: ${d.firstName || ""} ${d.middleName || ""} ${d.lastName || ""}\nDOB: ${d.dateOfBirth || ""}\nNIN: ${nin}\nGender: ${d.gender || ""}`;
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    function handleClear() {
        setDob("");
        setNin("");
        setResult(null);
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Lookup Form */}
            <div className="lg:col-span-5 card p-6 space-y-5">
                <div>
                    <h2 className="text-base font-bold text-slate-900">Citizen Identity Lookup</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Enter date of birth and 11-digit NIN</p>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Date of Birth</label>
                        <div className="relative">
                            <input
                                type="date"
                                value={dob}
                                onChange={(e) => setDob(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm input-focus"
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs font-semibold text-slate-700">
                                National Identity Number (NIN)
                            </label>
                            <span className="text-[11px] font-mono text-slate-400">{nin.length}/11 digits</span>
                        </div>
                        <div className="relative">
                            <input
                                type="text"
                                inputMode="numeric"
                                value={nin}
                                placeholder="00000000000"
                                onChange={(e) => setNin(e.target.value.replace(/\D/g, "").slice(0, 11))}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleVerify();
                                }}
                                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm input-focus font-mono tracking-wider"
                                maxLength={11}
                            />
                            {nin.length === 11 && (
                                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-500">
                                    <CheckCircle2 size={16} />
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="pt-2 space-y-2">
                    <button
                        onClick={handleVerify}
                        disabled={!eligible || checking}
                        className="w-full gradient-primary rounded-xl text-white py-2.5 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                        {checking ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
                        <span>{checking ? "Querying registry…" : "Verify NIN"}</span>
                    </button>
                    {(dob || nin || result) && (
                        <button
                            onClick={handleClear}
                            className="w-full text-xs font-medium text-slate-400 hover:text-slate-600 py-1.5 transition-colors cursor-pointer"
                        >
                            Clear form
                        </button>
                    )}
                </div>

                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 flex items-start gap-2.5 text-xs text-slate-500">
                    <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
                    <span>Real-time verification against the central identity registry.</span>
                </div>
            </div>

            {/* Right Verified Result Container */}
            <div className="lg:col-span-7">
                <SingleResult
                    result={result}
                    checking={checking}
                    nin={nin}
                    copied={copied}
                    onCopy={handleCopy}
                    onClear={handleClear}
                />
            </div>
        </div>
    );
}

function SingleResult({ result, checking, nin, copied, onCopy, onClear }) {
    if (checking) {
        return (
            <div className="card p-12 h-full flex flex-col items-center justify-center text-center space-y-3">
                <div className="p-3 rounded-2xl bg-primary-50 text-primary-600">
                    <Loader2 size={28} className="animate-spin" />
                </div>
                <p className="text-sm font-semibold text-slate-700">Verifying Identity Record</p>
                <p className="text-xs text-slate-400 max-w-xs">Connecting to government verification registry…</p>
            </div>
        );
    }

    if (!result) {
        return (
            <div className="card p-12 h-full flex flex-col items-center justify-center text-center space-y-3 border-dashed">
                <div className="p-4 rounded-2xl bg-slate-50 text-slate-400 border border-slate-100">
                    <User size={32} className="text-slate-300" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-slate-700">Identity Details</h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs">
                        Enter date of birth and an 11-digit NIN on the left to inspect citizen records in real-time.
                    </p>
                </div>
            </div>
        );
    }

    const d = result.details;
    const isSuccess = result.status === "valid";
    const isInvalid = result.status === "invalid";

    const initials = isSuccess
        ? `${d?.firstName?.[0] || ""}${d?.lastName?.[0] || ""}`.toUpperCase() || "CI"
        : "—";

    return (
        <div
            className={`card p-6 space-y-5 animate-scale-in border-2 ${
                isSuccess
                    ? "border-emerald-200/80 bg-white"
                    : isInvalid
                    ? "border-rose-200/80 bg-white"
                    : "border-amber-200/80 bg-white"
            }`}
        >
            {/* Status Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                    {isSuccess ? (
                        <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                            <ShieldCheck size={20} />
                        </div>
                    ) : isInvalid ? (
                        <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
                            <ShieldAlert size={20} />
                        </div>
                    ) : (
                        <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                            <AlertTriangle size={20} />
                        </div>
                    )}
                    <div>
                        <h3
                            className={`text-sm font-bold ${
                                isSuccess ? "text-emerald-800" : isInvalid ? "text-rose-800" : "text-amber-800"
                            }`}
                        >
                            {isSuccess
                                ? "NIN Match Confirmed"
                                : isInvalid
                                ? "NIN Could Not Be Matched"
                                : "Verification Inconclusive"}
                        </h3>
                        <p className="text-xs text-slate-400">
                            {result.message || (isSuccess ? "Identity records match database" : "No match found")}
                        </p>
                    </div>
                </div>
            </div>

            {/* Citizen Details View */}
            {isSuccess && d && (
                <>
                    <div className="flex items-center gap-3.5 p-4 rounded-xl bg-slate-50 border border-slate-100">
                        <div className="w-12 h-12 rounded-xl gradient-primary text-white text-sm font-bold flex items-center justify-center shrink-0 shadow-sm">
                            {initials}
                        </div>
                        <div className="min-w-0">
                            <h4 className="text-base font-bold text-slate-900 uppercase truncate">
                                {d.firstName} {d.middleName} {d.lastName}
                            </h4>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                                    Verified
                                </span>
                                {d.gender && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-200 text-slate-700 capitalize">
                                        {d.gender}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <FieldTile label="First Name" value={d.firstName} />
                        <FieldTile label="Middle Name" value={d.middleName} />
                        <FieldTile label="Last Name" value={d.lastName} />
                        <FieldTile label="Date of Birth" value={d.dateOfBirth} />
                        <FieldTile label="NIN" value={nin} mono />
                        <FieldTile label="Gender" value={d.gender} />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                        <button
                            onClick={onCopy}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                        >
                            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                            <span>{copied ? "Copied" : "Copy Details"}</span>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

function FieldTile({ label, value, mono = false }) {
    return (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-100/80">
            <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400">{label}</span>
            <span className={`block text-xs font-semibold text-slate-800 mt-0.5 truncate ${mono ? "font-mono" : ""}`}>
                {value || "—"}
            </span>
        </div>
    );
}

/* ═══════════════════════ Batch Validation ═══════════════════════ */

const ACCEPT = ".csv,.xlsx,.xls,.ods";

function BatchValidation({ routeJobId }) {
    const toast = useToast();
    const navigate = useNavigate();
    const [file, setFile] = useState(null);
    const [generateReport, setGenerateReport] = useState(true);
    const [aggregateBy, setAggregateBy] = useState("ward"); // none | ward | facility
    const [phase, setPhase] = useState(routeJobId ? "checking" : "form");
    const [activeJobId, setActiveJobId] = useState(null);
    const [notFound, setNotFound] = useState(false);
    const [meta, setMeta] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const fileRef = useRef();

    const { progress, phase: streamPhase, done, error } = useNinBatchProgress(activeJobId);

    // Verify whether routeJobId exists in Redis
    useEffect(() => {
        if (!routeJobId) {
            setActiveJobId(null);
            setNotFound(false);
            setPhase("form");
            return;
        }

        setPhase("checking");
        setNotFound(false);

        getNinBatchStatus(routeJobId)
            .then((s) => {
                setActiveJobId(routeJobId);
                setMeta({ aggregate: s.aggregate, generate_report: s.generate_report });
                setPhase(s.status === "done" ? "done" : "running");
            })
            .catch(() => {
                setActiveJobId(null);
                setNotFound(true);
                setPhase("not_found");
            });
    }, [routeJobId]);

    async function handleSubmit() {
        if (!file) {
            toast?.warn?.("Please choose a spreadsheet file first");
            return;
        }
        setPhase("submitting");
        setUploadProgress(0);
        try {
            const res = await startNinBatch({
                file,
                generateReport,
                aggregateBy: aggregateBy === "none" ? null : aggregateBy,
                onProgress: (pct) => setUploadProgress(pct),
            });
            if (res.duplicate) toast?.warn?.(res.msg);
            else toast?.success?.(res.msg);

            if (!res.jobId) throw { msg: "Server did not return a job reference" };
            navigate(`/nin/batch/${res.jobId}`);
        } catch (err) {
            setPhase("form");
            toast?.error?.(err?.msg || "Could not start batch validation");
        }
    }

    useEffect(() => {
        if (!done || !activeJobId) return;
        setPhase("done");
        getNinBatchStatus(activeJobId)
            .then((s) => setMeta({ aggregate: s.aggregate, generate_report: s.generate_report }))
            .catch(() => setMeta({ aggregate: progress.aggregate, generate_report: progress.generate_report }));
    }, [done, activeJobId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (error && activeJobId) {
            setPhase("error");
            toast?.error?.(error);
        }
    }, [error, activeJobId]); // eslint-disable-line react-hooks/exhaustive-deps

    function reset() {
        setPhase("form");
        setActiveJobId(null);
        setNotFound(false);
        setMeta(null);
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        navigate("/nin");
    }

    if (routeJobId && phase === "checking") {
        return (
            <div className="card p-12 max-w-xl flex flex-col items-center justify-center text-center space-y-3 animate-fade-in">
                <Loader2 size={28} className="animate-spin text-primary-500" />
                <p className="text-sm font-semibold text-slate-700">Checking Batch Session…</p>
                <p className="text-xs text-slate-400">Locating verification records for batch {routeJobId.slice(0, 8)}…</p>
            </div>
        );
    }

    if (routeJobId && notFound) {
        return <BatchNotFound jobId={routeJobId} onReset={reset} />;
    }

    if (activeJobId && phase !== "submitting" && phase !== "form") {
        return (
            <BatchProgress
                progress={progress}
                streamPhase={streamPhase}
                phase={phase}
                error={error}
                jobId={activeJobId}
                meta={meta}
                onReset={reset}
            />
        );
    }

    const submitting = phase === "submitting";

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column (60%) - Upload & Settings */}
            <div className="lg:col-span-7 space-y-5">
                {/* Upload Card */}
                <div className="card p-6 space-y-4">
                    <div>
                        <h2 className="text-base font-bold text-slate-900">Upload Spreadsheet</h2>
                        <p className="text-xs text-slate-500 mt-0.5">Select citizen roster in Excel or CSV format</p>
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
                                if (e.dataTransfer.files?.[0]) {
                                    setFile(e.dataTransfer.files[0]);
                                }
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
                                <p className="text-xs text-slate-400 mt-1">Supports .CSV, .XLSX, .XLS, .ODS up to 25MB</p>
                            </div>
                            <div className="flex items-center gap-1.5 pt-1">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 font-mono">
                                    .CSV
                                </span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 font-mono">
                                    .XLSX
                                </span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 font-mono">
                                    .XLS
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                            <div className="p-2.5 rounded-xl bg-primary-100 text-primary-700">
                                <FileSpreadsheet size={22} />
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

                {/* Output Configuration Card */}
                <div className="card p-6 space-y-4">
                    <div>
                        <h3 className="text-base font-bold text-slate-900">Output Configuration</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Customize reports and analytics aggregates</p>
                    </div>

                    <div className="space-y-3">
                        {/* PDF Report Card Toggle */}
                        <div
                            onClick={() => setGenerateReport(!generateReport)}
                            className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                                generateReport
                                    ? "border-primary-500 bg-primary-50/30 shadow-xs"
                                    : "border-slate-200 hover:bg-slate-50"
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className={`p-2 rounded-lg ${
                                        generateReport ? "bg-primary-500 text-white" : "bg-slate-100 text-slate-500"
                                    }`}
                                >
                                    <FileText size={18} />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-slate-800">Generate PDF Analytics Report</p>
                                    <p className="text-[11px] text-slate-400">
                                        Includes summary charts and match rate statistics
                                    </p>
                                </div>
                            </div>
                            <input
                                type="checkbox"
                                checked={generateReport}
                                onChange={(e) => setGenerateReport(e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                            />
                        </div>

                        {/* LGA Breakdown Options */}
                        <div className="p-4 rounded-xl border border-slate-200 space-y-2.5">
                            <label className="block text-xs font-bold text-slate-800">LGA Breakdown</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { id: "none", label: "None" },
                                    { id: "ward", label: "By Ward" },
                                    { id: "facility", label: "By Facility" },
                                ].map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setAggregateBy(item.id)}
                                        className={`py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                            aggregateBy === item.id
                                                ? "gradient-primary text-white shadow-xs"
                                                : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                                        }`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={!file || submitting}
                        className="w-full relative overflow-hidden rounded-xl py-3 text-sm font-semibold transition-all cursor-pointer disabled:cursor-not-allowed mt-2"
                    >
                        <div 
                            className="absolute inset-0 bg-primary-600"
                            style={{
                                background: submitting || !file ? "#94a3b8" : undefined
                            }}
                        />
                        {/* Only show default gradient if NOT disabled and NOT submitting */}
                        {!(submitting || !file) && (
                            <div className="absolute inset-0 gradient-primary hover:shadow-lg hover:shadow-primary-500/25 transition-all" />
                        )}
                        {submitting && uploadProgress < 100 && (
                            <div 
                                className="absolute inset-y-0 left-0 bg-primary-900/30 transition-all duration-300" 
                                style={{ width: `${uploadProgress}%` }}
                            />
                        )}
                        <div className="relative py-0 flex items-center justify-center gap-2 text-white z-10">
                            {submitting ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
                            <span>
                                {submitting 
                                    ? uploadProgress < 100 
                                        ? `Uploading... ${uploadProgress}%` 
                                        : "Initiating Batch Task…" 
                                    : "Start Batch Validation"}
                            </span>
                        </div>
                    </button>
                </div>
            </div>

            {/* Right Column (40%) - Schema Guide & Requirements */}
            <div className="lg:col-span-5 space-y-5">
                <div className="card p-6 space-y-5">
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-primary-50 text-primary-600">
                            <Table size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">Spreadsheet Format Guide</h3>
                            <p className="text-xs text-slate-400">Ensure columns match the expected headers</p>
                        </div>
                    </div>

                    {/* Required Headers */}
                    <div className="space-y-2">
                        <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
                            Required Columns
                        </span>
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                                <span className="font-mono font-bold text-slate-800">nin</span>
                                <span className="text-[11px] text-slate-500">11 digits (e.g. 01234567890)</span>
                            </div>
                            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                                <span className="font-mono font-bold text-slate-800">dob</span>
                                <span className="text-[11px] text-slate-500">YYYY-MM-DD or DD/MM/YYYY</span>
                            </div>
                        </div>
                    </div>

                    {/* Optional Headers */}
                    <div className="space-y-2">
                        <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
                            Optional for Breakdown
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                            {["lga", "ward", "facility"].map((col) => (
                                <span
                                    key={col}
                                    className="px-2.5 py-1 rounded-md text-xs font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200"
                                >
                                    {col}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Sample Table Preview */}
                    <div className="space-y-2">
                        <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
                            Sample Structure
                        </span>
                        <div className="overflow-x-auto rounded-lg border border-slate-200 text-xs">
                            <table className="w-full text-left font-mono text-[11px]">
                                <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                                    <tr>
                                        <th className="p-2">nin</th>
                                        <th className="p-2">dob</th>
                                        <th className="p-2">ward</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700 bg-white">
                                    <tr>
                                        <td className="p-2">12345678901</td>
                                        <td className="p-2">1992-05-14</td>
                                        <td className="p-2">Ward 01</td>
                                    </tr>
                                    <tr>
                                        <td className="p-2">98765432100</td>
                                        <td className="p-2">1988-11-20</td>
                                        <td className="p-2">Ward 02</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Pro Tip */}
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/70 text-amber-800 text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                            <Sparkles size={14} className="text-amber-600" />
                            <span>Pro Tip</span>
                        </div>
                        <p className="text-[11px] text-amber-700 leading-relaxed">
                            Leading zeros in NINs (e.g. <span className="font-mono">0123...</span>) are automatically preserved during processing.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════════ Batch Not Found ═══════════════════════ */

function BatchNotFound({ jobId, onReset }) {
    return (
        <div className="card p-8 space-y-6 max-w-xl animate-scale-in">
            <div className="flex items-start gap-4">
                <div className="p-3.5 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100 shrink-0">
                    <FileQuestion size={26} />
                </div>
                <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-900">Batch Not Found or Expired</h2>
                    <p className="text-xs text-slate-500 leading-relaxed">
                        No active validation session exists for batch ID{" "}
                        <span className="font-mono font-semibold text-slate-700">{jobId}</span>. Temporary verification
                        sessions expire automatically after 24 hours or if the cache is cleared.
                    </p>
                </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                    onClick={onReset}
                    className="gradient-primary text-white px-5 py-2.5 rounded-xl text-xs font-semibold hover:shadow-md hover:shadow-primary-500/20 transition-all flex items-center gap-2 cursor-pointer"
                >
                    <RefreshCw size={14} />
                    Start New Batch Validation
                </button>
            </div>
        </div>
    );
}

/* ═══════════════════════ Batch Progress & Downloads ═══════════════════════ */

const PHASE_LABELS = {
    loading: "Preparing file…",
    validating: "Validating NINs",
    merging: "Assembling results",
    breakdown: "Building LGA breakdown",
    report: "Rendering PDF report",
    done: "Validation Complete",
};

function BatchProgress({ progress, streamPhase, phase, error, jobId, meta, onReset }) {
    const [downloading, setDownloading] = useState(null);
    const toast = useToast();

    const total = progress.total || 0;
    const completed = progress.completed || 0;
    const currentStatus = (progress.status || streamPhase || "").toLowerCase();
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Active phases MUST NOT be marked done
    const isProcessing = ["loading", "validating", "merging", "breakdown", "report"].includes(currentStatus);
    const isDone = (currentStatus === "done" || phase === "done") && !isProcessing;
    const isError = phase === "error" || (!!error && !isDone);
    const label = isError
        ? "Validation Failed"
        : isDone
        ? "Validation Complete"
        : PHASE_LABELS[currentStatus] || "Processing…";

    const truthy = (v) => v != null && !["", "false", "0", "none"].includes(String(v).toLowerCase());
    const hasBreakdown = truthy(meta?.aggregate ?? progress.aggregate);
    const hasReport = truthy(meta?.generate_report ?? progress.generate_report);

    async function download(type) {
        setDownloading(type);
        try {
            await downloadNinBatch(jobId, type);
        } catch (err) {
            toast?.error?.(err?.msg || "Download failed");
        } finally {
            setDownloading(null);
        }
    }

    return (
        <div className="card p-8 space-y-6 max-w-3xl animate-scale-in">
            <div className="flex items-center justify-between pb-6 border-b border-slate-100">
                <div className="flex items-center gap-3.5">
                    <div
                        className={`p-3 rounded-2xl ${
                            isDone ? "bg-emerald-50 text-emerald-600" : isError ? "bg-rose-50 text-rose-600" : "bg-primary-50 text-primary-600"
                        }`}
                    >
                        {isDone ? <CheckCircle2 size={24} /> : isError ? <XCircle size={24} /> : <ScanLine size={24} />}
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">{label}</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {isError
                                ? error || "An unexpected error occurred"
                                : isDone
                                ? `${total.toLocaleString()} records processed successfully`
                                : total > 0
                                ? `${completed.toLocaleString()} of ${total.toLocaleString()} records verified (${pct}%)`
                                : "Analyzing document rows…"}
                        </p>
                    </div>
                </div>
                {!isDone && !isError && <Loader2 size={22} className="animate-spin text-primary-500" />}
            </div>

            {!isError && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span>Progress</span>
                        <span className="font-mono">
                            {completed} / {total} ({pct}%)
                        </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                            className={`h-full transition-all duration-300 ${
                                isDone
                                    ? "bg-emerald-500"
                                    : "gradient-primary"
                            }`}
                            style={{ width: `${isDone ? 100 : pct}%` }}
                        />
                    </div>
                </div>
            )}

            {isDone && (
                <div className="space-y-3 pt-2">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Available Downloads</h3>
                    <DownloadTile
                        title="Validated Spreadsheet Results"
                        description="Original rows annotated with validity verdict and mismatch details"
                        onClick={() => download("result")}
                        busy={downloading === "result"}
                        available
                        icon={FileSpreadsheet}
                    />
                    <DownloadTile
                        title="LGA / Ward Breakdown"
                        description="Aggregated statistical summary by administrative division"
                        onClick={() => download("breakdown")}
                        busy={downloading === "breakdown"}
                        available={hasBreakdown}
                        icon={FileCheck}
                    />
                    <DownloadTile
                        title="Executive PDF Report"
                        description="Visual charts, summaries, and executive verification metrics"
                        onClick={() => download("report")}
                        busy={downloading === "report"}
                        available={hasReport}
                        icon={FileText}
                    />
                </div>
            )}

            <div className="pt-2 flex items-center justify-between">
                <button
                    onClick={onReset}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                    <RefreshCw size={14} />
                    {isError ? "Try Another File" : "Validate Another Spreadsheet"}
                </button>
            </div>
        </div>
    );
}

function DownloadTile({ title, description, onClick, busy, available, icon: Icon }) {
    return (
        <div
            className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                available
                    ? "border-slate-200 bg-white hover:border-primary-300"
                    : "border-slate-100 bg-slate-50/60 opacity-60"
            }`}
        >
            <div className="flex items-center gap-3 min-w-0 pr-4">
                <div className={`p-2.5 rounded-lg ${available ? "bg-primary-50 text-primary-600" : "bg-slate-200 text-slate-400"}`}>
                    <Icon size={18} />
                </div>
                <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-800 truncate">{title}</h4>
                    <p className="text-[11px] text-slate-400 truncate">{available ? description : "Not generated for this batch"}</p>
                </div>
            </div>
            <button
                onClick={onClick}
                disabled={!available || busy}
                className="gradient-primary text-white px-4 py-2 rounded-xl text-xs font-semibold hover:shadow-md hover:shadow-primary-500/20 transition-all disabled:opacity-30 disabled:shadow-none flex items-center gap-1.5 shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                Download
            </button>
        </div>
    );
}
