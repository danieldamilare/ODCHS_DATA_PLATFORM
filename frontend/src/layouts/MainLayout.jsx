import { Outlet } from "react-router-dom";
import Sidebar from "../components/layout/Sidebar";

export default function MainLayout() {
    return (
        <div className="flex h-screen bg-slate-50">
            <Sidebar />
            <main className="flex-1 overflow-auto min-w-0">
                <Outlet />
            </main>
        </div>
    );
}
