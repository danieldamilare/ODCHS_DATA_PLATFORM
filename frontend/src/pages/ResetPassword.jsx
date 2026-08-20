import { useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { requestReset, confirmReset } from "../api/auth";
import { Activity, Mail, Lock, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 sm:p-12">
            <div className="w-full max-w-md space-y-6 animate-fade-in">
                {/* Header Brand */}
                <div className="flex items-center gap-3 justify-center mb-2">
                    <div className="gradient-primary rounded-xl p-2.5 shadow-md shadow-primary-500/20">
                        <Activity size={22} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-slate-900">ODCHS</h1>
                        <p className="text-xs text-slate-400 font-medium">Data Platform</p>
                    </div>
                </div>

                <div className="card p-6 sm:p-8 space-y-6">
                    {token ? <ConfirmResetForm token={token} /> : <RequestResetForm />}
                </div>

                <div className="text-center">
                    <Link
                        to="/login"
                        className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
                    >
                        <ArrowLeft size={14} />
                        Back to Login
                    </Link>
                </div>
            </div>
        </div>
    );
}

function RequestResetForm() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState(null);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!email || loading) return;

        setLoading(true);
        setError(null);

        try {
            const res = await requestReset(email);
            if (res.success) {
                setSubmitted(true);
            } else {
                setError(res.msg || "Failed to send reset email");
            }
        } catch (err) {
            setError(err?.msg || "Could not process password reset request");
        } finally {
            setLoading(false);
        }
    }

    if (submitted) {
        return (
            <div className="text-center space-y-4 py-4 animate-scale-in">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle2 size={24} />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-slate-900">Check Your Inbox</h2>
                    <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                        If an active account exists for <span className="font-semibold text-slate-700">{email}</span>, we have sent a password reset link.
                    </p>
                </div>
                <p className="text-xs text-slate-400">Please check your spam folder if you do not see it within a few minutes.</p>
            </div>
        );
    }

    return (
        <>
            <div>
                <h2 className="text-xl font-bold text-slate-900">Forgot Password</h2>
                <p className="text-sm text-slate-500 mt-1">Enter your email and we'll send you a password reset link.</p>
            </div>

            {error && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email address</label>
                    <div className="relative">
                        <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="email"
                            required
                            placeholder="name@odchs.gov.ng"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 pl-10 pr-3.5 py-2.5 text-sm input-focus"
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading || !email}
                    className="w-full gradient-primary rounded-xl text-white py-2.5 px-4 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                    <span>{loading ? "Sending link…" : "Send Reset Link"}</span>
                </button>
            </form>
        </>
    );
}

function ConfirmResetForm({ token }) {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState(null);

    const navigate = useNavigate();

    async function handleSubmit(e) {
        e.preventDefault();
        if (password.length < 8) {
            setError("Password must be at least 8 characters long.");
            return;
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const res = await confirmReset({ token, password });
            if (res.success) {
                setSuccess(true);
                setTimeout(() => {
                    navigate("/login", { replace: true });
                }, 2000);
            } else {
                setError(res.msg || "Failed to update password");
            }
        } catch (err) {
            setError(err?.msg || "Password reset token is invalid or has expired");
        } finally {
            setLoading(false);
        }
    }

    if (success) {
        return (
            <div className="text-center space-y-4 py-4 animate-scale-in">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle2 size={24} />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-slate-900">Password Reset Complete</h2>
                    <p className="text-sm text-slate-500 mt-1">Your password has been updated. Redirecting to login…</p>
                </div>
            </div>
        );
    }

    return (
        <>
            <div>
                <h2 className="text-xl font-bold text-slate-900">Set New Password</h2>
                <p className="text-sm text-slate-500 mt-1">Please enter your new password below.</p>
            </div>

            {error && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">New Password</label>
                    <div className="relative">
                        <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type={showPassword ? "text" : "password"}
                            required
                            minLength={8}
                            placeholder="At least 8 characters"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 pl-10 pr-10 py-2.5 text-sm input-focus"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Confirm New Password</label>
                    <div className="relative">
                        <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type={showPassword ? "text" : "password"}
                            required
                            placeholder="Re-enter password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 pl-10 pr-3.5 py-2.5 text-sm input-focus"
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading || !password || !confirmPassword}
                    className="w-full gradient-primary rounded-xl text-white py-2.5 px-4 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                    <span>{loading ? "Updating…" : "Reset Password"}</span>
                </button>
            </form>
        </>
    );
}
