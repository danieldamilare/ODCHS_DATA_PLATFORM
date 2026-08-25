import { useState, useEffect } from "react";
import { Upload, CloudUpload, MapPin, Building } from "lucide-react";
import { uploadBatch, getLGAs, getWards, getFacilities } from "../../api/enrollment";

export default function UploadCard({ onBatchCreated }) {
    const [file, setFile] = useState(null);
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
        getWards(lgaId)
            .then(res => setWards(res.data ?? res))
            .catch(() => setError("Couldn't load wards"));
    }, [lgaId]);

    useEffect(() => {
        setFacilityId("");
        setFacilities([]);
        if (!wardId) return;
        getFacilities(wardId)
            .then(res => setFacilities(res.data ?? res))
            .catch(() => setError("Couldn't load facilities"));
    }, [wardId]);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!file) return setError("Select a zip file");
        if (!leaveLocationBlank && (!lgaId || !wardId || !facilityId)) return setError("Select LGA, ward, and facility");

        setUploading(true);
        setUploadProgress(0);
        setError(null);

        const formData = new FormData();
        formData.append("batch_file", file);
        if (batchName.trim()) formData.append("name", batchName.trim());
        
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
                    
                    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 transition-opacity ${leaveLocationBlank ? 'opacity-40 pointer-events-none' : ''}`}>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                <MapPin size={10} className="inline mr-1" />LGA
                            </label>
                            <select value={lgaId} onChange={(e) => setLgaId(e.target.value)} disabled={leaveLocationBlank} className={selectClass}>
                                <option value="">Select LGA</option>
                                {lgas.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Ward</label>
                            <select value={wardId} onChange={(e) => setWardId(e.target.value)} disabled={leaveLocationBlank || !lgaId} className={selectClass}>
                                <option value="">Select Ward</option>
                                {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                <Building size={10} className="inline mr-1" />Facility
                            </label>
                            <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} disabled={leaveLocationBlank || !wardId} className={selectClass}>
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
