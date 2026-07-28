import { X } from "lucide-react";
import UploadCard from "./UploadCard";

export default function UploadModal({ onClose, onBatchCreated }) {
    return (
        <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="card w-full max-w-lg relative animate-scale-in" style={{ boxShadow: "var(--shadow-elevated)" }}>
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
                >
                    <X size={18} />
                </button>
                <div className="p-6">
                    <UploadCard onBatchCreated={onBatchCreated} />
                </div>
            </div>
        </div>
    );
}
