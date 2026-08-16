import { CheckCircle, XCircle, AlertTriangle, Info, Clock } from "lucide-react";
import { getBanner } from "../../constants/formStatus";

/**
 * Non-intrusive, single-line status banner driven by the form status descriptor.
 * Renders nothing for statuses that carry no banner (e.g. a clean `ready` form).
 * Icon inherits the banner's text color for a cohesive, subtle look.
 */
const TONE_ICON = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertTriangle,
    info: Clock,
    neutral: Info,
};

export default function StatusBanner({ form }) {
    const banner = getBanner(form);
    if (!banner) return null;

    const Icon = TONE_ICON[banner.tone] || Info;
    return (
        <div
            className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm font-medium animate-fade-in ${banner.color}`}
        >
            <Icon size={16} className="shrink-0" />
            <span>{banner.message}</span>
        </div>
    );
}
