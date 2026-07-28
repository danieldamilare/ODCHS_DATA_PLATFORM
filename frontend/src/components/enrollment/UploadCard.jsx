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
    const [error, setError] = useState(null);
    const [dragOver, setDragOver] = useState(false);

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
        if (!lgaId || !wardId || !facilityId) return setError("Select LGA, ward, and facility");

        setUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append("batch_file", file);
        formData.append("lga_no", lgaId);
        formData.append("ward_no", wardId);
        formData.append("facility_no", facilityId);

        try {
            const result = await uploadBatch(formData);
            onBatchCreated(result.data);
            setFile(null);
        } catch (err) {
            setError(err.msg || "Upload failed");
        } finally {
            setUploading(false);
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            <MapPin size={10} className="inline mr-1" />LGA
                        </label>
                        <select value={lgaId} onChange={(e) => setLgaId(e.target.value)} className={selectClass}>
                            <option value="">Select LGA</option>
                            {lgas.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">Ward</label>
                        <select value={wardId} onChange={(e) => setWardId(e.target.value)} disabled={!lgaId} className={selectClass}>
                            <option value="">Select Ward</option>
                            {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            <Building size={10} className="inline mr-1" />Facility
                        </label>
                        <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} disabled={!wardId} className={selectClass}>
                            <option value="">Select Facility</option>
                            {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
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
                    className="w-full gradient-primary rounded-xl text-white py-3 text-sm font-semibold disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-primary-500/25 flex justify-center items-center gap-2"
                >
                    <Upload size={16} />
                    {uploading ? "Uploading..." : "Upload Batch"}
                </button>
            </form>
        </div>
    );
}
