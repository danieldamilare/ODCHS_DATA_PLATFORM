/**
 * Single source of truth for form status behavior, styling, and capabilities.
 * Every status-dependent UI decision reads from here.
 */

export const STATUS = {
    READY: "ready",
    PENDING: "pending",
    ENROLLED: "enrolled",
    ALREADY_EXIST: "already_exist",
    FAILED: "failed",
    REJECTED: "rejected",
    NEED_RESCAN: "need_rescan",
    ERROR: "error",
};

const STATUS_CONFIG = {
    [STATUS.READY]: {
        label: "Ready",
        color: {
            bg: "bg-slate-50",
            text: "text-slate-700",
            dot: "bg-slate-500",
            banner: "bg-slate-50 border-slate-200 text-slate-700",
        },
        editable: true,
        enrollable: true,
        banner: null, // No banner unless flagged
        description: "Ready for review",
    },
    [STATUS.PENDING]: {
        label: "Pending",
        color: {
            bg: "bg-blue-50",
            text: "text-blue-700",
            dot: "bg-blue-500",
            banner: "bg-blue-50 border-blue-200 text-blue-700",
        },
        editable: true, // backend update_form permits it; simply not surfaced for review while pending
        enrollable: true,
        banner: {
            icon: "⏳",
            message: "Processing in queue",
            tone: "info",
        },
        description: "Queued for processing",
    },
    [STATUS.ENROLLED]: {
        label: "Enrolled",
        color: {
            bg: "bg-emerald-50",
            text: "text-emerald-700",
            dot: "bg-emerald-500",
            banner: "bg-emerald-50 border-emerald-200 text-emerald-700",
        },
        editable: true, // no frontend gating — backend is the single enforcement point
        enrollable: true,
        banner: {
            icon: "✓",
            message: (form) => `Enrolled · pushed to HIS ${form.enrolled_at ? new Date(form.enrolled_at).toLocaleDateString() : ""} · locked`,
            tone: "success",
        },
        description: "Successfully enrolled in HIS",
    },
    [STATUS.ALREADY_EXIST]: {
        label: "Already Exists",
        color: {
            bg: "bg-slate-100",
            text: "text-slate-600",
            dot: "bg-slate-400",
            banner: "bg-slate-50 border-slate-200 text-slate-600",
        },
        editable: true, // Allow name tweaks for collision resolution
        enrollable: true,
        banner: {
            icon: "ⓘ",
            message: "Already registered in HIS",
            tone: "neutral",
        },
        description: "Duplicate detected in HIS",
    },
    [STATUS.FAILED]: {
        label: "Failed",
        color: {
            bg: "bg-red-50",
            text: "text-red-700",
            dot: "bg-red-500",
            banner: "bg-red-50 border-red-200 text-red-700",
        },
        editable: true,
        enrollable: true, // Retry allowed
        banner: {
            icon: "✕",
            message: (form) => `Enrollment failed · ${form.error_message || "network error"}`,
            tone: "error",
            actions: ["retry_enroll"],
        },
        description: "HIS enrollment failed",
    },
    [STATUS.REJECTED]: {
        label: "Rejected",
        color: {
            bg: "bg-slate-100",
            text: "text-slate-600",
            dot: "bg-slate-400",
            banner: "bg-slate-50 border-slate-200 text-slate-600",
        },
        editable: true,
        enrollable: true, // Override allowed
        banner: {
            icon: "⊘",
            message: (form) => `Rejected · ${form.reason || ""}`,
            tone: "neutral",
        },
        description: "Manually rejected",
    },
    [STATUS.NEED_RESCAN]: {
        label: "Needs Rescan",
        color: {
            bg: "bg-amber-50",
            text: "text-amber-700",
            dot: "bg-amber-500",
            banner: "bg-amber-50 border-amber-200 text-amber-700",
        },
        editable: true, // reviewer may hand-key from the scan; backend update_form permits it
        enrollable: true,
        banner: {
            icon: "⚠",
            message: (form) => form.reason || "Needs a clearer scan",
            tone: "warning",
            actions: ["rescan", "reprocess"],
        },
        description: "Scan quality insufficient",
    },
    [STATUS.ERROR]: {
        label: "Error",
        color: {
            bg: "bg-red-50",
            text: "text-red-700",
            dot: "bg-red-500",
            banner: "bg-red-50 border-red-200 text-red-700",
        },
        editable: true, // reviewer may hand-key from the scan; backend update_form permits it
        enrollable: true,
        banner: {
            icon: "✕",
            message: (form) => `Processing error · ${form.error_message || "extraction failed"}`,
            tone: "error",
            actions: ["reprocess"],
        },
        description: "Local processing failed",
    },
};

/**
 * Get full configuration for a known form status, or null if unrecognized.
 * Returning null (rather than a default) lets callers choose a safe fallback:
 * capabilities lock, the badge shows the raw string instead of "Ready".
 */
export function getStatusConfig(status) {
    const normalized = status?.toLowerCase();
    return STATUS_CONFIG[normalized] || null;
}

/**
 * Check if a form can be edited. Unknown status → locked (safe default).
 */
export function canEdit(status) {
    return getStatusConfig(status)?.editable ?? false;
}

/**
 * Check if a form can be enrolled. Unknown status → not enrollable (safe default).
 */
export function canEnroll(status) {
    return getStatusConfig(status)?.enrollable ?? false;
}

/**
 * Get allowed actions for a status in manual mode (batch row or toolbar)
 */
export function getActions(status) {
    const normalized = status?.toLowerCase();
    const actions = [];

    // Review is always available
    actions.push("review");

    // Downloads
    if (normalized === STATUS.ENROLLED) {
        actions.push("download_form", "download_idcard");
    } else if (normalized !== STATUS.PENDING) {
        actions.push("download_form");
    }

    // Reprocess/Rescan
    if (normalized === STATUS.ERROR || normalized === STATUS.NEED_RESCAN) {
        actions.push("reprocess");
    }
    if (normalized === STATUS.NEED_RESCAN) {
        actions.push("rescan");
    }

    return actions;
}

/**
 * Get banner configuration for a form
 */
export function getBanner(form) {
    if (!form) return null;
    const config = getStatusConfig(form.status);
    if (!config || !config.banner) return null;

    const { icon, message, tone, actions = [] } = config.banner;
    return {
        icon,
        message: typeof message === "function" ? message(form) : message,
        tone,
        actions,
        color: config.color.banner,
    };
}
