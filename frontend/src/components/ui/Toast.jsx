import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";

const ToastContext = createContext();

let toastId = 0;

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((msg, variant = "success", duration = 4000) => {
        const id = ++toastId;
        setToasts((prev) => [...prev, { id, msg, variant }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
    }, []);

    const toast = useMemo(() => ({
        success: (msg) => addToast(msg, "success"),
        warn: (msg) => addToast(msg, "warn", 6000),
        error: (msg) => addToast(msg, "error", 6000),
    }), [addToast]);

    return (
        <ToastContext.Provider value={toast}>
            {children}
            <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
                {toasts.map((t) => (
                    <Toast key={t.id} toast={t} onDismiss={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    return useContext(ToastContext);
}

const VARIANTS = {
    success: "bg-emerald-600/95 backdrop-blur-sm border border-emerald-500/30",
    warn: "bg-amber-500/95 backdrop-blur-sm border border-amber-400/30",
    error: "bg-red-600/95 backdrop-blur-sm border border-red-500/30",
};

const ICONS = {
    success: CheckCircle,
    warn: AlertTriangle,
    error: XCircle,
};

function Toast({ toast, onDismiss }) {
    const Icon = ICONS[toast.variant];
    return (
        <div
            onClick={onDismiss}
            className={`pointer-events-auto flex items-center gap-3 rounded-xl px-5 py-3.5 text-white cursor-pointer transition-all animate-slide-in ${VARIANTS[toast.variant]}`}
            style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1)" }}
        >
            <Icon size={18} className="shrink-0" />
            <span className="text-sm font-medium">{toast.msg}</span>
        </div>
    );
}
