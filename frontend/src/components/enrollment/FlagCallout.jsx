import { Flag, AlertTriangle } from "lucide-react";

/**
 * Surfaces extraction-time data-quality flags as a checklist the reviewer must
 * verify before enrolling. Only shown when the form was flagged during
 * normalization. Suppressed once a form is rejected, because the `reason`
 * field is then repurposed to hold the human rejection reason (see reject route).
 */
export default function FlagCallout({ form }) {
    if (!form?.flagged) return null;
    if (form.status?.toLowerCase() === "rejected") return null;

    const reasons = (form.reason || "")
        .split(";")
        .map((r) => r.trim())
        .filter(Boolean);

    if (reasons.length === 0) return null;

    return (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 animate-fade-in">
            <div className="flex items-center gap-2 text-amber-700">
                <Flag size={15} className="shrink-0" />
                <p className="text-[11px] font-bold uppercase tracking-wider">
                    Flagged during extraction · verify {reasons.length === 1 ? "this" : "these"}
                </p>
            </div>
            <ul className="mt-2 space-y-1.5">
                {reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                        <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-500" />
                        <span>{r}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
