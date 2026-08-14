import { LayoutDashboard, FileArchive, Activity, ScanLine } from "lucide-react";
import { NavLink } from "react-router-dom";

const items = [
    { icon: LayoutDashboard, name: "Dashboard", to: "/" },
    { icon: FileArchive, name: "Enrollment", to: "/enrollment" },
    { icon: ScanLine, name: "NIN Validation", to: "/nin" },
];

export default function Sidebar() {
    return (
        <aside className="w-64 gradient-sidebar text-white flex flex-col shrink-0">
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

            <nav className="flex-1 p-3 space-y-1 mt-1">
                {items.map((item) => {
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
            </nav>

            <div className="p-4 border-t border-white/[0.06]">
                <div className="flex items-center gap-2.5 text-xs text-slate-500">
                    <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-glow" />
                    System Online
                </div>
            </div>
        </aside>
    );
}
