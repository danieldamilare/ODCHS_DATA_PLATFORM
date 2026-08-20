import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { verifyToken, activateAccount } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { Activity, CheckCircle2, AlertCircle, Loader2, Lock, Eye, EyeOff } from "lucide-react";

export default function ActivateAccount() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");

    const [verifying, setVerifying] = useState(true);
    const [tokenValid, setTokenValid] = useState(false);
    const [userInfo, setUserInfo] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);
    const [activated, setActivated] = useState(false);

    const { refreshUser } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!token) {
            setVerifying(false);
            setErrorMessage("No activation token provided. Please use the link sent to your email.");
            return;
        }

        async function verify() {
            setVerifying(true);
            try {
                const res = await verifyToken(token);
                if (res.success && res.data) {
                    setTokenValid(true);
                    setUserInfo(res.data);
                } else {
                    setTokenValid(false);
                    setErrorMessage(res.msg || "Invalid or expired activation link.");
                }
            } catch (err) {
                setTokenValid(false);
                setErrorMessage(err?.msg || "The activation link has expired or is invalid.");
            } finally {
                setVerifying(false);
            }
        }

        verify();
    }, [token]);

    async function handleActivate(e) {
        e.preventDefault();
        if (password.length < 8) {
            setSubmitError("Password must be at least 8 characters long.");
            return;
        }
        if (password !== confirmPassword) {
            setSubmitError("Passwords do not match.");
            return;
        }

        setSubmitting(true);
        setSubmitError(null);

        try {
            const res = await activateAccount({ token, password });
            if (res.success) {
                setActivated(true);
                await refreshUser();
                setTimeout(() => {
                    navigate("/", { replace: true });
                }, 2000);
            } else {
                setSubmitError(res.msg || "Failed to activate account.");
            }
        } catch (err) {
            setSubmitError(err?.msg || "An error occurred during activation.");
        } finally {
            setSubmitting(false);
        }
    }

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
                    {verifying ? (
                        <div className="py-12 text-center space-y-3">
                            <Loader2 size={32} className="mx-auto text-primary-500 animate-spin" />
                            <p className="text-sm font-medium text-slate-600">Verifying activation link…</p>
                        </div>
                    ) : !tokenValid ? (
                        <div className="text-center space-y-4 py-4">
                            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                                <AlertCircle size={24} />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">Activation Link Invalid</h2>
                                <p className="text-sm text-slate-500 mt-1">{errorMessage}</p>
                            </div>
                            <div className="pt-2">
                                <Link
                                    to="/login"
                                    className="inline-flex items-center justify-center gradient-primary text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all"
                                >
                                    Back to Login
                                </Link>
                            </div>
                        </div>
                    ) : activated ? (
                        <div className="text-center space-y-4 py-6 animate-scale-in">
                            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                                <CheckCircle2 size={24} />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">Account Activated!</h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    Welcome, {userInfo?.first_name}! Redirecting to dashboard…
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">Activate Your Account</h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    Hello <span className="font-semibold text-slate-700">{userInfo?.first_name} {userInfo?.last_name}</span> ({userInfo?.email}), please set a password to activate your account.
                                </p>
                            </div>

                            {submitError && (
                                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                    <span>{submitError}</span>
                                </div>
                            )}

                            <form onSubmit={handleActivate} className="space-y-4">
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
                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Confirm Password</label>
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
                                    disabled={submitting || !password || !confirmPassword}
                                    className="w-full gradient-primary rounded-xl text-white py-2.5 px-4 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                                >
                                    {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                                    <span>{submitting ? "Activating…" : "Set Password & Activate"}</span>
                                </button>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
