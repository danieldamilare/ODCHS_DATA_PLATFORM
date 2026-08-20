import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Activity, Eye, EyeOff, Loader2, Lock, Mail, AlertCircle } from "lucide-react";

export default function Login() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const { login, isAuthenticated, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const fromPath = location.state?.from?.pathname;
    const destination = !fromPath || fromPath === "/login" ? "/" : fromPath;

    useEffect(() => {
        if (isAuthenticated && !authLoading) {
            navigate(destination, { replace: true });
        }
    }, [isAuthenticated, authLoading, navigate, destination]);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!email || !password || loading) return;

        setLoading(true);
        setError(null);

        try {
            const res = await login(email, password);
            if (res.success) {
                navigate(from, { replace: true });
            } else {
                setError(res.msg || "Authentication failed");
            }
        } catch (err) {
            setError(err?.msg || err?.message || "Invalid email or password");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex h-screen w-full overflow-hidden bg-slate-50">
            {/* Left Brand Panel */}
            <div className="hidden lg:flex lg:w-5/12 gradient-sidebar text-white flex-col justify-between p-12 relative overflow-hidden shrink-0">
                {/* Background Subtle Accent */}
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-primary-600/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-accent-600/10 rounded-full blur-3xl pointer-events-none" />

                <div className="space-y-6 relative z-10">
                    <div className="flex items-center gap-3">
                        <div className="gradient-primary rounded-xl p-2.5 shadow-lg shadow-primary-500/20">
                            <Activity size={24} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight">ODCHS</h1>
                            <p className="text-xs text-slate-400 font-medium">Data Platform</p>
                        </div>
                    </div>
                    <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
                        Monitoring & Evaluation Internal Platform for healthcare data management and analytics.
                    </p>
                </div>

                <div className="relative z-10 flex items-center gap-2.5 text-xs text-slate-500">
                    <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-glow" />
                    System Online
                </div>
            </div>

            {/* Right Form Panel */}
            <div className="flex-1 flex items-center justify-center p-6 sm:p-12 overflow-y-auto">
                <div className="w-full max-w-md space-y-8 animate-fade-in">
                    {/* Mobile Brand Header */}
                    <div className="lg:hidden flex items-center gap-3 justify-center mb-4">
                        <div className="gradient-primary rounded-xl p-2">
                            <Activity size={20} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold tracking-tight text-slate-900">ODCHS</h1>
                            <p className="text-[11px] text-slate-500 font-medium">Data Platform</p>
                        </div>
                    </div>

                    <div>
                        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Welcome back</h2>
                        <p className="text-sm text-slate-500 mt-1.5">Sign in to access your dashboard</p>
                    </div>

                    {error && (
                        <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200/60 text-rose-700 text-sm animate-shake">
                            <AlertCircle size={18} className="shrink-0 mt-0.5" />
                            <span>{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="card p-6 sm:p-8 space-y-5">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email address</label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="email"
                                    required
                                    autoFocus
                                    placeholder="name@odchs.gov.ng"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 pl-10 pr-3.5 py-2.5 text-sm input-focus text-slate-800 placeholder:text-slate-400 bg-white"
                                />
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-xs font-semibold text-slate-700">Password</label>
                                <Link
                                    to="/auth/reset-password"
                                    className="text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
                                >
                                    Forgot password?
                                </Link>
                            </div>
                            <div className="relative">
                                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    required
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 pl-10 pr-10 py-2.5 text-sm input-focus text-slate-800 placeholder:text-slate-400 bg-white"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !email || !password}
                            className="w-full gradient-primary rounded-xl text-white py-2.5 px-4 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                        >
                            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                            <span>{loading ? "Signing in…" : "Sign in"}</span>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
