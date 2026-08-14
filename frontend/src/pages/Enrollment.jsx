import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getBatches } from "../api/enrollment";
import UploadModal from "../components/enrollment/UploadModal";
import StatusBadge from "../components/ui/StatusBadge";
import { Plus, FolderArchive, ChevronRight } from "lucide-react";

export default function Enrollment() {
    const [batches, setBatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState(null);
    const [showUpload, setShowUpload] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        refreshBatches(page);
    }, [page]);

    async function refreshBatches(p) {
        setLoading(true);
        try {
            const res = await getBatches(p);
            setBatches(res.data || []);
            setPagination(res.pagination || null);
        } catch {
            setBatches([]);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="p-8 space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold gradient-text inline-block">Enrollment</h1>
                    <p className="text-sm text-slate-500 mt-1">Manage enrollment batches</p>
                </div>
                <button
                    onClick={() => setShowUpload(true)}
                    className="flex items-center gap-2 gradient-primary rounded-xl text-white px-5 py-2.5 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all"
                >
                    <Plus size={16} />
                    Upload Batch
                </button>
            </div>

            <div className="card overflow-hidden">
                {loading ? (
                    <div className="p-16 text-center">
                        <div className="inline-block w-6 h-6 border-2 border-slate-200 border-t-primary-500 rounded-full animate-spin" />
                    </div>
                ) : batches.length === 0 ? (
                    <div className="p-16 text-center">
                        <FolderArchive size={40} className="mx-auto mb-3 text-slate-300" />
                        <p className="text-slate-400 font-medium">No batches uploaded yet</p>
                        <p className="text-xs text-slate-400 mt-1">Upload your first batch to get started</p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100/80">
                                        <th className="px-6 py-3.5 font-semibold">Batch</th>
                                        <th className="px-6 py-3.5 font-semibold">Forms</th>
                                        <th className="px-6 py-3.5 font-semibold">Status</th>
                                        <th className="px-6 py-3.5 font-semibold">Uploaded</th>
                                        <th className="px-6 py-3.5 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {batches.map((batch) => (
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
                                            <td className="px-6 py-4 text-slate-300 group-hover:text-primary-400 transition-colors">
                                                <ChevronRight size={16} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {pagination && pagination.total_pages > 1 && (
                            <div className="flex items-center justify-center gap-3 py-4 border-t border-slate-100/80">
                                <button
                                    disabled={!pagination.has_prev}
                                    onClick={() => setPage((p) => p - 1)}
                                    className="px-4 py-2 text-sm rounded-xl border border-slate-200 disabled:opacity-40 hover:bg-slate-50 hover:border-slate-300 transition-all font-medium text-slate-600"
                                >
                                    Previous
                                </button>
                                <span className="text-sm text-slate-500 font-medium">
                                    {pagination.page} / {pagination.total_pages}
                                </span>
                                <button
                                    disabled={!pagination.has_next}
                                    onClick={() => setPage((p) => p + 1)}
                                    className="px-4 py-2 text-sm rounded-xl border border-slate-200 disabled:opacity-40 hover:bg-slate-50 hover:border-slate-300 transition-all font-medium text-slate-600"
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {showUpload && (
                <UploadModal
                    onClose={() => setShowUpload(false)}
                    onBatchCreated={(batch) => {
                        setShowUpload(false);
                        navigate(`/enrollment/batches/${batch.id}`);
                    }}
                />
            )}
        </div>
    );
}
