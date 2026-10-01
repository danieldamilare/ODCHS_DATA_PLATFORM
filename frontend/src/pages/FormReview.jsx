import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getForm, updateForm, uploadPassport, rejectForm, enrollForm, getLGAs, getWards, getFacilities, getFacilitiesByLga, getBatchForms, getCategories } from "../api/enrollment";
import { useToast } from "../components/ui/Toast";
import CropModal from "../components/enrollment/CropModal";
import ImageViewer from "../components/enrollment/ImageViewer";
import StatusBanner from "../components/enrollment/StatusBanner";
import FlagCallout from "../components/enrollment/FlagCallout";
import FormActions from "../components/enrollment/FormActions";
import { canEdit } from "../constants/formStatus";
import useNinVerification from "../hooks/useNinVerification";
import { warmNin } from "../api/nin";
import { ArrowLeft, Upload, Crop, User, Loader2, CheckCircle, AlertTriangle, XCircle, Timer, Trophy, X, BarChart3, RefreshCw, ShieldCheck, ShieldAlert, ScanLine, ClipboardList, Users, Plus, Trash2 } from "lucide-react";

/* ── Required fields (mirrors backend FormUpdater) ── */
const BASE_REQUIRED = new Set([
    "title", "surname", "firstname", "dob", "gender",
    "phone_number", "address", "marital_status",
    "kin_firstname", "kin_surname", "kin_relationship", "kin_phone_number",
    "kin_address", "lga_no", "facility_no",
]);

const BHCPF_REQUIRED = new Set([
    ...BASE_REQUIRED,
    "ward_no", "settlement", "category", "nin",
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

const FORMAL_FIELDS = [
    { key: "enployment_id", label: "Staff / Employment ID", grid: "col-span-1" },
    { key: "present_mda", label: "Present MDA / Ministry / Agency", grid: "col-span-1" },
    { key: "department", label: "Department", grid: "col-span-1" },
    { key: "cadre", label: "Cadre / Designation", grid: "col-span-1" },
    { key: "ext_aliment", label: "Existing Ailment / Condition", type: "textarea", grid: "col-span-2" },
];

const LOCATION_FIELDS = [
    { key: "lga_no", label: "LGA of Residence", type: "cascade_lga", grid: "col-span-1" },
    { key: "provider_lga_no", label: "Provider LGA", type: "cascade_provider_lga", grid: "col-span-1" },
    { key: "ward_no", label: "Ward", type: "cascade_ward", grid: "col-span-1" },
    { key: "facility_no", label: "Facility", type: "cascade_facility", grid: "col-span-1" },
];

const KIN_FIELDS = [
    { key: "kin_surname", label: "Surname", grid: "col-span-1" },
    { key: "kin_firstname", label: "First Name", grid: "col-span-1" },
    { key: "kin_othername", label: "Other Name", grid: "col-span-1" },
    { key: "kin_relationship", label: "Relationship", grid: "col-span-1" },
    { key: "kin_phone_number", label: "Phone", type: "phone", grid: "col-span-1" },
    { key: "kin_address", label: "Address", type: "textarea", grid: "col-span-2" },
];

const PREFETCH_COUNT = 5;

// Session-scoped caches for ward and facility lookups.
// Module-level so they persist across form navigations without needing state or context.
const _wardCache = new Map();
const _facilityCache = new Map();

/** MM-DD-YYYY or DD-MM-YYYY → YYYY-MM-DD (for <input type="date">) */
function dobToISO(v) {
    if (!v) return "";
    const str = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) {
        const part1 = m[1].padStart(2, "0");
        const part2 = m[2].padStart(2, "0");
        const year = m[3];
        return `${year}-${part1}-${part2}`;
    }
    return "";
}

/** YYYY-MM-DD → MM-DD-YYYY (for backend) */
function dobFromISO(v) {
    if (!v) return "";
    const str = String(v).trim();
    const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
        const year = m[1];
        const month = m[2].padStart(2, "0");
        const day = m[3].padStart(2, "0");
        return `${month}-${day}-${year}`;
    }
    return str;
}

/** NIN service DOB `DD-MM-YYYY` (day-first, e.g. "12-09-2002") → ISO `YYYY-MM-DD`.
 *  Returns "" if the shape is unrecognised so we never render a bogus mismatch. */
function ninDobToISO(v) {
    if (!v) return "";
    const m = String(v).match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

function getAgeFromDob(dob) {
    if (!dob) return null;
    try {
        const iso = dob.includes("-") && dob.split("-")[0].length === 4 ? dob : dobToISO(dob);
        if (!iso) return null;
        const [y, m, d] = iso.split("-").map(Number);
        if (!y || !m || !d) return null;
        const birthDate = new Date(y, m - 1, d);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const mDiff = today.getMonth() - birthDate.getMonth();
        if (mDiff < 0 || (mDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return isNaN(age) ? null : age;
    } catch {
        return null;
    }
}

function unpackDependants(dpds) {
    if (!dpds || !Array.isArray(dpds)) return [];
    return dpds.map((d) => ({
        ...d,
        dob: dobToISO(d.dob),
    }));
}

export default function FormReview() {
    const { formId: routeFormId, batchId } = useParams();
    const navigate = useNavigate();
    const toast = useToast();

    const isReviewMode = !!batchId;

    // Review queue
    const [queue, setQueue] = useState([]);
    const [queueIndex, setQueueIndex] = useState(0);
    const [hasMoreNext, setHasMoreNext] = useState(true);
    const [hasMorePrev, setHasMorePrev] = useState(false);
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
    const [showValidationErrors, setShowValidationErrors] = useState(false);

    // Passport & Crops
    const [passportFile, setPassportFile] = useState(null);
    const [useAvatar, setUseAvatar] = useState(false);
    const [cropCoords, setCropCoords] = useState(null);
    const [showCropModal, setShowCropModal] = useState(false);
    const [activeCropTarget, setActiveCropTarget] = useState(null); // null = enrollee, number = dependant index
    const [croppedPreview, setCroppedPreview] = useState(null);
    const [cachedImgUrl, setCachedImgUrl] = useState(null);
    const cachedImgUrlRef = useRef(null);
    const passportRef = useRef();

    // Dependants
    const [dependants, setDependants] = useState([]);

    // Rotation (net clockwise degrees, synced to backend via rotate_angle on enroll)
    const [rotation, setRotation] = useState(0);
    const [rotatedImgUrl, setRotatedImgUrl] = useState(null);
    const rotatedImgUrlRef = useRef(null);

    // Reject
    const [showReject, setShowReject] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const [rejecting, setRejecting] = useState(false);

    // Mobile tab — "form" shows the scanned image, "details" shows the fields.
    // Only applies below the lg breakpoint; desktop ignores this entirely.
    const [mobileTab, setMobileTab] = useState("form");

    // NIN verification override gate (enroll confirm shown whenever NIN isn't "valid")
    const [showNinConfirm, setShowNinConfirm] = useState(false);
    const [pendingNinAction, setPendingNinAction] = useState(null);

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

    const PREFETCH_COUNT = 20;

    async function fetchReviewBatch(after = null, before = null) {
        if (prefetchingRef.current) return;
        prefetchingRef.current = true;
        try {
            const res = await getBatchForms(batchId, { status: "ready", after, before, count: PREFETCH_COUNT });
            const newForms = res.data || [];
            
            if (after) {
                setHasMoreNext(res.has_more || false);
                setQueue((prev) => [...prev, ...newForms]);
            } else if (before) {
                setHasMorePrev(res.has_more || false);
                setQueue((prev) => [...newForms, ...prev]);
                setQueueIndex((prev) => prev + newForms.length); // shift index
            } else {
                setHasMoreNext(res.has_more || false);
                setHasMorePrev(res.has_prev || false);
                if (newForms.length === 0) {
                    setReviewComplete(true);
                    setLoading(false);
                    return;
                }
                setQueue(newForms);
                setCurrentFormId(newForms[0]?.id);
                setQueueIndex(0);
                applyCachedForm(newForms[0]);
            }
        } catch {
            toast.error("Failed to load review queue");
        } finally {
            prefetchingRef.current = false;
        }
    }

    useEffect(() => {
        if (!isReviewMode) return;
        
        // Fetch NEXT if getting close to end
        const remainingNext = queue.length - queueIndex;
        if (remainingNext <= 3 && hasMoreNext && queue.length > 0) {
            fetchReviewBatch(queue[queue.length - 1]?.id, null);
        }
        
        // Fetch PREV if getting close to start
        if (queueIndex <= 2 && hasMorePrev && queue.length > 0) {
            fetchReviewBatch(null, queue[0]?.id);
        }
    }, [queueIndex, queue.length, hasMoreNext, hasMorePrev, isReviewMode]);

    function advanceToNext() {
        const nextIdx = queueIndex + 1;
        if (nextIdx < queue.length) {
            setQueueIndex(nextIdx);
            setCurrentFormId(queue[nextIdx].id);
            applyCachedForm(queue[nextIdx]);
        } else if (!hasMoreNext) {
            setReviewComplete(true);
        }
    }

    function navigateHeader(direction) {
        if (Object.keys(touched).length > 0) {
            if (!window.confirm("You have unsaved changes. Discard and leave?")) return;
        }
        if (direction === "next") {
            advanceToNext();
        } else if (direction === "prev") {
            const prevIdx = queueIndex - 1;
            if (prevIdx >= 0) {
                setQueueIndex(prevIdx);
                setCurrentFormId(queue[prevIdx].id);
                applyCachedForm(queue[prevIdx]);
            }
        }
        setTouched({});
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
    // We use fetch() instead of new Image() deliberately: the main blob download
    // (fetch → blob → createObjectURL) uses credentials + CSRF headers, which
    // creates a different HTTP cache entry than a plain <img src> preload.
    // Using fetch() here means the prefetch and the actual blob download share
    // the same cache entry — so the next form's image is already in cache.

    useEffect(() => {
        if (!queue || queue.length === 0) return;
        queue.forEach((qf, i) => {
            if (i >= queueIndex - 1 && i <= queueIndex + 3 && i !== queueIndex) {
                if (qf.img_path) fetch(qf.img_path, { credentials: "include" }).catch(() => {});
                if (qf.passport_path) fetch(qf.passport_path, { credentials: "include" }).catch(() => {});
            }
        });
    }, [queue, queueIndex]);

    // ═══════════════ Form loading ═══════════════

    function applyCachedForm(cached) {
        setLoading(false);
        warmNin();
        resetFormState();
        setForm(cached);
        setFields(unpackForm(cached));
        setDependants(unpackDependants(cached.dependants));
        setTouched({});
        const coords = cached.passport_coord || {};
        setCropCoords({
            xmin: coords.xmin || 0, ymin: coords.ymin || 0,
            xmax: coords.xmax || 0, ymax: coords.ymax || 0,
        });
    }

    useEffect(() => {
        if (!currentFormId) return;
        if (form && form.id === currentFormId) return; // already applied
        
        if (isReviewMode && queue.length > 0) {
            const cached = queue.find(f => f.id === currentFormId);
            if (cached) {
                applyCachedForm(cached);
                return;
            }
        }
        loadForm(currentFormId);
    }, [currentFormId, isReviewMode, form, queue]);

    function loadForm(id) {
        setLoading(true);
        warmNin(); // keep the NIN service token hot for every review page's auto-verify
        resetFormState();
        getForm(id)
            .then((res) => {
                const d = res.data;
                setForm(d);
                setFields(unpackForm(d));
                setDependants(unpackDependants(d.dependants));
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
        setActiveCropTarget(null);
        setDependants([]);
        setTouched({});
        if (cachedImgUrlRef.current) URL.revokeObjectURL(cachedImgUrlRef.current);
        setCachedImgUrl(null);
        cachedImgUrlRef.current = null;
        setRotation(0);
        if (rotatedImgUrlRef.current) URL.revokeObjectURL(rotatedImgUrlRef.current);
        setRotatedImgUrl(null);
        rotatedImgUrlRef.current = null;
        setMobileTab("form"); // always land on the image when a new form loads
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
    // Wards and facilities are cached in module-level Maps so navigating between
    const scheme = (form?.scheme || "bhcpfp").toLowerCase();
    const isBhcpf = scheme === "bhcpfp";
    const isOranghis = (form?.scheme || "").toLowerCase() === "oranghis";
    const isMarried = (fields.marital_status || "").toLowerCase() === "married";
    const activeRequired = isBhcpf ? BHCPF_REQUIRED : BASE_REQUIRED;

    useEffect(() => {
        getLGAs().then((r) => setLgas(Array.isArray(r) ? r : r.data || [])).catch(() => {});
        getCategories().then((r) => setCategories(Array.isArray(r) ? r : r.data || [])).catch(() => {});
    }, []);

    const effectiveProviderLga = fields.provider_lga_no || fields.lga_no;

    useEffect(() => {
        if (!effectiveProviderLga) { 
            setWards([]); 
            if (!isBhcpf) setFacilities([]); 
            return; 
        }
        if (isBhcpf) {
            const cached = _wardCache.get(String(effectiveProviderLga));
            if (cached) { setWards(cached); return; }
            getWards(effectiveProviderLga).then((r) => {
                const data = Array.isArray(r) ? r : r.data || [];
                _wardCache.set(String(effectiveProviderLga), data);
                setWards(data);
            }).catch(() => {});
        } else {
            const cacheKey = `${scheme}:${effectiveProviderLga}`;
            const cached = _facilityCache.get(cacheKey);
            if (cached) { setFacilities(cached); return; }
            getFacilities(effectiveProviderLga, scheme).then((r) => {
                const data = Array.isArray(r) ? r : r.data || [];
                _facilityCache.set(cacheKey, data);
                setFacilities(data);
            }).catch(() => {});
        }
    }, [effectiveProviderLga, isBhcpf, scheme]);

    useEffect(() => {
        if (!isBhcpf) return;
        if (!fields.ward_no) { setFacilities([]); return; }
        const cacheKey = `bhcpfp:${fields.ward_no}`;
        const cached = _facilityCache.get(cacheKey);
        if (cached) { setFacilities(cached); return; }
        getFacilities(fields.ward_no, "bhcpfp").then((r) => {
            const data = Array.isArray(r) ? r : r.data || [];
            _facilityCache.set(cacheKey, data);
            setFacilities(data);
        }).catch(() => {});
    }, [fields.ward_no, isBhcpf]);


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

    function unpackForm(d) {
        const kin = d.next_of_kin || {};
        return {
            title: d.title || "", surname: d.surname || "", firstname: d.firstname || "",
            othername: d.othername || "", dob: dobToISO(d.dob), gender: d.gender || "",
            phone_number: d.phone_number || "", nin: d.nin || "", address: d.address || "",
            marital_status: d.marital_status ?? "", settlement: d.settlement || "",
            occupation: d.occupation || "", category: d.category ?? "",
            scheme: d.scheme || "",
            lga_no: d.lga_no || "", provider_lga_no: d.provider_lga_no || d.lga_no || "",
            ward_no: d.ward_no || "", facility_no: d.facility_no || "",
            kin_surname: kin.surname || "", kin_firstname: kin.firstname || "",
            kin_othername: kin.othername || "", kin_relationship: kin.relationship || "",
            kin_phone_number: kin.phone_number || "", kin_address: kin.address || "",
            enployment_id: d.enployment_id || "",
            present_mda: d.present_mda || "",
            department: d.department || "",
            cadre: d.cadre || "",
            ext_aliment: d.ext_aliment || "",
        };
    }

    function updateField(key, value) {
        setFields((prev) => {
            const next = { ...prev, [key]: value };
            if (key === "lga_no" && !prev.provider_lga_no) {
                next.provider_lga_no = value;
            }
            return next;
        });
        setTouched((prev) => ({ ...prev, [key]: true }));
    }

    function handleUpdateDependant(idx, key, value) {
        setDependants((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], [key]: value };
            return next;
        });
        setTouched((prev) => ({ ...prev, [`dependant_${idx}_${key}`]: true }));
    }

    function handleSelectSpouse(idx) {
        setDependants((prev) =>
            prev.map((dpd, i) => ({
                ...dpd,
                is_spouse: i === idx,
            }))
        );
        setTouched((prev) => ({ ...prev, dependants: true }));
    }

    function handleAddDependant() {
        setDependants((prev) => [
            ...prev,
            {
                sequence: prev.length + 1,
                name: "",
                dob: "",
                gender: "",
                phone_number: "",
                is_spouse: false,
                lga_no: fields.lga_no || "",
                facility_no: fields.facility_no || "",
                medical_history: "",
                passport_path: null,
                passport_coord: { xmin: 0, ymin: 0, xmax: 0, ymax: 0 },
            },
        ]);
        setTouched((prev) => ({ ...prev, dependants: true }));
    }

    function handleRemoveDependant(idx) {
        setDependants((prev) => prev.filter((_, i) => i !== idx));
        setTouched((prev) => ({ ...prev, dependants: true }));
    }

    function handleOpenDependantCrop(idx) {
        if (rotation !== 0 && !rotatedImgUrl) {
            toast.warn("Preparing rotated image, try again in a moment");
            return;
        }
        setActiveCropTarget(idx);
        setShowCropModal(true);
    }

    function handleCropApply(coords) {
        if (activeCropTarget === null) {
            setCropCoords(coords);
            setPassportFile(null);
            setUseAvatar(false);
        } else {
            setDependants((prev) => {
                const next = [...prev];
                if (next[activeCropTarget]) {
                    next[activeCropTarget] = {
                        ...next[activeCropTarget],
                        passport_coord: coords,
                        passport_preview: null,
                        passport_base64: null,
                        passport_path: null,
                    };
                }
                return next;
            });
            setTouched((prev) => ({ ...prev, [`dependant_${activeCropTarget}_crop`]: true }));
        }
        setShowCropModal(false);
        setActiveCropTarget(null);
    }

    function getMissingRequired() {
        return [...activeRequired].filter((k) => {
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

    function getPhoneError(key = "phone_number") {
        const raw = (fields[key] || "").replace(/^\+?234/, "");
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
        if (ninStatus === "valid") {
            doEnroll(true);
        } else {
            // Need a way to tell the NinConfirmModal we are enrolling, not just saving
            // Since NinConfirmModal is generic, let's store the pending action
            setPendingNinAction("enroll");
            setShowNinConfirm(true);
        }
    }

    async function handleSave() {
        if (!validateBeforeEnroll()) return;
        if (ninStatus === "valid") {
            doSave(true);
        } else {
            setPendingNinAction("save");
            setShowNinConfirm(true);
        }
    }

    function validateBeforeEnroll() {
        const missing = getMissingRequired();
        if (missing.length > 0) {
            setShowValidationErrors(true);
            toast.warn("Please fill all compulsory fields before enrolling");
            return false;
        }
        setShowValidationErrors(false);
        const ninErr = getNinError();
        const phoneErr = getPhoneError("phone_number");
        const kinPhoneErr = getPhoneError("kin_phone_number");
        if (ninErr || phoneErr || kinPhoneErr) {
            toast.warn(ninErr || phoneErr || kinPhoneErr);
            return false;
        }
        if (isMarried && dependants.length > 0 && !dependants.some((d) => d.is_spouse)) {
            toast.warn("Enrollee is Married. Please select which dependant is the spouse before enrolling.");
            return false;
        }
        for (let i = 0; i < dependants.length; i++) {
            const d = dependants[i];
            const seq = d.sequence || i + 1;
            if (!d.name || !d.name.trim()) {
                setShowValidationErrors(true);
                toast.warn(`Please enter full name for Dependant #${seq}`);
                return false;
            }
            if (!d.dob) {
                setShowValidationErrors(true);
                toast.warn(`Please select date of birth for Dependant #${seq}`);
                return false;
            }
            if (!d.gender) {
                setShowValidationErrors(true);
                toast.warn(`Please select gender for Dependant #${seq}`);
                return false;
            }
            const effectivePhone = d.phone_number || fields.phone_number;
            if (!effectivePhone) {
                setShowValidationErrors(true);
                toast.warn(`Please provide phone number for Dependant #${seq}`);
                return false;
            }
            const effectiveLga = d.lga_no || fields.lga_no;
            if (!effectiveLga) {
                setShowValidationErrors(true);
                toast.warn(`Please select preferred LGA for Dependant #${seq}`);
                return false;
            }
            const effectiveFacility = d.facility_no || fields.facility_no;
            if (!effectiveFacility) {
                setShowValidationErrors(true);
                toast.warn(`Please select preferred facility for Dependant #${seq}`);
                return false;
            }
        }
        if (rotation !== 0 && !(cropCoords && cropCoords.xmax > 0) && !passportFile && !useAvatar) {
            toast.warn("Image was rotated — recrop the passport or upload a photo before enrolling");
            return false;
        }
        return true;
    }


    function buildPayload(ninVerified) {
        const payload = { ...fields };
        payload.scheme = fields.scheme || form?.scheme || "";
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
        payload.category = payload.category ? parseInt(payload.category, 10) : null;
        payload.ward_no = payload.ward_no ? parseInt(payload.ward_no, 10) : null;
        payload.lga_no = payload.lga_no ? parseInt(payload.lga_no, 10) : null;
        payload.facility_no = payload.facility_no ? parseInt(payload.facility_no, 10) : null;

        if (dependants && dependants.length > 0) {
            // Rule: non-spouse dependants older than 18 are excluded and deleted upon update
            payload.dependants = dependants
                .filter((d) => {
                    if (d.is_spouse) return true;
                    const age = getAgeFromDob(d.dob);
                    return age === null || age <= 18;
                })
                .map((d, newIdx) => ({
                    ...d,
                    sequence: newIdx + 1,
                    dob: d.dob ? dobFromISO(d.dob) : "",
                    phone_number: d.phone_number || fields.phone_number || "",
                    lga_no: d.lga_no ? parseInt(d.lga_no, 10) : (payload.lga_no || null),
                    facility_no: d.facility_no ? parseInt(d.facility_no, 10) : (payload.facility_no || null),
                }));
        }
        return payload;
    }

    async function doEnroll(ninVerified) {
        setShowNinConfirm(false);
        setEnrolling(true);
        try {
            // Passport upload first: the backend's rotate check requires a
            // passport source to already exist when no fresh crop is sent
            if (passportFile) await uploadPassport(currentFormId, passportFile);
            const payload = buildPayload(ninVerified);
            await updateForm(currentFormId, payload);
            setDependants((prev) =>
                prev.filter((d) => {
                    if (d.is_spouse) return true;
                    const age = getAgeFromDob(d.dob);
                    return age === null || age <= 18;
                })
            );
            const res = await enrollForm(currentFormId);
            if (res.status === "duplicate") {
                toast.warn(res.msg || "Enrollee already exists");
            } else {
                toast.success(res.msg || "Enrolled successfully");
            }
            setTouched({});
            if (isReviewMode) { setEnrollCount((c) => c + 1); advanceToNext(); } else {
                loadForm(currentFormId);
            }
        } catch (err) {
            toast.error(err?.msg || "Enrollment failed");
        } finally { setEnrolling(false); }
    }

    async function doSave(ninVerified) {
        setShowNinConfirm(false);
        setEnrolling(true); // Re-use the loading overlay state
        try {
            if (passportFile) await uploadPassport(currentFormId, passportFile);
            const payload = buildPayload(ninVerified);
            await updateForm(currentFormId, payload);
            setDependants((prev) =>
                prev.filter((d) => {
                    if (d.is_spouse) return true;
                    const age = getAgeFromDob(d.dob);
                    return age === null || age <= 18;
                })
            );
            toast.success("Draft saved successfully");
            setTouched({});
            if (isReviewMode) { advanceToNext(); } else {
                loadForm(currentFormId);
            }
        } catch (err) {
            toast.error(err?.msg || "Save failed");
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

    // Memoize passport file blob URL — must be here (before early returns) to
    // satisfy Rules of Hooks. useMemo cannot be called after a conditional return.
    const passportFileSrc = useMemo(
        () => (passportFile ? URL.createObjectURL(passportFile) : null),
        [passportFile]
    );

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

    // Show the raw URL immediately so the viewer paints without waiting for the blob.
    // cachedImgUrl (the blob) is used when available — the CropModal requires it for
    // canvas drawing; the viewer just needs any paintable src, raw URL is fine.
    const displaySrc = rotation !== 0
        ? (rotatedImgUrl || cachedImgUrl || form.img_path)
        : (cachedImgUrl || form.img_path);

    const passportSrc = passportFileSrc
        ? passportFileSrc
        : useAvatar
            ? (fields.gender?.toLowerCase() === "male" ? form.MALE_AVATAR : form.FEMALE_AVATAR)
            : form.passport_path || croppedPreview || null;

    const isMissing = (key) => showValidationErrors && activeRequired.has(key) && (fields[key] === "" || fields[key] == null);
    const ninError = touched.nin ? getNinError() : null;
    const phoneError = touched.phone_number ? getPhoneError("phone_number") : null;
    const kinPhoneError = touched.kin_phone_number ? getPhoneError("kin_phone_number") : null;
    const ninMismatches = getNinMismatches();
    const hasDependants = isOranghis || (dependants && dependants.length > 0);

    return (
        <div className="h-screen flex flex-col bg-slate-50">
            {/* ── Top bar ── */}
            <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200/80" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.03)" }}>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => isReviewMode ? setShowCancelConfirm(true) : navigate(-1)}
                        className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
                        title="Back to queue"
                    >
                        <ArrowLeft size={18} className="text-slate-500" />
                    </button>
                    <div>
                        <h1 className="text-sm font-bold text-slate-900">
                            {form.surname || form.firstname ? `${form.surname || ""}, ${form.firstname || ""}`.trim() : "Form Review"}
                        </h1>
                        <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">{form.status}</p>
                    </div>
                    
                    {isReviewMode && (
                        <div className="flex items-center gap-1 ml-4 bg-slate-100 p-1 rounded-lg">
                            <button
                                onClick={() => navigateHeader("prev")}
                                disabled={queueIndex === 0 && !hasMorePrev}
                                className="px-3 py-1 rounded text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none transition-all font-bold"
                                title="Previous Form"
                            >
                                &lt;
                            </button>
                            <div className="text-[11px] text-slate-400 font-medium px-1">
                                {queueIndex + 1}
                            </div>
                            <button
                                onClick={() => navigateHeader("next")}
                                disabled={queueIndex === queue.length - 1 && !hasMoreNext}
                                className="px-3 py-1 rounded text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none transition-all font-bold"
                                title="Next Form"
                            >
                                &gt;
                            </button>
                        </div>
                    )}
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
                                {queueIndex + 1} / {hasMoreNext ? `${queue.length}+` : queue.length}
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

            {/* ── Layout ── */}
            <div className="flex-1 flex overflow-hidden">

                {/* ══ DESKTOP: left image pane (hidden below lg) ══ */}
                <div className="w-1/2 bg-slate-900 shrink-0 max-lg:hidden">
                    {displaySrc ? (
                        <ImageViewer key={displaySrc} src={displaySrc} onRotate={!isLocked ? handleRotate : undefined} />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <p className="text-slate-600">No scan available</p>
                        </div>
                    )}
                </div>

                {/* ══ MOBILE: tab bar + tab panels (hidden on lg+) ══ */}
                <div className="lg:hidden flex flex-col flex-1 overflow-hidden">
                    {/* Tab bar */}
                    <div className="shrink-0 flex border-b border-slate-200 bg-white">
                        <button
                            onClick={() => setMobileTab("form")}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold border-b-2 transition-colors ${
                                mobileTab === "form"
                                    ? "border-primary-500 text-primary-600"
                                    : "border-transparent text-slate-400 hover:text-slate-600"
                            }`}
                        >
                            <ScanLine size={15} />
                            Form Image
                        </button>
                        <button
                            onClick={() => setMobileTab("details")}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold border-b-2 transition-colors relative ${
                                mobileTab === "details"
                                    ? "border-primary-500 text-primary-600"
                                    : "border-transparent text-slate-400 hover:text-slate-600"
                            }`}
                        >
                            <ClipboardList size={15} />
                            Details
                            {/* Warning dot — shows if the form has any flags */}
                            {(form.flags?.length > 0 || form.nin_status === "mismatch") && (
                                <span className="absolute top-2.5 right-[calc(50%-28px)] w-2 h-2 rounded-full bg-amber-400" />
                            )}
                        </button>
                    </div>

                    {/* Tab: Form Image — full-height ImageViewer */}
                    {mobileTab === "form" && (
                        <div className="flex-1 bg-slate-900 overflow-hidden">
                            {displaySrc ? (
                                <ImageViewer key={displaySrc} src={displaySrc} onRotate={!isLocked ? handleRotate : undefined} />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <p className="text-slate-500">No scan available</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Tab: Details — same scrollable column as desktop right pane */}
                    {mobileTab === "details" && (
                        <div className="flex-1 overflow-y-auto bg-white custom-scrollbar">
                            <div className="w-full px-4 py-6 space-y-7">

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
                                    <button type="button" disabled={isLocked || !cachedImgUrl}
                                        title={!cachedImgUrl ? "Loading image, please wait…" : "Crop passport photo"}
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
                                {PERSONAL_FIELDS.map((f) => {
                                    const mismatch = ninMismatches?.find((m) => m.key === f.key);
                                    return (
                                        <div key={f.key} className={f.grid}>
                                            <FieldInput field={f} value={fields[f.key] ?? ""} onChange={(v) => updateField(f.key, v)}
                                                disabled={isLocked} required={activeRequired.has(f.key)}
                                                lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                                error={isMissing(f.key) ? "Compulsory field" : f.key === "nin" ? ninError : f.key === "phone_number" ? phoneError : null}
                                            />
                                            {f.key === "nin" && (
                                                <NinFieldFeedback
                                                    nin={fields.nin} dob={fields.dob} status={ninStatus}
                                                    verifying={ninVerifying} message={ninMessage}
                                                    allMatched={ninStatus === "valid" && ninMismatches.length === 0}
                                                    onRetry={reverifyNin}
                                                />
                                            )}
                                            {ninStatus === "valid" && mismatch && (
                                                <MismatchInlineFeedback mismatch={mismatch} onUse={updateField} disabled={isLocked} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </Section>

                        {/* ── Employment / Formal Scheme Details (OrangHIS) ── */}
                        {isOranghis && (
                            <Section title="Employment / Scheme Details">
                                <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                                    {FORMAL_FIELDS.map((f) => (
                                        <div key={f.key} className={f.grid}>
                                            <FieldInput field={f} value={fields[f.key] ?? ""} onChange={(v) => updateField(f.key, v)}
                                                disabled={isLocked} required={false}
                                                lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                                error={null}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {/* ── Location ── */}
                        <Section title="Location">
                            <div className={`grid grid-cols-1 ${isBhcpf ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"} gap-x-4 gap-y-5`}>
                                {(isBhcpf ? LOCATION_FIELDS : LOCATION_FIELDS.filter(f => f.key !== "ward_no")).map((f) => (
                                    <div key={f.key} className={f.grid}>
                                        <FieldInput field={f} value={fields[f.key] ?? ""} onChange={(v) => updateField(f.key, v)}
                                            disabled={isLocked} required={activeRequired.has(f.key)}
                                            lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                            error={isMissing(f.key) ? "Compulsory field" : null}
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
                                            disabled={isLocked} required={activeRequired.has(f.key)}
                                            lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                            error={isMissing(f.key) ? "Compulsory field" : f.key === "kin_phone_number" ? kinPhoneError : null}
                                        />
                                        {f.key === "kin_address" && (
                                            <label className="flex items-center gap-2 mt-2 text-[11px] font-medium text-slate-500 cursor-pointer select-none">
                                                <input 
                                                    type="checkbox" 
                                                    disabled={isLocked}
                                                    checked={fields.kin_address === fields.address && !!fields.address}
                                                    onChange={(e) => {
                                                        if (e.target.checked) updateField("kin_address", fields.address || "");
                                                        else updateField("kin_address", "");
                                                    }}
                                                    className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 w-3 h-3"
                                                />
                                                Same as enrollee address
                                            </label>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </Section>

                        {/* ── Dependants Section ── */}
                        {hasDependants && (
                            <DependantsSection
                                dependants={dependants}
                                onUpdateDependant={handleUpdateDependant}
                                onSelectSpouse={handleSelectSpouse}
                                isMarried={isMarried}
                                onRecrop={handleOpenDependantCrop}
                                onAddDependant={handleAddDependant}
                                onRemoveDependant={handleRemoveDependant}
                                disabled={isLocked}
                                displaySrc={displaySrc}
                                lgas={lgas}
                                facilities={facilities}
                                principalFields={fields}
                                scheme={scheme}
                                showValidationErrors={showValidationErrors}
                            />
                        )}


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
                                    <button onClick={handleSave} disabled={enrolling}
                                        className="flex-1 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 py-3 text-sm font-semibold disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                                        Save & Skip
                                    </button>
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
                    )}
                </div>

                {/* ══ DESKTOP: right scrollable column (hidden below lg) ══ */}
                <div className="max-lg:hidden flex-1 overflow-y-auto bg-white border-l border-slate-200/80 custom-scrollbar">
                    <div className="w-full px-6 xl:px-12 py-6 space-y-7">

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
                                    <button type="button" disabled={isLocked || !cachedImgUrl}
                                        title={!cachedImgUrl ? "Loading image, please wait…" : "Crop passport photo"}
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
                                {PERSONAL_FIELDS.map((f) => {
                                    const mismatch = ninMismatches?.find((m) => m.key === f.key);
                                    return (
                                        <div key={f.key} className={f.grid}>
                                            <FieldInput field={f} value={fields[f.key] ?? ""} onChange={(v) => updateField(f.key, v)}
                                                disabled={isLocked} required={activeRequired.has(f.key)}
                                                lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                                error={isMissing(f.key) ? "Compulsory field" : f.key === "nin" ? ninError : f.key === "phone_number" ? phoneError : null}
                                            />
                                            {f.key === "nin" && (
                                                <NinFieldFeedback
                                                    nin={fields.nin} dob={fields.dob} status={ninStatus}
                                                    verifying={ninVerifying} message={ninMessage}
                                                    allMatched={ninStatus === "valid" && ninMismatches.length === 0}
                                                    onRetry={reverifyNin}
                                                />
                                            )}
                                            {ninStatus === "valid" && mismatch && (
                                                <MismatchInlineFeedback mismatch={mismatch} onUse={updateField} disabled={isLocked} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </Section>

                        {/* ── Employment / Formal Scheme Details (OrangHIS) ── */}
                        {isOranghis && (
                            <Section title="Employment / Scheme Details">
                                <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                                    {FORMAL_FIELDS.map((f) => (
                                        <div key={f.key} className={f.grid}>
                                            <FieldInput field={f} value={fields[f.key] ?? ""} onChange={(v) => updateField(f.key, v)}
                                                disabled={isLocked} required={false}
                                                lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                                error={null}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {/* ── Location ── */}
                        <Section title="Location">
                            <div className={`grid ${isBhcpf ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3"} gap-x-4 gap-y-5`}>
                                {(isBhcpf ? LOCATION_FIELDS : LOCATION_FIELDS.filter((f) => f.key !== "ward_no")).map((f) => (
                                    <div key={f.key} className={f.grid}>
                                        <FieldInput field={f} value={fields[f.key] ?? ""} onChange={(v) => updateField(f.key, v)}
                                            disabled={isLocked} required={activeRequired.has(f.key)}
                                            lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                            error={isMissing(f.key) ? "Compulsory field" : null}
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
                                            disabled={isLocked} required={activeRequired.has(f.key)}
                                            lgas={lgas} wards={wards} facilities={facilities} categories={categories}
                                            error={isMissing(f.key) ? "Compulsory field" : f.key === "kin_phone_number" ? kinPhoneError : null}
                                        />
                                        {f.key === "kin_address" && (
                                            <label className="flex items-center gap-2 mt-2 text-[11px] font-medium text-slate-500 cursor-pointer select-none">
                                                <input 
                                                    type="checkbox" 
                                                    disabled={isLocked}
                                                    checked={fields.kin_address === fields.address && !!fields.address}
                                                    onChange={(e) => {
                                                        if (e.target.checked) updateField("kin_address", fields.address || "");
                                                        else updateField("kin_address", "");
                                                    }}
                                                    className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 w-3 h-3"
                                                />
                                                Same as enrollee address
                                            </label>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </Section>

                        {/* ── Dependants Section ── */}
                        {hasDependants && (
                            <DependantsSection
                                dependants={dependants}
                                onUpdateDependant={handleUpdateDependant}
                                onRecrop={handleOpenDependantCrop}
                                onAddDependant={handleAddDependant}
                                onRemoveDependant={handleRemoveDependant}
                                onSelectSpouse={handleSelectSpouse}
                                isMarried={isMarried}
                                disabled={isLocked}
                                displaySrc={displaySrc}
                                lgas={lgas}
                                facilities={facilities}
                                principalFields={fields}
                                scheme={scheme}
                                showValidationErrors={showValidationErrors}
                            />
                        )}

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
                                    <button onClick={handleSave} disabled={enrolling}
                                        className="flex-1 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 py-3 text-sm font-semibold disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                                        Save & Skip
                                    </button>
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
                <CropModal
                    imgSrc={displaySrc}
                    initialCoords={activeCropTarget === null ? cropCoords : (dependants[activeCropTarget]?.passport_coord || null)}
                    title={
                        activeCropTarget === null
                            ? "Crop Passport Photo"
                            : dependants[activeCropTarget]?.name
                            ? `Crop Passport - ${dependants[activeCropTarget].name}`
                            : `Crop Passport - Dependant #${(dependants[activeCropTarget]?.sequence || activeCropTarget + 1)}`
                    }
                    onApply={handleCropApply}
                    onClose={() => {
                        setShowCropModal(false);
                        setActiveCropTarget(null);
                    }}
                />
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
                    onConfirm={() => {
                        if (pendingNinAction === "save") doSave(false);
                        else doEnroll(false);
                    }}
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

    if (field.type === "cascade_lga" || field.type === "cascade_provider_lga") {
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

function NinFieldFeedback({ nin, dob, status, verifying, message, allMatched, onRetry }) {
    const eleven = /^\d{11}$/.test(nin || "");
    if (!eleven) return null;
    if (!dob) return (
        <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Enter date of birth to verify this NIN.
        </p>
    );
    if (verifying) return (
        <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin text-primary-500" /> Verifying NIN…
        </p>
    );

    if (status === "valid") {
        return (
            <div className="mt-1.5">
                <p className="text-xs font-semibold text-emerald-600 flex items-center gap-1.5">
                    <ShieldCheck size={14} /> NIN verified
                </p>
                {allMatched && (
                    <p className="text-[11px] text-emerald-600/80 mt-0.5">All details match NIN record.</p>
                )}
            </div>
        );
    }

    if (status === "invalid") {
        return (
            <div className="mt-1.5">
                <p className="text-xs font-semibold text-red-600 flex items-center gap-1.5">
                    <ShieldAlert size={14} /> NIN could not be matched
                </p>
                {message && <p className="text-[11px] text-red-500 mt-0.5">{message}</p>}
            </div>
        );
    }

    if (status === "error") {
        return (
            <div className="mt-1.5 flex items-start justify-between gap-2">
                <div>
                    <p className="text-xs font-semibold text-amber-600 flex items-center gap-1.5">
                        <AlertTriangle size={14} /> Couldn't verify NIN
                    </p>
                    {message && <p className="text-[11px] text-amber-600/80 mt-0.5">{message}</p>}
                </div>
                <button type="button" onClick={onRetry}
                    className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800 transition-colors">
                    <RefreshCw size={10} /> Retry
                </button>
            </div>
        );
    }

    return null;
}

function MismatchInlineFeedback({ mismatch, onUse, disabled }) {
    if (!mismatch) return null;
    return (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
            <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wider font-bold text-amber-600 mb-0.5">NIN Record Shows:</p>
                <p className="text-xs font-semibold text-amber-900 truncate">{mismatch.display}</p>
            </div>
            <button type="button" disabled={disabled} onClick={() => onUse(mismatch.key, mismatch.apply)}
                className="rounded text-white bg-amber-600 px-2.5 py-1 text-[10px] font-bold hover:bg-amber-700 disabled:opacity-40 transition-colors shrink-0">
                Use this
            </button>
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

/* ── Dependant Passport Live Canvas Preview ────────────────────────────────
 * If a static passport_path exists, render it.
 * Otherwise, if passport_coord has positive bounding box, slice it live
 * from the scanned form image (displaySrc) onto an HTML5 canvas.
 */
function DependantPassportPreview({ imgSrc, passportPath, passportPreview, coords }) {
    const canvasRef = useRef(null);
    const activePreview = passportPreview || passportPath;

    useEffect(() => {
        if (activePreview) return; // static image takes priority
        const canvas = canvasRef.current;
        if (!canvas || !imgSrc || !coords || !coords.xmax || coords.xmax <= coords.xmin || coords.ymax <= coords.ymin) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const width = coords.xmax - coords.xmin;
            const height = coords.ymax - coords.ymin;
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.drawImage(
                    img,
                    coords.xmin, coords.ymin, width, height,
                    0, 0, width, height
                );
            }
        };
        img.src = imgSrc;
    }, [imgSrc, activePreview, coords?.xmin, coords?.ymin, coords?.xmax, coords?.ymax]);

    if (activePreview) {
        return (
            <img
                src={activePreview}
                alt="Dependant Passport"
                className="w-full h-full object-cover rounded-lg"
            />
        );
    }

    if (coords && coords.xmax > 0 && coords.xmax > (coords.xmin || 0)) {
        return (
            <canvas
                ref={canvasRef}
                className="w-full h-full object-cover rounded-lg"
            />
        );
    }

    return <User size={38} className="text-slate-300" />;
}

/* ── Dependants Section ───────────────────────────────────────────────────
 * Allows reviewing, editing, adding, removing, selecting spouse, and cropping
 * passport photos for all dependants attached to the form.
 */
function DependantsSection({
    dependants,
    onUpdateDependant,
    onRecrop,
    onAddDependant,
    onRemoveDependant,
    onSelectSpouse,
    isMarried,
    disabled,
    displaySrc,
    lgas,
    facilities,
    principalFields = {},
    scheme = "oranghis",
    showValidationErrors = false,
}) {
    const hasSpouseSelected = dependants.some((d) => d.is_spouse);
    const [lgaFacilitiesMap, setLgaFacilitiesMap] = useState({});

    // Load facilities for a specific LGA
    const loadFacilitiesForLga = useCallback(async (lgaId) => {
        if (!lgaId) return [];
        if (lgaFacilitiesMap[lgaId]) return lgaFacilitiesMap[lgaId];
        try {
            const isBhcpf = (scheme || "").toLowerCase() === "bhcpfp";
            const res = isBhcpf ? await getFacilities(lgaId, scheme) : await getFacilitiesByLga(lgaId, scheme);
            const list = Array.isArray(res) ? res : res.data || [];
            setLgaFacilitiesMap((prev) => ({ ...prev, [lgaId]: list }));
            return list;
        } catch {
            return [];
        }
    }, [scheme, lgaFacilitiesMap]);

    // Pre-fetch facilities for all unique LGAs in dependants list
    useEffect(() => {
        dependants.forEach((dpd) => {
            const lgaId = dpd.lga_no || principalFields.lga_no;
            if (lgaId && !lgaFacilitiesMap[lgaId]) {
                loadFacilitiesForLga(lgaId);
            }
        });
    }, [dependants, principalFields.lga_no, lgaFacilitiesMap, loadFacilitiesForLga]);

    return (
        <fieldset className="card p-6">
            <legend className="section-accent text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                    <Users size={14} className="text-primary-600" />
                    Dependants ({dependants.length})
                </span>
            </legend>
            <div className="mt-5 space-y-6">
                {isMarried && dependants.length > 0 && !hasSpouseSelected && (
                    <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-medium">
                        <AlertTriangle size={15} className="shrink-0 text-amber-600" />
                        <span>Enrollee is marked as <strong>Married</strong>. Please designate one of the dependants as the spouse.</span>
                    </div>
                )}

                {dependants.length === 0 ? (
                    <div className="text-center py-6 bg-slate-50/75 rounded-xl border border-dashed border-slate-200">
                        <Users size={32} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-xs font-medium text-slate-500">No dependants recorded for this form</p>
                        {!disabled && (
                            <button
                                type="button"
                                onClick={onAddDependant}
                                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                            >
                                <Plus size={13} /> Add Dependant
                            </button>
                        )}
                    </div>
                ) : (
                    dependants.map((dpd, idx) => {
                        const currentLga = dpd.lga_no || principalFields.lga_no || "";
                        const availableFacilities = (currentLga && lgaFacilitiesMap[currentLga])
                            ? lgaFacilitiesMap[currentLga]
                            : facilities.filter((f) => !currentLga || f.lga_id === Number(currentLga) || f.lga_no === Number(currentLga));

                        const effectivePhone = dpd.phone_number || principalFields.phone_number || "";
                        const effectiveFacility = dpd.facility_no || (currentLga === principalFields.lga_no ? principalFields.facility_no : "") || "";

                        const nameMissing = showValidationErrors && !dpd.name?.trim();
                        const dobMissing = showValidationErrors && !dpd.dob;
                        const genderMissing = showValidationErrors && !dpd.gender;
                        const phoneMissing = showValidationErrors && !effectivePhone;
                        const lgaMissing = showValidationErrors && !currentLga;
                        const facilityMissing = showValidationErrors && !effectiveFacility;

                        const handleLgaChange = async (val) => {
                            const newLga = val === "" ? "" : Number(val);
                            onUpdateDependant(idx, "lga_no", newLga);
                            if (newLga) {
                                const facList = await loadFacilitiesForLga(newLga);
                                if (facList && facList.length > 0) {
                                    // Auto-populate: match principal's facility if in this LGA, else pick first facility
                                    const matchPrincipal = facList.find((f) => f.id === Number(principalFields.facility_no));
                                    const autoFacility = matchPrincipal ? matchPrincipal.id : facList[0].id;
                                    onUpdateDependant(idx, "facility_no", autoFacility);
                                } else {
                                    onUpdateDependant(idx, "facility_no", "");
                                }
                            } else {
                                onUpdateDependant(idx, "facility_no", "");
                            }
                        };

                        const dpdAge = getAgeFromDob(dpd.dob);
                        const isChildOverAge = !dpd.is_spouse && dpdAge !== null && dpdAge > 18;

                        return (
                            <div key={dpd.id || idx} className={`rounded-xl border p-4 relative space-y-4 transition-all ${
                                isChildOverAge
                                    ? "border-rose-300 bg-rose-50/40 shadow-sm"
                                    : dpd.is_spouse
                                    ? "border-rose-200 bg-rose-50/20 shadow-sm"
                                    : "border-slate-200 bg-slate-50/40"
                            }`}>
                                <div className="flex items-center justify-between pb-2 border-b border-slate-200/70">
                                    <div className="flex items-center gap-2">
                                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold ${
                                            isChildOverAge
                                                ? "bg-rose-100 text-rose-700"
                                                : dpd.is_spouse
                                                ? "bg-rose-100 text-rose-700"
                                                : "bg-primary-100 text-primary-700"
                                        }`}>
                                            {dpd.sequence || idx + 1}
                                        </span>
                                        <span className="text-xs font-bold text-slate-700">
                                            {dpd.name || `Dependant #${dpd.sequence || idx + 1}`}
                                        </span>
                                        {dpd.is_spouse && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                                                Spouse
                                            </span>
                                        )}
                                        {isChildOverAge && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-300">
                                                Over 18 ({dpdAge} yrs)
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isMarried && (
                                            <label className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                                                dpd.is_spouse
                                                    ? "bg-rose-100 text-rose-800 font-semibold border border-rose-300"
                                                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                                            } ${disabled ? "pointer-events-none opacity-60" : ""}`}>
                                                <input
                                                    type="radio"
                                                    name={`spouse_selection_${dpd.id || idx}`}
                                                    checked={!!dpd.is_spouse}
                                                    onChange={() => onSelectSpouse && onSelectSpouse(idx)}
                                                    disabled={disabled}
                                                    className="text-rose-600 focus:ring-rose-500 w-3 h-3"
                                                />
                                                <span>{dpd.is_spouse ? "Selected Spouse" : "Select as Spouse"}</span>
                                            </label>
                                        )}
                                        {!disabled && (
                                            <button
                                                type="button"
                                                onClick={() => onRemoveDependant(idx)}
                                                title="Remove dependant"
                                                className="text-slate-400 hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {isChildOverAge && (
                                    <div className="flex items-center gap-2 p-2.5 bg-rose-100/70 border border-rose-300 text-rose-800 rounded-lg text-xs font-medium">
                                        <AlertTriangle size={15} className="shrink-0 text-rose-600" />
                                        <span>Child is older than minimum age req ({dpdAge} years old). This dependant will be deleted upon updating/saving the form and will not be enrolled.</span>
                                    </div>
                                )}

                                <div className="flex flex-col sm:flex-row gap-5">
                                    {/* Passport Box */}
                                    <div className="flex flex-col items-center shrink-0 w-28">
                                        <div className="w-28 h-36 rounded-xl border-2 border-dashed border-slate-200 bg-white flex items-center justify-center overflow-hidden shadow-sm">
                                            <DependantPassportPreview
                                                imgSrc={displaySrc}
                                                passportPath={dpd.passport_path}
                                                passportPreview={dpd.passport_preview}
                                                coords={dpd.passport_coord}
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1.5 w-full mt-2.5">
                                            <button
                                                type="button"
                                                disabled={disabled || !displaySrc}
                                                onClick={() => onRecrop(idx)}
                                                className="bg-white text-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold hover:bg-slate-100 transition-all disabled:opacity-40 flex items-center justify-center gap-1 border border-slate-200 shadow-sm w-full"
                                            >
                                                <Crop size={12} /> Crop Photo
                                            </button>
                                            <label className={`bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all flex items-center justify-center gap-1 w-full shadow-sm cursor-pointer ${
                                                disabled ? "opacity-40 pointer-events-none" : ""
                                            }`}>
                                                <Upload size={12} /> Upload Photo
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    disabled={disabled}
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            const reader = new FileReader();
                                                            reader.onload = (event) => {
                                                                const b64 = event.target.result;
                                                                onUpdateDependant(idx, "passport_preview", b64);
                                                                onUpdateDependant(idx, "passport_base64", b64);
                                                                onUpdateDependant(idx, "passport_coord", { xmin: 0, ymin: 0, xmax: 0, ymax: 0 });
                                                            };
                                                            reader.readAsDataURL(file);
                                                        }
                                                    }}
                                                />
                                            </label>
                                        </div>
                                    </div>

                                    {/* Dependant Fields */}
                                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="col-span-1 sm:col-span-2">
                                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                                Full Name <span className="text-red-500 font-bold">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={dpd.name || ""}
                                                onChange={(e) => onUpdateDependant(idx, "name", e.target.value)}
                                                disabled={disabled}
                                                placeholder="Dependant full name"
                                                className={`w-full rounded-lg border bg-white px-3 py-2 text-xs input-focus disabled:bg-slate-100 ${
                                                    nameMissing ? "border-red-400 focus:ring-red-400" : "border-slate-200"
                                                }`}
                                            />
                                            {nameMissing && <span className="text-[10px] text-red-500 mt-1 block font-medium">Full name is required</span>}
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                                Date of Birth <span className="text-red-500 font-bold">*</span>
                                            </label>
                                            <input
                                                type="date"
                                                value={dobToISO(dpd.dob) || ""}
                                                onChange={(e) => onUpdateDependant(idx, "dob", e.target.value)}
                                                disabled={disabled}
                                                className={`w-full rounded-lg border bg-white px-3 py-2 text-xs input-focus disabled:bg-slate-100 ${
                                                    dobMissing ? "border-red-400 focus:ring-red-400" : "border-slate-200"
                                                }`}
                                            />
                                            {dobMissing && <span className="text-[10px] text-red-500 mt-1 block font-medium">Date of birth is required</span>}
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                                Gender <span className="text-red-500 font-bold">*</span>
                                            </label>
                                            <select
                                                value={dpd.gender || ""}
                                                onChange={(e) => onUpdateDependant(idx, "gender", e.target.value)}
                                                disabled={disabled}
                                                className={`w-full rounded-lg border bg-white px-3 py-2 text-xs input-focus disabled:bg-slate-100 ${
                                                    genderMissing ? "border-red-400 focus:ring-red-400" : "border-slate-200"
                                                }`}
                                            >
                                                <option value="">— Select Gender —</option>
                                                <option value="Male">Male</option>
                                                <option value="Female">Female</option>
                                            </select>
                                            {genderMissing && <span className="text-[10px] text-red-500 mt-1 block font-medium">Gender is required</span>}
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                                Phone Number <span className="text-red-500 font-bold">*</span>
                                            </label>
                                            <input
                                                type="tel"
                                                value={dpd.phone_number ?? ""}
                                                onChange={(e) => onUpdateDependant(idx, "phone_number", e.target.value)}
                                                disabled={disabled}
                                                placeholder={principalFields.phone_number ? `Default: ${principalFields.phone_number}` : "Phone number"}
                                                className={`w-full rounded-lg border bg-white px-3 py-2 text-xs input-focus disabled:bg-slate-100 ${
                                                    phoneMissing ? "border-red-400 focus:ring-red-400" : "border-slate-200"
                                                }`}
                                            />
                                            {phoneMissing && <span className="text-[10px] text-red-500 mt-1 block font-medium">Phone number is required</span>}
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                                Preferred LGA <span className="text-red-500 font-bold">*</span>
                                            </label>
                                            <select
                                                value={dpd.lga_no || principalFields.lga_no || ""}
                                                onChange={(e) => handleLgaChange(e.target.value)}
                                                disabled={disabled}
                                                className={`w-full rounded-lg border bg-white px-3 py-2 text-xs input-focus disabled:bg-slate-100 ${
                                                    lgaMissing ? "border-red-400 focus:ring-red-400" : "border-slate-200"
                                                }`}
                                            >
                                                <option value="">Select LGA</option>
                                                {lgas.map((l) => (
                                                    <option key={l.id} value={l.id}>{l.name}</option>
                                                ))}
                                            </select>
                                            {lgaMissing && <span className="text-[10px] text-red-500 mt-1 block font-medium">Preferred LGA is required</span>}
                                        </div>

                                        <div className="col-span-1 sm:col-span-2">
                                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                                Preferred Facility <span className="text-red-500 font-bold">*</span>
                                            </label>
                                            <select
                                                value={dpd.facility_no || (currentLga === principalFields.lga_no ? principalFields.facility_no : "") || ""}
                                                onChange={(e) => onUpdateDependant(idx, "facility_no", Number(e.target.value) || "")}
                                                disabled={disabled}
                                                className={`w-full rounded-lg border bg-white px-3 py-2 text-xs input-focus disabled:bg-slate-100 ${
                                                    facilityMissing ? "border-red-400 focus:ring-red-400" : "border-slate-200"
                                                }`}
                                            >
                                                <option value="">Select Facility</option>
                                                {availableFacilities.map((f) => (
                                                    <option key={f.id} value={f.id}>{f.name}</option>
                                                ))}
                                            </select>
                                            {facilityMissing && <span className="text-[10px] text-red-500 mt-1 block font-medium">Preferred facility is required</span>}
                                        </div>

                                        <div className="col-span-1 sm:col-span-2">
                                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Medical History / Condition</label>
                                            <input
                                                type="text"
                                                value={dpd.medical_history || ""}
                                                onChange={(e) => onUpdateDependant(idx, "medical_history", e.target.value)}
                                                disabled={disabled}
                                                placeholder="e.g. None, Hypertension, Allergies"
                                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs input-focus disabled:bg-slate-100"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}

                {!disabled && dependants.length > 0 && dependants.length < 10 && (
                    <button
                        type="button"
                        onClick={onAddDependant}
                        className="w-full py-2.5 rounded-xl border border-dashed border-primary-300 text-primary-600 bg-primary-50/40 hover:bg-primary-50 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                    >
                        <Plus size={14} /> Add Another Dependant
                    </button>
                )}
            </div>
        </fieldset>
    );
}
