import { getStatusConfig } from "../../constants/formStatus";

// Batch-only statuses (not in form descriptor)
const BATCH_EXTRA = {
    processing: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Processing" },
    extracting: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", label: "Extracting" },
    done: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Done" },
};

export default function StatusBadge({ status }) {
    const key = status?.toLowerCase();

    // Try form descriptor first
    const formConfig = getStatusConfig(key);
    if (formConfig) {
        return (
            <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${formConfig.color.bg} ${formConfig.color.text}`}
            >
                <span className={`w-1.5 h-1.5 rounded-full ${formConfig.color.dot}`} />
                {formConfig.label}
            </span>
        );
    }

    // Fall back to batch-extra
    const batchConfig = BATCH_EXTRA[key];
    if (batchConfig) {
        return (
            <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${batchConfig.bg} ${batchConfig.text}`}
            >
                <span className={`w-1.5 h-1.5 rounded-full ${batchConfig.dot}`} />
                {batchConfig.label}
            </span>
        );
    }

    // Unknown status
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap bg-slate-100 text-slate-600">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            {status}
        </span>
    );
}
