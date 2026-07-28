import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getForm, updateForm, uploadPassport, rejectForm, enrollForm, getLGAs, getWards, getFacilities, getBatchForms, getCategories } from "../api/enrollment";
import { useToast } from "../components/ui/Toast";
import CropModal from "../components/enrollment/CropModal";
import { ArrowLeft, Upload, Crop, User, Loader2, CheckCircle, AlertTriangle, XCircle, Info } from "lucide-react";

/* ── Required fields (mirrors backend FormUpdater) ── */
const REQUIRED = new Set([
    "title", "surname", "firstname", "dob", "settlement", "gender",
    "phone_number", "nin", "address", "category", "marital_status",
    "kin_firstname", "kin_surname", "kin_relationship", "kin_phone_number",
    "kin_address", "lga_no", "ward_no", "facility_no",
]);

/* ── Field definitions ── */
const PERSONAL_FIELDS = [
    { key: "title", label: "Title", type: "select", options: ["Mr", "Mrs", "Miss", "Master", "Chief"], grid: "col-span-1" },
    { key: "surname", label: "Surname", grid: "col-span-1" },
    { key: "firstname", label: "First Name", grid: "col-span-1" },
    { key: "othername", label: "Other Name", grid: "col-span-1" },
    { key: "dob", label: "Date of Birth", type: "date", grid: "col-span-1" },
    { key: "gender", label: "Gender", type: "select", options: ["Male", "Female"], grid: "col-span-1" },
    { key: "phone_number", label: "Phone", type: "phone", grid: "col-span-1" },
    { key: "nin", label: "NIN", type: "nin", grid: "col-span-1" },
    { key: "address", label: "Address", type: "textarea", grid: "col-span-2" },
    { key: "marital_status", label: "Marital Status", type: "select", options: [
        { value: "", label: "—" },
        { value: "Single", label: "Single" },
        { value: "Married", label: "Married" },
        { value: "Divorced", label: "Divorced" },
        { value: "Widow", label: "Widow" },
    ], grid: "col-span-1" },
    { key: "settlement", label: "Settlement", type: "select", options: [
        { value: "", label: "—" },
        { value: "Urban", label: "Urban" },
        { value: "Rural", label: "Rural" },
    ], grid: "col-span-1" },
    { key: "occupation", label: "Occupation", grid: "col-span-1" },
    { key: "category", label: "Category", type: "cascade_category", grid: "col-span-1" },
];

const LOCATION_FIELDS = [
    { key: "lga_no", label: "LGA", type: "cascade_lga", grid: "col-span-1" },
    { key: "ward_no", label: "Ward", type: "cascade_ward", grid: "col-span-1" },
    { key: "facility_no", label: "Facility", type: "cascade_facility", grid: "col-span-1" },
];

const KIN_FIELDS = [
    { key: "kin_surname", label: "Surname", grid: "col-span-1" },
    { key: "kin_firstname", label: "First Name", grid: "col-span-1" },
    { key: "kin_othername", label: "Other Name", grid: "col-span-1" },
    { key: "kin_relationship", label: "Relationship", grid: "col-span-1" },
    { key: "kin_phone_number", label: "Phone", grid: "col-span-1" },
    { key: "kin_address", label: "Address", type: "textarea", grid: "col-span-2" },
];

const PREFETCH_COUNT = 5;

export default function FormReview() {
    const { formId: routeFormId, batchId } = useParams();
    const navigate = useNavigate();
    const toast = useToast();

    const isReviewMode = !!batchId;

    // Review queue
    const [queue, setQueue] = useState([]);
    const [queueIndex, setQueueIndex] = useState(0);
    const [queueHasMore, setQueueHasMore] = useState(true);
    const [reviewComplete, setReviewComplete] = useState(false);
    const [reviewedCount, setReviewedCount] = useState(0);
    const prefetchingRef = useRef(false);

    // Form state
    const [currentFormId, setCurrentFormId] = useState(routeFormId || null);
    const [form, setForm] = useState(null);
    const [fields, setFields] = useState({});
    const [loading, setLoading] = useState(true);
    const [enrolling, setEnrolling] = useState(false);
    const [touched, setTouched] = useState({});

    // Passport
    const [passportFile, setPassportFile] = useState(null);
    const [useAvatar, setUseAvatar] = useState(false);
    const [cropCoords, setCropCoords] = useState(null);
    const [showCropModal, setShowCropModal] = useState(false);
    const [croppedPreview, setCroppedPreview] = useState(null);
    const passportRef = useRef();

    // Reject
    const [showReject, setShowReject] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const [rejecting, setRejecting] = useState(false);

    // Cascading dropdowns
    const [lgas, setLgas] = useState([]);
    const [wards, setWards] = useState([]);
    const [facilities, setFacilities] = useState([]);
    const [categories, setCategories] = useState([]);

    // ═══════════════ Review queue ═══════════════

    useEffect(() => {
        if (!isReviewMode) return;
        fetchReviewBatch();
    }, [batchId]);

    async function fetchReviewBatch(after) {
        if (prefetchingRef.current) return;
        prefetchingRef.current = true;
        try {
            const res = await getBatchForms(batchId, { status: "ready", after, count: PREFETCH_COUNT });
            const newForms = res.data || [];
            setQueueHasMore(res.has_more || false);
            if (newForms.length === 0 && !after) {
                setReviewComplete(true);
                setLoading(false);
                return;
            }
            setQueue((prev) => [...prev, ...newForms]);
            if (!after) {
                setCurrentFormId(newForms[0]?.id);
                setQueueIndex(0);
            }
        } catch {
            toast.error("Failed to load review queue");
        } finally {
            prefetchingRef.current = false;
        }
    }

    useEffect(() => {
        if (!isReviewMode || !queueHasMore) return;
        const remaining = queue.length - queueIndex;
        if (remaining <= 2 && queue.length > 0) {
            fetchReviewBatch(queue[queue.length - 1]?.id);
        }
    }, [queueIndex, queue.length, queueHasMore]);

    function advanceToNext() {
        setReviewedCount((c) => c + 1);
        const nextIdx = queueIndex + 1;
        if (nextIdx < queue.length) {
            setQueueIndex(nextIdx);
            setCurrentFormId(queue[nextIdx].id);
        } else if (!queueHasMore) {
            setReviewComplete(true);
        }
    }

    // ═══════════════ Form loading ═══════════════

    useEffect(() => {
        if (!currentFormId) return;
        loadForm(currentFormId);
    }, [currentFormId]);

    function loadForm(id) {
        setLoading(true);
        resetFormState();
        getForm(id)
            .then((res) => {
                const d = res.data;
                setForm(d);
                setFields(unpackForm(d));
                setTouched({});
                const coords = d.passport_coord || {};
                setCropCoords({
                    xmin: coords.xmin || 0, ymin: coords.ymin || 0,
                    xmax: coords.xmax || 0, ymax: coords.ymax || 0,
                });
            })
            .catch(() => toast.error("Failed to load form"))
            .finally(() => setLoading(false));
    }

    function resetFormState() {
        setPassportFile(null);
        setUseAvatar(false);
        setShowReject(false);
        setRejectReason("");
        setCroppedPreview(null);
        setShowCropModal(false);
        setTouched({});
    }

    useEffect(() => {
        if (!isReviewMode && routeFormId) setCurrentFormId(routeFormId);
    }, [routeFormId]);

    // ═══════════════ Cascading data ═══════════════

    useEffect(() => {
        getLGAs().then((r) => setLgas(Array.isArray(r) ? r : r.data || [])).catch(() => {});
        getCategories().then((r) => setCategories(Array.isArray(r) ? r : r.data || [])).catch(() => {});
    }, []);

    useEffect(() => {
        if (!fields.lga_no) { setWards([]); setFacilities([]); return; }
        getWards(fields.lga_no).then((r) => setWards(Array.isArray(r) ? r : r.data || [])).catch(() => {});
    }, [fields.lga_no]);

    useEffect(() => {
        if (!fields.ward_no) { setFacilities([]); return; }
        getFacilities(fields.ward_no).then((r) => setFacilities(Array.isArray(r) ? r : r.data || [])).catch(() => {});
    }, [fields.ward_no]);

    // ═══════════════ Crop preview ═══════════════

    const generateCropPreview = useCallback(() => {
        if (!form?.img_path || !cropCoords || cropCoords.xmax <= 0) { setCroppedPreview(null); return; }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const w = cropCoords.xmax - cropCoords.xmin;
            const h = cropCoords.ymax - cropCoords.ymin;
            if (w <= 0 || h <= 0) { setCroppedPreview(null); return; }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, cropCoords.xmin, cropCoords.ymin, w, h, 0, 0, w, h);
            setCroppedPreview(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = () => setCroppedPreview(null);
        img.src = form.img_path;
    }, [form?.img_path, cropCoords]);

    useEffect(() => {
        if (!passportFile && !useAvatar) generateCropPreview();
    }, [generateCropPreview, passportFile, useAvatar]);

    // ═══════════════ Helpers ═══════════════

    function unpackForm(d) {
        const kin = d.next_of_kin || {};
        return {
            title: d.title || "", surname: d.surname || "", firstname: d.firstname || "",
            othername: d.othername || "", dob: d.dob || "", gender: d.gender || "",
            phone_number: d.phone_number || "", nin: d.nin || "", address: d.address || "",
            marital_status: d.marital_status ?? "", settlement: d.settlement || "",
            occupation: d.occupation || "", category: d.category ?? "",
            lga_no: d.lga_no || "", ward_no: d.ward_no || "", facility_no: d.facility_no || "",
            kin_surname: kin.surname || "", kin_firstname: kin.firstname || "",
            kin_othername: kin.othername || "", kin_relationship: kin.relationship || "",
            kin_phone_number: kin.phone_number || "", kin_address: kin.address || "",
        };
    }

    function updateField(key, value) {
        setFields((prev) => ({ ...prev, [key]: value }));
        setTouched((prev) => ({ ...prev, [key]: true }));
    }

    function handleCropApply(coords) {
        setCropCoords(coords);
        setPassportFile(null);
        setUseAvatar(false);
        setShowCropModal(false);
    }

    function getMissingRequired() {
        return [...REQUIRED].filter((k) => {
            const v = fields[k];
            return v === "" || v === null || v === undefined;
        });
    }

    // ═══════════════ Inline validation ═══════════════

    function getNinError() {
        const v = fields.nin || "";
        if (!v) return null;
        if (!/^\d*$/.test(v)) return "NIN must contain only numbers";
        if (v.length > 0 && v.length !== 11) return `NIN must be exactly 11 digits (${v.length}/11)`;
        return null;
    }

    function getPhoneError() {
        const raw = (fields.phone_number || "").replace(/^\+?234/, "");
        if (!raw) return null;
        if (!/^\d*$/.test(raw)) return "Phone must contain only numbers";
        if (raw.length > 0 && raw.length !== 10) return `Phone must be 10 digits after +234 (${raw.length}/10)`;
        return null;
    }

    // ═══════════════ Actions ═══════════════

    async function handleEnroll() {
        const missing = getMissingRequired();
        if (missing.length > 0) {
            toast.warn("Please fill all compulsory fields before enrolling");
            return;
        }
        const ninErr = getNinError();
        const phoneErr = getPhoneError();
        if (ninErr || phoneErr) {
            toast.warn(ninErr || phoneErr);
            return;
        }

        setEnrolling(true);
        try {
            const payload = { ...fields };
            if (useAvatar) payload.use_avatar = true;
            if (cropCoords && cropCoords.xmax > 0) {
                payload.passport_xmin = cropCoords.xmin;
                payload.passport_ymin = cropCoords.ymin;
                payload.passport_xmax = cropCoords.xmax;
                payload.passport_ymax = cropCoords.ymax;
            }
            await updateForm(currentFormId, payload);
            if (passportFile) await uploadPassport(currentFormId, passportFile);
            const res = await enrollForm(currentFormId);
            if (res.status === "duplicate") {
                toast.warn(res.msg || "Enrollee already exists");
            } else {
                toast.success(res.msg || "Enrolled successfully");
            }
            if (isReviewMode) { advanceToNext(); } else {
                const updated = await getForm(currentFormId);
                setForm(updated.data); setFields(unpackForm(updated.data));
            }
        } catch (err) {
            toast.error(err?.msg || "Enrollment failed");
        } finally { setEnrolling(false); }
    }

    async function handleReject() {
        setRejecting(true);
        try {
            await rejectForm(currentFormId, rejectReason);
            toast.success("Form rejected");
            setShowReject(false);
            if (isReviewMode) { advanceToNext(); } else {
                const updated = await getForm(currentFormId);
                setForm(updated.data); setFields(unpackForm(updated.data));
            }
        } catch (err) {
            toast.error(err?.msg || "Reject failed");
        } finally { setRejecting(false); }
    }

    // ═══════════════ Render: Review complete ═══════════════

    if (reviewComplete) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center space-y-5 animate-scale-in">
                    <div className="mx-auto w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center">
                        <CheckCircle size={40} className="text-emerald-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900">Review Complete</h1>
                    <p className="text-slate-500">You reviewed {reviewedCount} form{reviewedCount !== 1 ? "s" : ""} in this batch.</p>
                    <button
                        onClick={() => navigate(`/enrollment/batches/${batchId}`)}
                        className="gradient-primary rounded-xl text-white px-8 py-3 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all"
                    >
                        Back to Batch
                    </button>
                </div>
            </div>
        );
    }

    // ═══════════════ Render: Loading ═══════════════

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-slate-50">
                <Loader2 size={28} className="animate-spin text-primary-500" />
            </div>
        );
    }

    if (!form) {
        return <div className="flex items-center justify-center h-screen bg-slate-50 text-slate-400">Form not found</div>;
    }

    const isTerminal = ["enrolled", "rejected", "failed"].includes(form.status?.toLowerCase());
    const passportSrc = passportFile
        ? URL.createObjectURL(passportFile)
        : useAvatar
            ? (fields.gender?.toLowerCase() === "male" ? form.MALE_AVATAR : form.FEMALE_AVATAR)
            : form.passport_path || croppedPreview || null;

    const flagBanner = getFlagBanner(form);
    const ninError = touched.nin ? getNinError() : null;
    const phoneError = touched.phone_number ? getPhoneError() : null;

    return (
        <div className="h-screen flex flex-col bg-slate-50">
            {/* ── Top bar ── */}
            <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200/80" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.03)" }}>
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
                        <ArrowLeft size={18} className="text-slate-500" />
                    </button>
                    <div>
                        <h1 className="text-sm font-bold text-slate-900">
                            {form.surname || form.firstname ? `${form.surname || ""}, ${form.firstname || ""}`.trim() : "Form Review"}
                        </h1>
                        <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">{form.status}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                    {isReviewMode && (
                        <span className="gradient-primary text-white px-3 py-1.5 rounded-full text-[11px] font-bold shadow-md shadow-primary-500/20">
                            {queueIndex + 1} / {queueHasMore ? `${queue.length}+` : queue.length}
                        </span>
                    )}
                    <span className="font-mono">Seq #{form.sequence}</span>
                </div>
            </div>

            {/* ── Two-column layout ── */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: scanned image */}
                <div className="w-1/2 bg-slate-900 flex items-center justify-center p-4 overflow-auto shrink-0 max-lg:hidden">
                    {form.img_path ? (
                        <img src={form.img_path} alt="Scanned form" className="max-w-full max-h-full object-contain rounded-lg" draggable={false} />
                    ) : (
                        <p className="text-slate-600">No scan available</p>
                    )}
                </div>

                {/* Right: fields */}
                <div className="flex-1 overflow-y-auto bg-white border-l border-slate-200/80 custom-scrollbar">
                    <div className="max-w-2xl mx-auto px-6 py-6 space-y-7">

                        {/* Mobile image */}
                        <div className="lg:hidden rounded-xl overflow-hidden bg-slate-900 max-h-56 flex items-center justify-center">
                            {form.img_path
                                ? <img src={form.img_path} alt="Scanned form" className="max-w-full max-h-56 object-contain" />
                                : <p className="text-slate-600 py-10">No scan available</p>
                            }
                        </div>

                        {/* Flag banner */}
                        {flagBanner}

                        {/* ── Passport box ── */}
                        <div className="card p-6">
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">Passport Photo</p>
                            <div className="flex flex-col items-center">
                                <div className="w-32 h-40 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                    {passportSrc
                                        ? <img src={passportSrc} alt="Passport" className="w-full h-full object-cover rounded-lg" />
                                        : <User size={44} className="text-slate-300" />
                                    }
                                </div>
                                <div className="flex gap-3 mt-4">
                                    <input ref={passportRef} type="file" accept="image/*" className="hidden"
                                        onChange={(e) => { if (e.target.files[0]) { setPassportFile(e.target.files[0]); setUseAvatar(false); } }}
                                    />
                                    <button type="button" onClick={() => passportRef.current.click()} disabled={isTerminal}
                                        className="gradient-primary text-white rounded-xl px-5 py-2 text-xs font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-40 flex items-center gap-1.5">
                                        <Upload size={13} /> Upload
                                    </button>
                                    <button type="button" disabled={isTerminal}
                                        onClick={() => {
                                            if (!cropCoords || cropCoords.xmax <= 0) { toast.warn("No crop coordinates available. Upload a photo instead."); return; }
                                            setShowCropModal(true);
                                        }}
                                        className="bg-slate-100 text-slate-700 rounded-xl px-5 py-2 text-xs font-semibold hover:bg-slate-200 transition-all disabled:opacity-40 flex items-center gap-1.5 border border-slate-200">
                                        <Crop size={13} /> Recrop
                                    </button>
                                </div>
                                <label className="flex items-center gap-2 text-xs text-slate-500 mt-3 cursor-pointer select-none">
                                    <input type="checkbox" checked={useAvatar} disabled={isTerminal}
                                        onChange={(e) => { setUseAvatar(e.target.checked); if (e.target.checked) setPassportFile(null); }}
                                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
                                    Use default avatar
                                </label>
                            </div>
                        </div>

                        {/* ── Personal Information ── */}
                        <Section title="Personal Information">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                                {PERSONAL_FIELDS.map((f) => (
                                    <div key={f.key} className={f.grid}>
                                        <FieldInput field={f} value={fields[f.key] ?? ""} onChange={(v) => updateField(f.key, v)}
                                            disabled={isTerminal} required={REQUIRED.has(f.key)}
                                            lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                            error={f.key === "nin" ? ninError : f.key === "phone_number" ? phoneError : null}
                                        />
                                    </div>
                                ))}
                            </div>
                        </Section>

                        {/* ── Location ── */}
                        <Section title="Location">
                            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
                                {LOCATION_FIELDS.map((f) => (
                                    <div key={f.key} className={f.grid}>
                                        <FieldInput field={f} value={fields[f.key] ?? ""} onChange={(v) => updateField(f.key, v)}
                                            disabled={isTerminal} required={REQUIRED.has(f.key)}
                                            lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                        />
                                    </div>
                                ))}
                            </div>
                        </Section>

                        {/* ── Next of Kin ── */}
                        <Section title="Next of Kin">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                                {KIN_FIELDS.map((f) => (
                                    <div key={f.key} className={f.grid}>
                                        <FieldInput field={f} value={fields[f.key] ?? ""} onChange={(v) => updateField(f.key, v)}
                                            disabled={isTerminal} required={REQUIRED.has(f.key)}
                                            lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                        />
                                    </div>
                                ))}
                            </div>
                        </Section>

                        {/* ── Actions ── */}
                        {!isTerminal && (
                            <div className="sticky bottom-0 bg-white pt-4 pb-6 space-y-4" style={{ boxShadow: "0 -4px 16px rgba(0,0,0,0.04)" }}>
                                <div className="flex gap-3">
                                    {!showReject ? (
                                        <button onClick={() => setShowReject(true)}
                                            className="flex-1 rounded-xl border-2 border-red-200 text-red-600 py-3 text-sm font-semibold hover:bg-red-50 hover:border-red-300 transition-all">
                                            Reject
                                        </button>
                                    ) : (
                                        <div className="flex-1 space-y-3 p-4 bg-red-50 rounded-xl border border-red-100 animate-scale-in">
                                            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                                                placeholder="Reason for rejection..." rows={2}
                                                className="w-full rounded-xl border border-red-200 px-4 py-2.5 text-sm resize-none input-focus" />
                                            <div className="flex gap-2">
                                                <button onClick={() => setShowReject(false)} className="flex-1 rounded-xl border border-slate-200 py-2 text-sm text-slate-600 hover:bg-white font-medium">Cancel</button>
                                                <button onClick={handleReject} disabled={rejecting}
                                                    className="flex-1 rounded-xl bg-red-600 text-white py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors">
                                                    {rejecting ? "..." : "Confirm Reject"}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    <button onClick={handleEnroll} disabled={enrolling}
                                        className="flex-1 gradient-primary rounded-xl text-white py-3 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                                        {enrolling && <Loader2 size={14} className="animate-spin" />}
                                        {enrolling ? "Enrolling..." : "Enroll"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {isTerminal && !isReviewMode && (
                            <div className="text-center text-sm text-slate-500 py-6 border-t border-slate-100">
                                This form has been <span className="font-semibold">{form.status?.toLowerCase()}</span>.
                                {form.enrollee_number && <p className="mt-1 font-mono text-xs text-primary-600">Enrollee ID: {form.enrollee_number}</p>}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showCropModal && (
                <CropModal imgSrc={form.img_path} initialCoords={cropCoords}
                    onApply={handleCropApply} onClose={() => setShowCropModal(false)} />
            )}
        </div>
    );
}

/* ── Section wrapper ── */
function Section({ title, children }) {
    return (
        <fieldset className="card p-6">
            <legend className="section-accent text-xs font-bold text-slate-500 uppercase tracking-widest">
                {title}
            </legend>
            <div className="mt-5">{children}</div>
        </fieldset>
    );
}

/* ── Flag banner ── */
function getFlagBanner(form) {
    const status = form.status?.toLowerCase();
    if (status === "need_rescan" || status === "error" || status === "failed") {
        const isError = status !== "need_rescan";
        return (
            <div className={`flex items-start gap-3 rounded-xl p-4 text-sm animate-fade-in ${isError ? "bg-red-50 border border-red-100 text-red-700" : "bg-amber-50 border border-amber-100 text-amber-700"}`}>
                {isError ? <XCircle size={18} className="shrink-0 mt-0.5" /> : <AlertTriangle size={18} className="shrink-0 mt-0.5" />}
                <div>
                    <p className="font-semibold">{isError ? "Processing Error" : "Needs Rescan"}</p>
                    {form.error_message && <p className="mt-1 text-xs opacity-80">{form.error_message}</p>}
                </div>
            </div>
        );
    }
    if (status === "rejected" && form.reject_reason) {
        return (
            <div className="flex items-start gap-3 rounded-xl p-4 text-sm bg-slate-100 border border-slate-200 text-slate-600 animate-fade-in">
                <Info size={18} className="shrink-0 mt-0.5" />
                <div>
                    <p className="font-semibold">Rejected</p>
                    <p className="mt-1 text-xs opacity-80">{form.reject_reason}</p>
                </div>
            </div>
        );
    }
    return null;
}

/* ── Field input ── */
function FieldInput({ field, value, onChange, disabled, required, lgas, wards, facilities, categories, error }) {
    const base = "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm input-focus disabled:bg-slate-50 disabled:text-slate-400 transition-all";
    const errorBorder = error ? "!border-red-300 !shadow-none" : "";
    const label = (
        <label className="flex items-center gap-1 text-xs font-semibold text-slate-500 mb-1.5">
            {field.label}
            {required && <span className="text-red-400">*</span>}
        </label>
    );

    const errorHint = error ? <p className="text-[11px] text-red-500 mt-1 font-medium">{error}</p> : null;

    if (field.type === "cascade_lga") {
        return (<div>{label}
            <select value={value || ""} onChange={(e) => onChange(Number(e.target.value) || "")} disabled={disabled} className={`${base} ${errorBorder}`}>
                <option value="">Select LGA</option>
                {lgas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>{errorHint}</div>);
    }
    if (field.type === "cascade_ward") {
        return (<div>{label}
            <select value={value || ""} onChange={(e) => onChange(Number(e.target.value) || "")} disabled={disabled} className={`${base} ${errorBorder}`}>
                <option value="">Select Ward</option>
                {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>{errorHint}</div>);
    }
    if (field.type === "cascade_facility") {
        return (<div>{label}
            <select value={value || ""} onChange={(e) => onChange(Number(e.target.value) || "")} disabled={disabled} className={`${base} ${errorBorder}`}>
                <option value="">Select Facility</option>
                {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>{errorHint}</div>);
    }
    if (field.type === "cascade_category") {
        return (<div>{label}
            <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value) || "")} disabled={disabled} className={`${base} ${errorBorder}`}>
                <option value="">Select Category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>{errorHint}</div>);
    }
    if (field.type === "select") {
        const opts = field.options || [];
        const hasObjectOpts = opts.length > 0 && typeof opts[0] === "object";
        return (<div>{label}
            <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={`${base} ${errorBorder}`}>
                {hasObjectOpts
                    ? opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
                    : <><option value="">—</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</>
                }
            </select>{errorHint}</div>);
    }
    if (field.type === "textarea") {
        return (<div>{label}
            <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} rows={2} className={`${base} resize-none ${errorBorder}`} />{errorHint}</div>);
    }
    if (field.type === "date") {
        return (<div>{label}
            <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={`${base} ${errorBorder}`} />{errorHint}</div>);
    }
    if (field.type === "phone") {
        const display = (value || "").replace(/^\+?234/, "");
        return (<div>{label}
            <div className="flex">
                <span className="inline-flex items-center px-3.5 rounded-l-xl border border-r-0 border-slate-200 bg-slate-50 text-xs text-slate-500 font-semibold">+234</span>
                <input type="tel" value={display} onChange={(e) => onChange("+234" + e.target.value.replace(/\D/g, ""))}
                    disabled={disabled} className={`${base} rounded-l-none ${errorBorder}`} maxLength={10} />
            </div>{errorHint}</div>);
    }
    if (field.type === "nin") {
        return (<div>{label}
            <input type="text" value={value || ""} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 11))}
                disabled={disabled} className={`${base} ${errorBorder} font-mono tracking-wide`} maxLength={11} placeholder="00000000000" />{errorHint}</div>);
    }
    return (<div>{label}
        <input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}
            placeholder={field.placeholder || ""} className={`${base} ${errorBorder}`} />{errorHint}</div>);
}
