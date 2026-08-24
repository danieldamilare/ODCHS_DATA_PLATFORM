import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import Sidebar from "../components/layout/Sidebar";

export default function MainLayout() {
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden">
            <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
            <main className="flex-1 overflow-auto min-w-0">
                {/* Mobile hamburger — fixed top-left */}
                <button
                    onClick={() => setMobileOpen(true)}
                    className="md:hidden fixed top-4 left-4 z-30 p-2 rounded-lg bg-white border border-slate-200 shadow-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
                    aria-label="Open menu"
                >
                    <Menu size={20} />
                </button>
                <div className="md:pl-0 pl-12">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
