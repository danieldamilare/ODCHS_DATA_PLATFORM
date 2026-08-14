import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getBatches } from "../api/enrollment";
import { FolderArchive, Clock, CheckCircle2, ChevronRight } from "lucide-react";
import StatusBadge from "../components/ui/StatusBadge";

const STAT_CARDS = [
    { key: "total", label: "Total Batches", icon: FolderArchive, gradient: "from-primary-500 to-primary-600", shadow: "shadow-primary-500/20" },
    { key: "processing", label: "Processing", icon: Clock, gradient: "from-amber-400 to-amber-500", shadow: "shadow-amber-500/20" },
    { key: "done", label: "Completed", icon: CheckCircle2, gradient: "from-emerald-400 to-emerald-500", shadow: "shadow-emerald-500/20" },
];

export default function Dashboard() {
    const [batches, setBatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        getBatches(1)
            .then((res) => setBatches(res.data || []))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const total = batches.length;
    const processing = batches.filter((b) => b.status === "PROCESSING").length;
    const done = batches.filter((b) => b.status === "DONE").length;
    const counts = { total, processing, done };

    return (
        <div className="p-8 space-y-8 animate-fade-in">
            <div>
                <h1 className="text-2xl font-bold gradient-text inline-block">Dashboard</h1>
                <p className="text-sm text-slate-500 mt-1">Overview of enrollment activity</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {STAT_CARDS.map((card) => {
                    const Icon = card.icon;
                    return (
                        <div key={card.key} className="card card-hover p-5 group">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-slate-500 font-medium">{card.label}</p>
                                    <p className="text-3xl font-bold text-slate-900 mt-1.5">{counts[card.key]}</p>
                                </div>
                                <div className={`bg-gradient-to-br ${card.gradient} rounded-xl p-3 text-white shadow-lg ${card.shadow} group-hover:scale-105 transition-transform`}>
                                    <Icon size={22} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="card overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100/80">
                    <h2 className="font-semibold text-slate-800">Recent Batches</h2>
                    <button
                        onClick={() => navigate("/enrollment")}
                        className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1 transition-colors"
                    >
                        View all <ChevronRight size={14} />
                    </button>
                </div>

                {loading ? (
                    <div className="p-12 text-center text-slate-400">
                        <div className="inline-block w-6 h-6 border-2 border-slate-200 border-t-primary-500 rounded-full animate-spin" />
                    </div>
                ) : batches.length === 0 ? (
                    <div className="p-16 text-center">
                        <FolderArchive size={40} className="mx-auto mb-3 text-slate-300" />
                        <p className="text-slate-400 font-medium">No batches uploaded yet</p>
                        <p className="text-xs text-slate-400 mt-1">Upload your first batch to get started</p>
                    </div>
                ) : (
                    <table className="w-full">
                        <thead>
                            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100/80">
                                <th className="px-6 py-3 font-semibold">Batch</th>
                                <th className="px-6 py-3 font-semibold">Forms</th>
                                <th className="px-6 py-3 font-semibold">Status</th>
                                <th className="px-6 py-3 font-semibold">Uploaded</th>
                            </tr>
                        </thead>
                        <tbody>
                            {batches.slice(0, 5).map((batch) => (
                                <tr
                                    key={batch.id}
                                    onClick={() => navigate(`/enrollment/batches/${batch.id}`)}
                                    className="border-b border-slate-50 hover:bg-primary-50/30 cursor-pointer transition-colors group"
                                >
                                    <td className="px-6 py-4">
                                        <div className="font-mono text-sm text-slate-700 group-hover:text-primary-700 transition-colors">{batch.id.slice(0, 8)}</div>
                                        <div className="text-xs text-slate-400 mt-0.5">
                                            {batch.lga || batch.ward ? `${batch.lga || "—"} / ${batch.ward || "—"}` : "Location pending"}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm font-medium text-slate-600">{batch.total}</td>
                                    <td className="px-6 py-4"><StatusBadge status={batch.status} /></td>
                                    <td className="px-6 py-4 text-sm text-slate-500">
                                        {batch.submitted_at ? new Date(batch.submitted_at).toLocaleDateString() : "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
