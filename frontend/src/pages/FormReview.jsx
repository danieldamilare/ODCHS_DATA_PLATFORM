import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getForm, updateForm, uploadPassport, rejectForm, enrollForm, getLGAs, getWards, getFacilities, getBatchForms, getCategories } from "../api/enrollment";
import { useToast } from "../components/ui/Toast";
import CropModal from "../components/enrollment/CropModal";
import ImageViewer from "../components/enrollment/ImageViewer";
import StatusBanner from "../components/enrollment/StatusBanner";
import FlagCallout from "../components/enrollment/FlagCallout";
import FormActions from "../components/enrollment/FormActions";
import { canEdit } from "../constants/formStatus";
import useNinVerification from "../hooks/useNinVerification";
import { warmNin } from "../api/nin";
import { ArrowLeft, Upload, Crop, User, Loader2, CheckCircle, AlertTriangle, XCircle, Timer, Trophy, X, BarChart3, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";

/* ── Required fields (mirrors backend FormUpdater) ── */
const REQUIRED = new Set([
    "title", "surname", "firstname", "dob", "settlement", "gender",
    "phone_number", "nin", "address", "category", "marital_status",
    "kin_firstname", "kin_surname", "kin_relationship", "kin_phone_number",
    "kin_address", "lga_no", "ward_no", "facility_no",
]);

/* ── Field definitions ── */
const PERSONAL_FIELDS = [
    { key: "title", label: "Title", type: "select", options: ["Mr.", "Mrs.", "Miss", "Master", "Chief"], grid: "col-span-1" },
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
    const prefetchingRef = useRef(false);

    // Session stats (gamification)
    const [sessionStart] = useState(() => Date.now());
    const [elapsed, setElapsed] = useState(0);
    const [enrollCount, setEnrollCount] = useState(0);
    const [rejectCount, setRejectCount] = useState(0);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [cancelled, setCancelled] = useState(false);

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
    const [cachedImgUrl, setCachedImgUrl] = useState(null);
    const cachedImgUrlRef = useRef(null);
    const passportRef = useRef();

    // Rotation (net clockwise degrees, synced to backend via rotate_angle on enroll)
    const [rotation, setRotation] = useState(0);
    const [rotatedImgUrl, setRotatedImgUrl] = useState(null);
    const rotatedImgUrlRef = useRef(null);

    // Reject
    const [showReject, setShowReject] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const [rejecting, setRejecting] = useState(false);

    // NIN verification override gate (enroll confirm shown whenever NIN isn't "valid")
    const [showNinConfirm, setShowNinConfirm] = useState(false);

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
        const nextIdx = queueIndex + 1;
        if (nextIdx < queue.length) {
            setQueueIndex(nextIdx);
            setCurrentFormId(queue[nextIdx].id);
        } else if (!queueHasMore) {
            setReviewComplete(true);
        }
    }

    // ═══════════════ Session timer ═══════════════

    useEffect(() => {
        if (!isReviewMode || reviewComplete || cancelled) return;
        const timer = setInterval(() => {
            setElapsed(Math.floor((Date.now() - sessionStart) / 1000));
        }, 1000);
        return () => clearInterval(timer);
    }, [isReviewMode, reviewComplete, cancelled, sessionStart]);

    // ═══════════════ Image preloading ═══════════════

    useEffect(() => {
        if (!queue || queue.length === 0) return;
        queue.forEach((qf, i) => {
            if (i > queueIndex && i <= queueIndex + 3) {
                if (qf.img_path) { const img = new Image(); img.src = qf.img_path; }
                if (qf.passport_path) { const img = new Image(); img.src = qf.passport_path; }
            }
        });
    }, [queue, queueIndex]);

    // ═══════════════ Form loading ═══════════════

    useEffect(() => {
        if (!currentFormId) return;
        loadForm(currentFormId);
    }, [currentFormId]);

    function loadForm(id) {
        setLoading(true);
        warmNin(); // keep the NIN service token hot for every review page's auto-verify
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
        if (cachedImgUrlRef.current) URL.revokeObjectURL(cachedImgUrlRef.current);
        setCachedImgUrl(null);
        cachedImgUrlRef.current = null;
        setRotation(0);
        if (rotatedImgUrlRef.current) URL.revokeObjectURL(rotatedImgUrlRef.current);
        setRotatedImgUrl(null);
        rotatedImgUrlRef.current = null;
    }

    // Cache form image as blob URL for reuse (crop modal, left pane)
    useEffect(() => {
        if (!form?.img_path) return;
        let revoked = false;
        fetch(form.img_path)
            .then((r) => r.blob())
            .then((blob) => {
                if (revoked) return;
                const url = URL.createObjectURL(blob);
                setCachedImgUrl(url);
                cachedImgUrlRef.current = url;
            })
            .catch(() => {});
        return () => { revoked = true; };
    }, [form?.img_path]);

    useEffect(() => {
        if (!isReviewMode && routeFormId) setCurrentFormId(routeFormId);
    }, [routeFormId]);

    // ═══════════════ Rotation ═══════════════

    // Canvas-rotate the cached blob so the pane + CropModal show true rotated
    // pixels; crop coords drawn on it are in post-rotation space, matching what
    // the backend stores after applying rotate_angle.
    useEffect(() => {
        if (rotatedImgUrlRef.current) {
            URL.revokeObjectURL(rotatedImgUrlRef.current);
            rotatedImgUrlRef.current = null;
        }
        setRotatedImgUrl(null);
        if (rotation === 0 || !cachedImgUrl) return;
        let stale = false;
        const img = new Image();
        img.onload = () => {
            if (stale) return;
            const swap = rotation === 90 || rotation === 270;
            const canvas = document.createElement("canvas");
            canvas.width = swap ? img.naturalHeight : img.naturalWidth;
            canvas.height = swap ? img.naturalWidth : img.naturalHeight;
            const ctx = canvas.getContext("2d");
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
            canvas.toBlob((blob) => {
                if (stale || !blob) return;
                const url = URL.createObjectURL(blob);
                rotatedImgUrlRef.current = url;
                setRotatedImgUrl(url);
            }, "image/jpeg", 0.92);
        };
        img.src = cachedImgUrl;
        return () => { stale = true; };
    }, [rotation, cachedImgUrl]);

    function handleRotate() {
        const hadCrop = cropCoords && cropCoords.xmax > 0;
        setRotation((r) => (r + 90) % 360);
        setCropCoords({ xmin: 0, ymin: 0, xmax: 0, ymax: 0 });
        setCroppedPreview(null);
        if (hadCrop) toast.warn("Passport crop cleared — recrop after rotating");
    }

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

    // ═══════════════ Live NIN verification ═══════════════
    // Auto-verifies whenever NIN is 11 digits + DOB present. formKey resets the
    // debounce per record so a pre-filled NIN verifies immediately on load.
    const {
        status: ninStatus,
        details: ninDetails,
        verifying: ninVerifying,
        message: ninMessage,
        reverify: reverifyNin,
    } = useNinVerification(fields.dob, fields.nin, { formKey: currentFormId });

    // ═══════════════ Crop preview ═══════════════

    const generateCropPreview = useCallback(() => {
        const src = (rotation !== 0 ? rotatedImgUrl : cachedImgUrl) || form?.img_path;
        if (!src || !cropCoords || cropCoords.xmax <= 0) { setCroppedPreview(null); return; }
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
        img.src = src;
    }, [rotation, rotatedImgUrl, cachedImgUrl, form?.img_path, cropCoords]);

    useEffect(() => {
        if (!passportFile && !useAvatar) generateCropPreview();
    }, [generateCropPreview, passportFile, useAvatar]);

    // ═══════════════ Helpers ═══════════════

    /** MM-DD-YYYY → YYYY-MM-DD (for <input type="date">) */
    function dobToISO(v) {
        if (!v) return "";
        const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        return m ? `${m[3]}-${m[1]}-${m[2]}` : v;
    }
    /** YYYY-MM-DD → MM-DD-YYYY (for backend) */
    function dobFromISO(v) {
        if (!v) return "";
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[2]}-${m[3]}-${m[1]}` : v;
    }

    /** NIN service DOB `DD-MM-YYYY` (day-first, e.g. "12-09-2002") → ISO `YYYY-MM-DD`.
     *  Returns "" if the shape is unrecognised so we never render a bogus mismatch. */
    function ninDobToISO(v) {
        if (!v) return "";
        const m = String(v).match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
    }

    function unpackForm(d) {
        const kin = d.next_of_kin || {};
        return {
            title: d.title || "", surname: d.surname || "", firstname: d.firstname || "",
            othername: d.othername || "", dob: dobToISO(d.dob), gender: d.gender || "",
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

    // NIN demographic mismatches — only meaningful once the NIN is "valid".
    // Names compare case-insensitively; DOB compares as ISO calendar dates.
    // Blank NIN values are skipped: an empty field from the service is not a fix.
    function getNinMismatches() {
        if (ninStatus !== "valid" || !ninDetails) return [];
        const norm = (s) => (s || "").trim().toLowerCase();
        const rows = [];
        const names = [
            { key: "surname", label: "Surname", ninVal: ninDetails.lastName },
            { key: "firstname", label: "First Name", ninVal: ninDetails.firstName },
            { key: "othername", label: "Other Name", ninVal: ninDetails.middleName },
        ];
        for (const n of names) {
            const ninVal = (n.ninVal || "").trim();
            if (!ninVal) continue;
            if (norm(ninVal) !== norm(fields[n.key])) {
                const apply = titleCase(ninVal);
                rows.push({ key: n.key, label: n.label, current: fields[n.key] || "—", display: apply, apply });
            }
        }
        const ninIso = ninDobToISO(ninDetails.dateOfBirth);
        if (ninIso && ninIso !== (fields.dob || "")) {
            rows.push({ key: "dob", label: "Date of Birth", current: fields.dob || "—", display: ninIso, apply: ninIso });
        }
        return rows;
    }

    // ═══════════════ Actions ═══════════════

    async function handleEnroll() {
        if (!validateBeforeEnroll()) return;
        // Enroll gate: only a live "valid" verdict enrolls straight through.
        // Anything else — invalid, couldn't-verify, still-verifying, or never-run —
        // routes through the override confirm modal.
        if (ninStatus === "valid") {
            doEnroll(true);
        } else {
            setShowNinConfirm(true);
        }
    }

    function validateBeforeEnroll() {
        const missing = getMissingRequired();
        if (missing.length > 0) {
            toast.warn("Please fill all compulsory fields before enrolling");
            return false;
        }
        const ninErr = getNinError();
        const phoneErr = getPhoneError();
        if (ninErr || phoneErr) {
            toast.warn(ninErr || phoneErr);
            return false;
        }
        if (rotation !== 0 && !(cropCoords && cropCoords.xmax > 0) && !passportFile && !useAvatar) {
            toast.warn("Image was rotated — recrop the passport or upload a photo before enrolling");
            return false;
        }
        return true;
    }

    async function doEnroll(ninVerified) {
        setShowNinConfirm(false);
        setEnrolling(true);
        try {
            // Passport upload first: the backend's rotate check requires a
            // passport source to already exist when no fresh crop is sent
            if (passportFile) await uploadPassport(currentFormId, passportFile);
            const payload = { ...fields };
            payload.nin_verified = ninVerified;
            if (payload.dob) payload.dob = dobFromISO(payload.dob);
            if (useAvatar) payload.use_avatar = true;
            if (rotation !== 0) payload.rotate_angle = rotation;
            if (cropCoords && cropCoords.xmax > 0) {
                payload.passport_xmin = cropCoords.xmin;
                payload.passport_ymin = cropCoords.ymin;
                payload.passport_xmax = cropCoords.xmax;
                payload.passport_ymax = cropCoords.ymax;
            }
            await updateForm(currentFormId, payload);
            const res = await enrollForm(currentFormId);
            if (res.status === "duplicate") {
                toast.warn(res.msg || "Enrollee already exists");
            } else {
                toast.success(res.msg || "Enrolled successfully");
            }
            if (isReviewMode) { setEnrollCount((c) => c + 1); advanceToNext(); } else {
                loadForm(currentFormId);
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
            if (isReviewMode) { setRejectCount((c) => c + 1); advanceToNext(); } else {
                loadForm(currentFormId);
            }
        } catch (err) {
            toast.error(err?.msg || "Reject failed");
        } finally { setRejecting(false); }
    }

    // ═══════════════ Render: Session summary (complete or cancelled) ═══════════════

    if (reviewComplete || cancelled) {
        const totalActions = enrollCount + rejectCount;
        return (
            <div className="h-screen flex items-center justify-center bg-slate-50 p-6">
                <div className="w-full max-w-md text-center space-y-6 animate-scale-in">
                    <div className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center ${cancelled ? "bg-slate-100" : "bg-emerald-50"}`}>
                        {cancelled
                            ? <BarChart3 size={38} className="text-slate-400" />
                            : <Trophy size={38} className="text-emerald-500" />
                        }
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">{cancelled ? "Session Ended" : "Review Complete"}</h1>
                        <p className="text-slate-500 mt-2">
                            {totalActions > 0
                                ? <>Whew! You reviewed <span className="font-semibold text-slate-700">{totalActions} form{totalActions !== 1 ? "s" : ""}</span> in <span className="font-semibold text-slate-700">{fmtElapsed(elapsed)}</span>.</>
                                : "No forms were reviewed this session."
                            }
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-left">
                        <SummaryStat icon={Timer} label="Time" value={fmtElapsed(elapsed)} tone="slate" />
                        <SummaryStat icon={BarChart3} label="Avg Pace" value={totalActions > 0 ? fmtPace(elapsed / totalActions) : "—"} tone="slate" />
                        <SummaryStat icon={CheckCircle} label="Enrolled" value={enrollCount} tone="emerald" />
                        <SummaryStat icon={XCircle} label="Rejected" value={rejectCount} tone="red" />
                    </div>

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

    const isLocked = !canEdit(form.status);
    const displaySrc = rotation !== 0 ? (rotatedImgUrl || cachedImgUrl) : (cachedImgUrl || form.img_path);
    const passportSrc = passportFile
        ? URL.createObjectURL(passportFile)
        : useAvatar
            ? (fields.gender?.toLowerCase() === "male" ? form.MALE_AVATAR : form.FEMALE_AVATAR)
            : form.passport_path || croppedPreview || null;

    const ninError = touched.nin ? getNinError() : null;
    const phoneError = touched.phone_number ? getPhoneError() : null;
    const ninMismatches = getNinMismatches();

    return (
        <div className="h-screen flex flex-col bg-slate-50">
            {/* ── Top bar ── */}
            <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200/80" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.03)" }}>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => isReviewMode ? setShowCancelConfirm(true) : navigate(-1)}
                        className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
                    >
                        <ArrowLeft size={18} className="text-slate-500" />
                    </button>
                    <div>
                        <h1 className="text-sm font-bold text-slate-900">
                            {form.surname || form.firstname ? `${form.surname || ""}, ${form.firstname || ""}`.trim() : "Form Review"}
                        </h1>
                        <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">{form.status}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                    {isReviewMode ? (
                        <>
                            <span className="flex items-center gap-2 font-mono font-bold text-lg text-slate-800 bg-slate-100 rounded-xl px-4 py-1.5 tabular-nums">
                                <Timer size={17} className="text-slate-400" />
                                {fmtElapsed(elapsed)}
                            </span>
                            <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-1.5 tabular-nums" title="Enrolled this session">
                                <CheckCircle size={15} /> {enrollCount}
                            </span>
                            <span className="flex items-center gap-1.5 text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-1.5 tabular-nums" title="Rejected this session">
                                <XCircle size={15} /> {rejectCount}
                            </span>
                            {enrollCount + rejectCount > 0 && (
                                <span className="max-md:hidden font-medium text-slate-400" title="Average pace">
                                    ~{fmtPace(elapsed / (enrollCount + rejectCount))}
                                </span>
                            )}
                            <span className="gradient-primary text-white px-3.5 py-2 rounded-full text-xs font-bold shadow-md shadow-primary-500/20">
                                {queueIndex + 1} / {queueHasMore ? `${queue.length}+` : queue.length}
                            </span>
                            <button
                                onClick={() => setShowCancelConfirm(true)}
                                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-all"
                            >
                                <X size={13} /> End Session
                            </button>
                        </>
                    ) : (
                        <>
                            <span className="font-mono">Seq #{form.sequence}</span>
                            <FormActions form={form} variant="toolbar" onChanged={() => loadForm(currentFormId)} />
                        </>
                    )}
                </div>
            </div>

            {/* ── Two-column layout ── */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: scanned image */}
                <div className="w-1/2 bg-slate-900 shrink-0 max-lg:hidden">
                    {displaySrc ? (
                        <ImageViewer key={displaySrc} src={displaySrc} onRotate={!isLocked ? handleRotate : undefined} />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <p className="text-slate-600">No scan available</p>
                        </div>
                    )}
                </div>

                {/* Right: fields */}
                <div className="flex-1 overflow-y-auto bg-white border-l border-slate-200/80 custom-scrollbar">
                    <div className="max-w-2xl mx-auto px-6 py-6 space-y-7">

                        {/* Mobile image */}
                        <div className="lg:hidden rounded-xl overflow-hidden bg-slate-900 max-h-56 flex items-center justify-center">
                            {displaySrc
                                ? <img src={displaySrc} alt="Scanned form" className="max-w-full max-h-56 object-contain" />
                                : <p className="text-slate-600 py-10">No scan available</p>
                            }
                        </div>

                        {/* Status + flag signals */}
                        <div className="space-y-3">
                            <StatusBanner form={form} />
                            <FlagCallout form={form} />
                        </div>

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
                                    <button type="button" onClick={() => passportRef.current.click()} disabled={isLocked}
                                        className="gradient-primary text-white rounded-xl px-5 py-2 text-xs font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-40 flex items-center gap-1.5">
                                        <Upload size={13} /> Upload
                                    </button>
                                    <button type="button" disabled={isLocked}
                                        onClick={() => {
                                            if (rotation !== 0 && !rotatedImgUrl) { toast.warn("Preparing rotated image, try again in a moment"); return; }
                                            setShowCropModal(true);
                                        }}
                                        className="bg-slate-100 text-slate-700 rounded-xl px-5 py-2 text-xs font-semibold hover:bg-slate-200 transition-all disabled:opacity-40 flex items-center gap-1.5 border border-slate-200">
                                        <Crop size={13} /> Recrop
                                    </button>
                                </div>
                                <label className="flex items-center gap-2 text-xs text-slate-500 mt-3 cursor-pointer select-none">
                                    <input type="checkbox" checked={useAvatar} disabled={isLocked}
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
                                            disabled={isLocked} required={REQUIRED.has(f.key)}
                                            lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                            error={f.key === "nin" ? ninError : f.key === "phone_number" ? phoneError : null}
                                        />
                                    </div>
                                ))}
                            </div>
                        </Section>

                        {/* ── NIN verification ── */}
                        <NinVerifyPanel
                            nin={fields.nin}
                            dob={fields.dob}
                            status={ninStatus}
                            verifying={ninVerifying}
                            message={ninMessage}
                            mismatches={ninMismatches}
                            disabled={isLocked}
                            onRetry={reverifyNin}
                            onUse={updateField}
                        />

                        {/* ── Location ── */}
                        <Section title="Location">
                            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
                                {LOCATION_FIELDS.map((f) => (
                                    <div key={f.key} className={f.grid}>
                                        <FieldInput field={f} value={fields[f.key] ?? ""} onChange={(v) => updateField(f.key, v)}
                                            disabled={isLocked} required={REQUIRED.has(f.key)}
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
                                            disabled={isLocked} required={REQUIRED.has(f.key)}
                                            lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                        />
                                    </div>
                                ))}
                            </div>
                        </Section>

                        {/* ── Actions ── */}
                        {!isLocked && (
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

                        {isLocked && !isReviewMode && form.enrollee_number && (
                            <div className="text-center py-6 border-t border-slate-100">
                                <p className="font-mono text-xs text-primary-600">Enrollee ID: {form.enrollee_number}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showCropModal && (
                <CropModal imgSrc={displaySrc} initialCoords={cropCoords}
                    onApply={handleCropApply} onClose={() => setShowCropModal(false)} />
            )}

            {showCancelConfirm && (
                <div
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowCancelConfirm(false); }}
                >
                    <div className="card w-full max-w-sm p-6 text-center space-y-4 animate-scale-in" style={{ boxShadow: "var(--shadow-elevated)" }}>
                        <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
                            <AlertTriangle size={26} className="text-amber-500" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">End review session?</h2>
                            <p className="text-sm text-slate-500 mt-1.5">
                                You've reviewed {enrollCount + rejectCount} form{enrollCount + rejectCount !== 1 ? "s" : ""} in {fmtElapsed(elapsed)}.
                                Your progress is saved — remaining forms stay in the queue.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowCancelConfirm(false)}
                                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                                Keep Reviewing
                            </button>
                            <button
                                onClick={() => { setShowCancelConfirm(false); setCancelled(true); }}
                                className="flex-1 rounded-xl bg-red-600 text-white py-2.5 text-sm font-semibold hover:bg-red-700 transition-colors"
                            >
                                End Session
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showNinConfirm && (
                <NinConfirmModal
                    status={ninStatus}
                    message={ninMessage}
                    busy={enrolling}
                    onCancel={() => setShowNinConfirm(false)}
                    onConfirm={() => doEnroll(false)}
                />
            )}
        </div>
    );
}

/* ── Session stat helpers ── */
function fmtElapsed(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPace(secPerForm) {
    return secPerForm >= 60
        ? `${(secPerForm / 60).toFixed(1)} min/form`
        : `${Math.round(secPerForm)}s/form`;
}

/** Title-case a NIN-service name for display/apply ("JOSEPH" → "Joseph",
 *  "MARY-JANE" → "Mary-Jane"). The service returns all-caps; the form stores
 *  title-case, so we normalise before offering it as a quick-fix value. */
function titleCase(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SUMMARY_TONES = {
    slate: { bg: "bg-slate-50", icon: "text-slate-400", value: "text-slate-800" },
    emerald: { bg: "bg-emerald-50", icon: "text-emerald-500", value: "text-emerald-700" },
    red: { bg: "bg-red-50", icon: "text-red-500", value: "text-red-700" },
};

function SummaryStat({ icon: Icon, label, value, tone }) {
    const t = SUMMARY_TONES[tone] || SUMMARY_TONES.slate;
    return (
        <div className={`rounded-xl p-4 ${t.bg}`}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <Icon size={13} className={t.icon} />
                {label}
            </div>
            <p className={`text-xl font-bold mt-1 ${t.value}`}>{value}</p>
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

/* ── NIN verification panel ───────────────────────────────────────────────
 * Presentational surface for the live NIN check. Renders nothing until the NIN
 * is a well-formed 11 digits, then reflects the hook's verdict:
 *   verifying → spinner    valid → green (+ demographic mismatch quick-fixes)
 *   invalid   → red        error → amber (+ retry)
 * "Use NIN value" writes the service's value straight into the matching field.
 */
const NIN_PANEL_TONES = {
    valid: { border: "border-emerald-200", bg: "bg-emerald-50/60", icon: "text-emerald-500", title: "text-emerald-800" },
    invalid: { border: "border-red-200", bg: "bg-red-50/60", icon: "text-red-500", title: "text-red-800" },
    error: { border: "border-amber-200", bg: "bg-amber-50/60", icon: "text-amber-500", title: "text-amber-800" },
    idle: { border: "border-slate-200", bg: "bg-slate-50", icon: "text-slate-400", title: "text-slate-700" },
};

function NinVerifyPanel({ nin, dob, status, verifying, message, mismatches, disabled, onRetry, onUse }) {
    const eleven = /^\d{11}$/.test(nin || "");
    if (!eleven) return null; // nothing to verify until the NIN is complete

    // 11-digit NIN but no DOB → the hook can't fire; nudge for the missing input.
    if (!dob) {
        return (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-2.5 text-sm text-slate-500">
                <ShieldAlert size={16} className="text-slate-400 shrink-0" />
                Enter date of birth to verify this NIN.
            </div>
        );
    }

    if (verifying) {
        return (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-2.5 text-sm text-slate-600">
                <Loader2 size={16} className="animate-spin text-primary-500 shrink-0" />
                Verifying NIN…
            </div>
        );
    }

    const tone = NIN_PANEL_TONES[status] || NIN_PANEL_TONES.idle;
    const Icon = status === "valid" ? ShieldCheck : status === "error" ? AlertTriangle : ShieldAlert;
    const heading = status === "valid" ? "NIN verified"
        : status === "error" ? "Couldn't verify NIN"
            : status === "invalid" ? "NIN could not be matched"
                : "NIN not verified";

    return (
        <div className={`rounded-xl border ${tone.border} ${tone.bg} px-4 py-3.5 space-y-3`}>
            <div className="flex items-center gap-2.5">
                <Icon size={17} className={`${tone.icon} shrink-0`} />
                <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${tone.title}`}>{heading}</p>
                    {message && <p className="text-xs text-slate-500 mt-0.5">{message}</p>}
                </div>
                {status === "error" && (
                    <button type="button" onClick={onRetry}
                        className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-colors shrink-0">
                        <RefreshCw size={12} /> Retry
                    </button>
                )}
            </div>

            {status === "valid" && mismatches.length > 0 && (
                <div className="space-y-2 pt-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        {mismatches.length} field{mismatches.length !== 1 ? "s" : ""} differ from the NIN record
                    </p>
                    {mismatches.map((m) => (
                        <div key={m.key} className="flex items-center gap-3 rounded-lg bg-white border border-slate-100 px-3 py-2">
                            <div className="flex-1 min-w-0">
                                <p className="text-[11px] text-slate-400">{m.label}</p>
                                <p className="text-sm truncate">
                                    <span className="text-slate-400 line-through">{m.current}</span>
                                    <span className="mx-1.5 text-slate-300">→</span>
                                    <span className="font-semibold text-slate-800">{m.display}</span>
                                </p>
                            </div>
                            <button type="button" disabled={disabled} onClick={() => onUse(m.key, m.apply)}
                                className="rounded-lg bg-slate-800 text-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-900 disabled:opacity-40 transition-colors shrink-0">
                                Use NIN value
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {status === "valid" && mismatches.length === 0 && (
                <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle size={13} /> All personal details match the NIN record.
                </p>
            )}
        </div>
    );
}

/* ── NIN override confirm ──────────────────────────────────────────────────
 * Shown at enroll time whenever the live NIN verdict is anything other than a
 * fresh "valid". Confirming records nin_verified:false; cancelling sends nothing.
 */
const NIN_CONFIRM_COPY = {
    invalid: {
        title: "NIN could not be matched",
        body: "The NIN service ran but did not match this person's details. Enrolling now records the NIN as unverified.",
    },
    error: {
        title: "NIN not verified",
        body: "We couldn't reach the NIN service to verify this record. Enrolling now records the NIN as unverified — you can re-verify later.",
    },
    idle: {
        title: "NIN not verified yet",
        body: "This NIN hasn't been verified against the government service. Enrolling now records it as unverified.",
    },
};

function NinConfirmModal({ status, message, busy, onCancel, onConfirm }) {
    const copy = NIN_CONFIRM_COPY[status] || NIN_CONFIRM_COPY.idle;
    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
            onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
            <div className="card w-full max-w-sm p-6 text-center space-y-4 animate-scale-in" style={{ boxShadow: "var(--shadow-elevated)" }}>
                <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
                    <ShieldAlert size={26} className="text-amber-500" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-slate-900">{copy.title}</h2>
                    <p className="text-sm text-slate-500 mt-1.5">{copy.body}</p>
                    {message && <p className="text-xs text-slate-400 mt-2 italic">{message}</p>}
                </div>
                <div className="flex gap-3">
                    <button onClick={onCancel} disabled={busy}
                        className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                        Cancel
                    </button>
                    <button onClick={onConfirm} disabled={busy}
                        className="flex-1 rounded-xl bg-amber-500 text-white py-2.5 text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                        {busy && <Loader2 size={14} className="animate-spin" />}
                        {busy ? "Enrolling…" : "Enroll anyway"}
                    </button>
                </div>
            </div>
        </div>
    );
}
