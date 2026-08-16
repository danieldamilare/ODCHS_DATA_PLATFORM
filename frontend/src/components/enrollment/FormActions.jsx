import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Download, CreditCard, RefreshCw, ScanLine, Loader2 } from "lucide-react";
import { getActions } from "../../constants/formStatus";
import { downloadFormImage, downloadFormIdcard, reprocessForm } from "../../api/enrollment";
import { useToast } from "../ui/Toast";
import RescanModal from "./RescanModal";

/**
 * Status-aware action surface shared by the batch listing (variant="row",
 * compact icon buttons) and manual form review (variant="toolbar", labelled).
 * Allowed actions come from the status descriptor's getActions(), so the row
 * and the open form always agree on what's possible.
 *
 * `onChanged` fires after reprocess/rescan hands off to the task queue so the
 * caller can refresh. We intentionally don't poll — the batch SSE (or a manual
 * reload) reflects the new status when the worker finishes.
 */
const META = {
    review: { icon: Eye, label: "Review" },
    download_form: { icon: Download, label: "Form" },
    download_idcard: { icon: CreditCard, label: "ID card" },
    reprocess: { icon: RefreshCw, label: "Reprocess" },
    rescan: { icon: ScanLine, label: "Rescan" },
};

export default function FormActions({ form, variant = "row", onChanged }) {
    const navigate = useNavigate();
    const toast = useToast();
    const [busy, setBusy] = useState(null);
    const [showRescan, setShowRescan] = useState(false);

    let actions = getActions(form.status);
    // In the open form we're already reviewing — drop the redundant Review action.
    if (variant === "toolbar") actions = actions.filter((a) => a !== "review");
    if (actions.length === 0) return null;

    async function run(action, e) {
        e?.stopPropagation();
        if (busy) return;

        switch (action) {
            case "review":
                navigate(`/enrollment/form/${form.id}`);
                return;
            case "download_form":
                setBusy(action);
                try {
                    await downloadFormImage(form.id);
                } catch (err) {
                    toast.error(err?.msg || "Could not download form");
                } finally {
                    setBusy(null);
                }
                return;
            case "download_idcard":
                // Cache-miss generates the card synchronously (HIS + render), so this can be slow.
                setBusy(action);
                try {
                    await downloadFormIdcard(form.id);
                } catch (err) {
                    toast.error(err?.msg || "Could not download ID card");
                } finally {
                    setBusy(null);
                }
                return;
            case "reprocess":
                setBusy(action);
                try {
                    await reprocessForm(form.id);
                    toast.success("Queued for reprocessing");
                    onChanged?.();
                } catch (err) {
                    toast.error(err?.msg || "Reprocess failed");
                } finally {
                    setBusy(null);
                }
                return;
            case "rescan":
                setShowRescan(true);
                return;
            default:
                return;
        }
    }

    const isRow = variant === "row";

    return (
        <>
            <div className={`flex items-center ${isRow ? "gap-0.5" : "gap-2"}`}>
                {actions.map((action) => {
                    const { icon: Icon, label } = META[action];
                    const loading = busy === action;
                    if (isRow) {
                        return (
                            <button
                                key={action}
                                title={label}
                                onClick={(e) => run(action, e)}
                                disabled={loading}
                                className="p-2 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50"
                            >
                                {loading ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
                            </button>
                        );
                    }
                    return (
                        <button
                            key={action}
                            onClick={(e) => run(action, e)}
                            disabled={loading}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-primary-300 hover:text-primary-700 hover:bg-primary-50/40 transition-all disabled:opacity-50"
                        >
                            {loading ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
                            {label}
                        </button>
                    );
                })}
            </div>

            {showRescan && (
                <RescanModal
                    form={form}
                    onClose={() => setShowRescan(false)}
                    onDone={onChanged}
                />
            )}
        </>
    );
}
