import { useState } from "react";
import { reactivateUser } from "../../api/admin";
import { X, Calendar, Infinity as InfinityIcon, Loader2, UserCheck, AlertCircle } from "lucide-react";
import { useToast } from "../ui/Toast";

export default function ReactivateUserModal({ user, isOpen, onClose, onUserReactivated }) {
    const [expiryType, setExpiryType] = useState("never");
    const [expiryDate, setExpiryDate] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const toast = useToast();

    if (!isOpen || !user) return null;

    async function handleReactivate(e) {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const newExpiry = expiryType === "date" && expiryDate ? new Date(expiryDate).toISOString() : null;

        try {
            const res = await reactivateUser(user.uuid, newExpiry);
            if (res.success) {
                toast?.success?.(res.msg || "User reactivated successfully");
                onUserReactivated?.();
                onClose();
            } else {
                setError(res.msg || "Failed to reactivate user");
            }
        } catch (err) {
            setError(err?.msg || "An error occurred while reactivating user");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-fade-in"
                onClick={onClose}
            />

            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-5 animate-scale-in z-10">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                            <UserCheck size={18} />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-900">Reactivate Account</h3>
                            <p className="text-xs text-slate-500">{user.first_name} {user.last_name}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    >
                        <X size={16} />
                    </button>
                </div>

                {error && (
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                        <AlertCircle size={15} className="shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleReactivate} className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Account Expiry</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setExpiryType("never")}
                                className={`flex items-center justify-center gap-1.5 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                                    expiryType === "never"
                                        ? "border-primary-500 bg-primary-50 text-primary-700 font-semibold"
                                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                                }`}
                            >
                                <InfinityIcon size={14} />
                                Never expires
                            </button>
                            <button
                                type="button"
                                onClick={() => setExpiryType("date")}
                                className={`flex items-center justify-center gap-1.5 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                                    expiryType === "date"
                                        ? "border-primary-500 bg-primary-50 text-primary-700 font-semibold"
                                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                                }`}
                            >
                                <Calendar size={14} />
                                Set new date
                            </button>
                        </div>

                        {expiryType === "date" && (
                            <div className="mt-2.5 animate-fade-in">
                                <input
                                    type="date"
                                    required
                                    min={new Date().toISOString().split("T")[0]}
                                    value={expiryDate}
                                    onChange={(e) => setExpiryDate(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm input-focus"
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-2.5 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || (expiryType === "date" && !expiryDate)}
                            className="gradient-primary text-white px-4 py-2 rounded-xl text-xs font-semibold hover:shadow-md hover:shadow-primary-500/20 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                        >
                            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                            <span>{loading ? "Reactivating…" : "Reactivate User"}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
