import { LayoutDashboard, FileArchive, Activity, ScanLine, BarChart3, Users, LogOut, Shield } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const navItems = [
    { icon: LayoutDashboard, name: "Dashboard", to: "/" },
    { icon: FileArchive, name: "Enrollment", to: "/enrollment" },
    { icon: ScanLine, name: "NIN Validation", to: "/nin" },
    { icon: BarChart3, name: "Encounter Analysis", to: "/encounter" },
];

export default function Sidebar() {
    const { user, isAdmin, logout } = useAuth();

    const initials = `${user?.first_name?.[0] || ""}${user?.last_name?.[0] || ""}`.toUpperCase() || "U";

    return (
        <aside className="w-64 gradient-sidebar text-white flex flex-col shrink-0 select-none">
            {/* Brand Header */}
            <div className="px-6 py-6 border-b border-white/[0.06]">
                <div className="flex items-center gap-3">
                    <div className="gradient-primary rounded-lg p-2">
                        <Activity size={18} />
                    </div>
                    <div>
                        <h1 className="text-base font-bold tracking-tight">ODCHS</h1>
                        <p className="text-[11px] text-slate-400 font-medium">Data Platform</p>
                    </div>
                </div>
            </div>

            {/* Navigation Items */}
            <nav className="flex-1 p-3 space-y-1 mt-1 overflow-y-auto custom-scrollbar">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    return (
                        <NavLink
                            key={item.name}
                            to={item.to}
                            end={item.to === "/"}
                            className={({ isActive }) =>
                                `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                                    isActive
                                        ? "gradient-primary text-white shadow-lg shadow-primary-600/20"
                                        : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
                                }`
                            }
                        >
                            <Icon size={18} />
                            <span>{item.name}</span>
                        </NavLink>
                    );
                })}

                {/* Admin Navigation Section */}
                {isAdmin && (
                    <div className="pt-4 mt-4 border-t border-white/[0.06] space-y-1">
                        <p className="px-4 text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-2">
                            Administration
                        </p>
                        <NavLink
                            to="/admin/users"
                            className={({ isActive }) =>
                                `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                                    isActive
                                        ? "gradient-primary text-white shadow-lg shadow-primary-600/20"
                                        : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
                                }`
                            }
                        >
                            <Users size={18} />
                            <span>User Management</span>
                        </NavLink>
                    </div>
                )}
            </nav>

            {/* User Profile & System Status Footer */}
            <div className="p-3 border-t border-white/[0.06] space-y-2">
                {user && (
                    <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.04]">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg gradient-primary text-white text-xs font-bold flex items-center justify-center shrink-0">
                                {initials}
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-semibold text-white truncate">
                                    {user.first_name} {user.last_name}
                                </p>
                                <p className="text-[10px] text-slate-400 truncate capitalize flex items-center gap-1">
                                    {user.role === "admin" && <Shield size={9} className="text-primary-400" />}
                                    {user.role}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={logout}
                            title="Sign out"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/[0.06] transition-colors cursor-pointer"
                        >
                            <LogOut size={15} />
                        </button>
                    </div>
                )}

                <div className="px-2 flex items-center gap-2 text-[11px] text-slate-500">
                    <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-glow" />
                    System Online
                </div>
            </div>
        </aside>
    );
}
