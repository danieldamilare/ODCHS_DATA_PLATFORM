import { useState, useEffect } from "react";
import { Upload, CloudUpload, MapPin, Building, CheckCircle2 } from "lucide-react";
import { uploadBatch, getLGAs, getWards, getFacilities } from "../../api/enrollment";
import { useAuth } from "../../context/AuthContext";

const ADMIN_SCHEMES = [
    {
        id: "bhcpfp",
        name: "BHCPF",
        tag: "Primary Care",
        desc: "Basic Health Care Provision Fund for vulnerable groups",
    },
    {
        id: "oranghis",
        name: "ORANGHIS",
        tag: "Formal Sector",
        desc: "State Health Insurance for civil & public servants + dependants",
    },
    {
        id: "sunshis",
        name: "SUNSHIS",
        tag: "Sunshine Health",
        desc: "Informal sector & community health plans + dependants",
    },
];

export default function UploadCard({ onBatchCreated }) {
    const { user, isAdmin } = useAuth();
    const [file, setFile] = useState(null);
    const [selectedScheme, setSelectedScheme] = useState("bhcpfp");
    const [lgas, setLgas] = useState([]);
    const [wards, setWards] = useState([]);
    const [facilities, setFacilities] = useState([]);

    const [lgaId, setLgaId] = useState("");
    const [wardId, setWardId] = useState("");
    const [facilityId, setFacilityId] = useState("");

    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [error, setError] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [batchName, setBatchName] = useState("");
    const [leaveLocationBlank, setLeaveLocationBlank] = useState(false);

    const effectiveScheme = isAdmin ? (selectedScheme || "bhcpfp") : (user?.scheme || "bhcpfp");
    const isBhcpf = effectiveScheme.toLowerCase() === "bhcpfp";

    useEffect(() => {
        getLGAs()
            .then(res => setLgas(res.data ?? res))
            .catch(() => setError("Couldn't load LGAs"));
    }, []);

    useEffect(() => {
        setWardId("");
        setFacilityId("");
        setWards([]);
        setFacilities([]);
        if (!lgaId) return;
        if (isBhcpf) {
            getWards(lgaId)
                .then(res => setWards(res.data ?? res))
                .catch(() => setError("Couldn't load wards"));
        } else {
            getFacilities(lgaId, effectiveScheme)
                .then(res => setFacilities(res.data ?? res))
                .catch(() => setError("Couldn't load facilities"));
        }
    }, [lgaId, isBhcpf, effectiveScheme]);

    useEffect(() => {
        if (!isBhcpf) return;
        setFacilityId("");
        setFacilities([]);
        if (!wardId) return;
        getFacilities(wardId, "bhcpfp")
            .then(res => setFacilities(res.data ?? res))
            .catch(() => setError("Couldn't load facilities"));
    }, [wardId, isBhcpf]);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!file) return setError("Select a zip file");
        if (!leaveLocationBlank) {
            if (isBhcpf && (!lgaId || !wardId || !facilityId)) {
                return setError("Select LGA, ward, and facility");
            }
            if (!isBhcpf && (!lgaId || !facilityId)) {
                return setError("Select LGA and facility");
            }
        }

        setUploading(true);
        setUploadProgress(0);
        setError(null);

        const formData = new FormData();
        formData.append("batch_file", file);
        if (batchName.trim()) formData.append("name", batchName.trim());
        
        // When admin uploads, send the chosen scheme; otherwise leave empty so user's assigned scheme applies
        if (isAdmin && selectedScheme) {
            formData.append("scheme", selectedScheme);
        }

        if (!leaveLocationBlank) {
            formData.append("lga_no", lgaId);
            formData.append("ward_no", wardId);
            formData.append("facility_no", facilityId);
        }

        try {
            const result = await uploadBatch(formData, (pct) => setUploadProgress(pct));
            onBatchCreated(result.data);
            setFile(null);
        } catch (err) {
            setError(err.msg || "Upload failed");
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    }

    const selectClass = "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm input-focus bg-white disabled:opacity-40 disabled:bg-slate-50 appearance-none";

    return (
        <div>
            <div className="flex items-center gap-3 mb-1">
                <div className="gradient-primary rounded-xl p-2.5 text-white">
                    <CloudUpload size={20} />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-slate-900">Upload Enrollment Batch</h2>
                    <p className="text-sm text-slate-500">Select the facility, then attach the scanned forms.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 mt-5">
                {/* ── Admin Scheme Selector ── */}
                {isAdmin && (
                    <div className="pt-1">
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs font-semibold text-slate-700">
                                Target Scheme <span className="text-primary-600 font-normal">(Admin Selection)</span>
                            </label>
                            <span className="text-[11px] text-slate-400 font-medium">
                                Choose scheme for this batch
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {ADMIN_SCHEMES.map((s) => {
                                const isSelected = selectedScheme === s.id;
                                return (
                                    <button
                                        key={s.id}
                                        type="button"
                                        onClick={() => setSelectedScheme(s.id)}
                                        className={`relative p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                                            isSelected
                                                ? "border-primary-500 bg-primary-50/50 shadow-sm ring-2 ring-primary-500/20"
                                                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <span className="font-bold text-xs text-slate-900 tracking-wide">
                                                {s.name}
                                            </span>
                                            {isSelected ? (
                                                <CheckCircle2 size={16} className="text-primary-600 shrink-0" />
                                            ) : (
                                                <div className="w-4 h-4 rounded-full border border-slate-300 shrink-0" />
                                            )}
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">
                                            {s.desc}
                                        </p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                        Batch Name (Optional)
                    </label>
                    <input
                        type="text"
                        value={batchName}
                        onChange={(e) => setBatchName(e.target.value)}
                        placeholder="e.g. Akure South Enrollees"
                        className={selectClass}
                    />
                </div>

                <div className="pt-2">
                    <label className="flex items-center gap-2 mb-3 text-sm text-slate-700 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={leaveLocationBlank}
                            onChange={(e) => {
                                setLeaveLocationBlank(e.target.checked);
                                if (e.target.checked) {
                                    setLgaId(""); setWardId(""); setFacilityId("");
                                }
                            }}
                            className="w-4 h-4 text-primary-600 rounded border-slate-300 focus:ring-primary-500"
                        />
                        <span>This batch spans multiple locations (leave location blank)</span>
                    </label>
                    
                    <div className={`grid grid-cols-1 ${isBhcpf ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3 transition-opacity ${leaveLocationBlank ? 'opacity-40 pointer-events-none' : ''}`}>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                <MapPin size={10} className="inline mr-1" />LGA
                            </label>
                            <select value={lgaId} onChange={(e) => setLgaId(e.target.value)} disabled={leaveLocationBlank} className={selectClass}>
                                <option value="">Select LGA</option>
                                {lgas.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                        </div>
                        {isBhcpf && (
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Ward</label>
                                <select value={wardId} onChange={(e) => setWardId(e.target.value)} disabled={leaveLocationBlank || !lgaId} className={selectClass}>
                                    <option value="">Select Ward</option>
                                    {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                            </div>
                        )}
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                <Building size={10} className="inline mr-1" />Facility
                            </label>
                            <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} disabled={leaveLocationBlank || (isBhcpf ? !wardId : !lgaId)} className={selectClass}>
                                <option value="">Select Facility</option>
                                {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                <label
                    className={`block border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                        dragOver
                            ? "border-primary-400 bg-primary-50"
                            : file
                                ? "border-emerald-300 bg-emerald-50"
                                : "border-slate-200 hover:border-primary-300 hover:bg-primary-50/30"
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
                    }}
                >
                    <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files[0])} className="hidden" />
                    <Upload size={24} className={`mx-auto mb-3 ${file ? "text-emerald-500" : "text-slate-400"}`} />
                    <div className={`text-sm font-medium ${file ? "text-emerald-700" : "text-slate-600"}`}>
                        {file ? file.name : "Click or drag to upload ZIP file"}
                    </div>
                    {!file && <p className="text-xs text-slate-400 mt-1">Scanned enrollment forms in ZIP format</p>}
                </label>

                {error && (
                    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
                        <span className="text-base">!</span>
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={uploading}
                    className="w-full relative overflow-hidden rounded-xl py-3 text-sm font-semibold transition-all disabled:cursor-not-allowed mt-2"
                >
                    <div 
                        className="absolute inset-0 bg-primary-600"
                        style={{
                            background: uploading ? "#94a3b8" : undefined
                        }}
                    />
                    {!uploading && (
                        <div className="absolute inset-0 gradient-primary hover:shadow-lg hover:shadow-primary-500/25 transition-all" />
                    )}
                    {uploading && uploadProgress < 100 && (
                        <div 
                            className="absolute inset-y-0 left-0 bg-primary-900/30 transition-all duration-300" 
                            style={{ width: `${uploadProgress}%` }}
                        />
                    )}
                    <div className="relative flex justify-center items-center gap-2 text-white z-10">
                        <Upload size={16} />
                        <span>
                            {uploading 
                                ? uploadProgress < 100 
                                    ? `Uploading... ${uploadProgress}%` 
                                    : "Processing..." 
                                : "Upload Batch"}
                        </span>
                    </div>
                </button>
            </form>
        </div>
    );
}
