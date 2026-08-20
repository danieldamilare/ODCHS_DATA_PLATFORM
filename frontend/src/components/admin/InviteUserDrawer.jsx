import { useState } from "react";
import { createUser } from "../../api/admin";
import { X, Mail, User, Shield, Calendar, Infinity as InfinityIcon, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "../ui/Toast";

export default function InviteUserDrawer({ isOpen, onClose, onUserCreated }) {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("user");
    const [expiryType, setExpiryType] = useState("never"); // "never" | "date"
    const [expiryDate, setExpiryDate] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const toast = useToast();

    if (!isOpen) return null;

    async function handleSubmit(e) {
        e.preventDefault();
        if (!firstName || !lastName || !email || loading) return;

        setLoading(true);
        setError(null);

        const payload = {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            email: email.trim().toLowerCase(),
            role,
            expiry_date: expiryType === "date" && expiryDate ? new Date(expiryDate).toISOString() : null,
        };

        try {
            const res = await createUser(payload);
            if (res.success) {
                toast?.success?.(res.msg || "User invitation sent successfully!");
                // Reset form
                setFirstName("");
                setLastName("");
                setEmail("");
                setRole("user");
                setExpiryType("never");
                setExpiryDate("");
                onUserCreated?.();
                onClose();
            } else {
                setError(res.msg || "Failed to invite user");
            }
        } catch (err) {
            setError(err?.msg || err?.message || "Failed to create user invitation");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 overflow-hidden">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-fade-in"
                onClick={onClose}
            />

            <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
                <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col animate-slide-in">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">Invite New Staff</h2>
                            <p className="text-xs text-slate-500 mt-0.5">Send an account invitation email</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Form Body */}
                    <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
                        {error && (
                            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                    First Name <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    minLength={3}
                                    maxLength={25}
                                    placeholder="John"
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm input-focus"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                    Last Name <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    minLength={3}
                                    maxLength={25}
                                    placeholder="Doe"
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm input-focus"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                Email Address <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="email"
                                    required
                                    placeholder="staff@odchs.gov.ng"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 pl-10 pr-3.5 py-2 text-sm input-focus"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Role</label>
                            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                                <button
                                    type="button"
                                    onClick={() => setRole("user")}
                                    className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all ${
                                        role === "user"
                                            ? "bg-white text-slate-900 shadow-sm"
                                            : "text-slate-500 hover:text-slate-700"
                                    }`}
                                >
                                    <User size={14} />
                                    Staff User
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRole("admin")}
                                    className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all ${
                                        role === "admin"
                                            ? "gradient-primary text-white shadow-sm"
                                            : "text-slate-500 hover:text-slate-700"
                                    }`}
                                >
                                    <Shield size={14} />
                                    Administrator
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Account Expiry</label>
                            <div className="grid grid-cols-2 gap-2.5">
                                <button
                                    type="button"
                                    onClick={() => setExpiryType("never")}
                                    className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border text-center transition-all cursor-pointer ${
                                        expiryType === "never"
                                            ? "border-primary-500 bg-primary-50/40 text-primary-700 font-semibold"
                                            : "border-slate-200 bg-slate-50/50 text-slate-600 hover:bg-slate-100"
                                    }`}
                                >
                                    <InfinityIcon size={18} />
                                    <span className="text-xs">Never expires</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setExpiryType("date")}
                                    className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border text-center transition-all cursor-pointer ${
                                        expiryType === "date"
                                            ? "border-primary-500 bg-primary-50/40 text-primary-700 font-semibold"
                                            : "border-slate-200 bg-slate-50/50 text-slate-600 hover:bg-slate-100"
                                    }`}
                                >
                                    <Calendar size={18} />
                                    <span className="text-xs">Set expiry date</span>
                                </button>
                            </div>

                            {expiryType === "date" && (
                                <div className="mt-3 animate-fade-in">
                                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Expiration Date</label>
                                    <input
                                        type="date"
                                        required={expiryType === "date"}
                                        min={new Date().toISOString().split("T")[0]}
                                        value={expiryDate}
                                        onChange={(e) => setExpiryDate(e.target.value)}
                                        className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm input-focus"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-100 text-xs text-slate-500">
                            <p>An email with an activation link will be sent to the recipient. The link is valid for 48 hours.</p>
                        </div>
                    </form>

                    {/* Footer Actions */}
                    <div className="p-4 px-6 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm rounded-xl border border-slate-200 hover:bg-white text-slate-600 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={loading || !firstName || !lastName || !email || (expiryType === "date" && !expiryDate)}
                            className="gradient-primary text-white px-5 py-2 rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                        >
                            {loading ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                            <span>{loading ? "Sending Invitation…" : "Send Invitation"}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
