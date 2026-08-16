import { useState, useRef } from "react";
import { X, Upload, Loader2, ScanLine } from "lucide-react";
import { rescanForm } from "../../api/enrollment";
import { useToast } from "../ui/Toast";

/**
 * Replaces the scanned image for a NEED_RESCAN form and re-queues it. The
 * backend flips status to PENDING and returns 202 — the task queue drives the
 * actual re-extraction, so we don't poll here; we just confirm the hand-off.
 */
export default function RescanModal({ form, onClose, onDone }) {
    const toast = useToast();
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef(null);

    function pickFile(f) {
        if (!f) return;
        setFile(f);
        setPreview(URL.createObjectURL(f));
    }

    async function handleSubmit() {
        if (!file) {
            toast.warn("Choose a replacement scan first");
            return;
        }
        setSubmitting(true);
        try {
            await rescanForm(form.id, file);
            toast.success("New scan queued — it will reprocess shortly");
            onDone?.();
            onClose();
        } catch (err) {
            toast.error(err?.msg || "Rescan failed");
        } finally {
            setSubmitting(false);
        }
    }

    const name = `${form.surname || ""} ${form.firstname || ""}`.trim();

    return (
        <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
            onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
        >
            <div className="card w-full max-w-md relative animate-scale-in" style={{ boxShadow: "var(--shadow-elevated)" }}>
                <button
                    onClick={onClose}
                    disabled={submitting}
                    className="absolute top-4 right-4 p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600 disabled:opacity-40"
                >
                    <X size={18} />
                </button>

                <div className="p-6">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="p-2 rounded-lg bg-amber-50">
                            <ScanLine size={18} className="text-amber-500" />
                        </div>
                        <h2 className="text-lg font-bold text-slate-900">Replace scan</h2>
                    </div>
                    <p className="text-sm text-slate-500 mb-5">
                        Upload a clearer scan{name ? <> for <span className="font-semibold text-slate-700">{name}</span></> : ""}. It re-enters the processing queue.
                    </p>

                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => pickFile(e.target.files[0])}
                    />

                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        className="w-full rounded-xl border-2 border-dashed border-slate-200 hover:border-primary-300 hover:bg-primary-50/30 transition-all p-6 flex flex-col items-center gap-2 text-slate-500"
                    >
                        {preview ? (
                            <img src={preview} alt="Replacement scan" className="max-h-48 rounded-lg object-contain" />
                        ) : (
                            <>
                                <Upload size={24} className="text-slate-400" />
                                <span className="text-sm font-medium">Click to choose an image</span>
                            </>
                        )}
                    </button>
                    {file && <p className="mt-2 text-xs text-slate-400 truncate">{file.name}</p>}

                    <div className="flex gap-3 mt-6">
                        <button
                            onClick={onClose}
                            disabled={submitting}
                            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !file}
                            className="flex-1 gradient-primary rounded-xl text-white py-2.5 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                        >
                            {submitting && <Loader2 size={14} className="animate-spin" />}
                            {submitting ? "Queuing..." : "Replace & reprocess"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
