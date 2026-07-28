const variants = {
    processing: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
    extracting: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
    done: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
    ready: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
    enrolled: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
    failed: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
    error: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
    need_rescan: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
    rejected: { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
};

const labels = {
    need_rescan: "Needs Rescan",
};

const fallback = { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" };

export default function StatusBadge({ status }) {
    const key = status?.toLowerCase();
    const v = variants[key] || fallback;
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${v.bg} ${v.text}`}
        >
            <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />
            {labels[key] || status}
        </span>
    );
}
