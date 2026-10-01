from dateutil import parser, relativedelta
import uuid as uuid_tools
from datetime import datetime
from app.enrollment.dataloader import get_loader
from typing import Dict, Optional
from app.enrollment.models import Form, Dependants, ODCHCScheme
from app.enrollment.schema import OCRResponse
import re


def normalize_ng_phone(raw: str) -> Optional[str]:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("234") and len(digits) == 13:
        return f"+{digits}"
    if digits.startswith("0") and len(digits) == 11:
        return f"+234{digits[1:]}"
    if len(digits) == 10 and digits[0] != "0":
        return f"+234{digits}"
    return None


def clean_str(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    cleaned = str(val).strip().title()
    return cleaned if cleaned else None


def compute_age(dob) -> int:
    if isinstance(dob, str):
        dob = parser.parse(dob, dayfirst=False).date()
    elif isinstance(dob, datetime):
        dob = dob.date()
    today = datetime.today().date()
    return relativedelta.relativedelta(today, dob).years


def normalize_category(category: Optional[str]) -> Optional[str]:
    if not category:
        return None
    cat = str(category).lower().strip()

    if "preg" in cat:
        return "PREGNANT WOMEN"
    if "elder" in cat or "65" in cat:
        return "AGED (65 YRS ABOVE)"
    if "child" in cat or "under 5" in cat:
        return "CHILDREN UNDER 5 yEARS"
    if "disab" in cat:
        return "PEOPLE WITH DISABILITIES"
    if "widow" in cat:
        return "WIDOW/WIDOWER"
    return None


def process_category(dob, gender: str, marital_status: str) -> str:
    age = compute_age(dob)
    is_female = (gender or "").strip().lower().startswith("f")
    marital_status = (marital_status or "").strip().lower()
    if age <= 5:
        return "CHILDREN UNDER 5 YEARS"
    if age >= 65:
        return "AGED (65 YRS ABOVE)"
    if marital_status.startswith("widow"):
        return "WIDOW/WIDOWER"
    if 15 <= age <= 49 and is_female:
        return "WOMEN OF REPRODUCTIVE AGE (15-49 YEARS)"
    return "POOR/VULNERABLE/INDIGENT"


def process_title(gender: str, marital_status: str) -> str:
    if (gender or "").strip().lower().startswith("m"):
        return "Mr."
    return "Miss" if (marital_status or "").strip().lower() == "single" else "Mrs."


def normalize_form_object(
    form: Form, batch: Dict, res: OCRResponse, coords: Dict | list
) -> Form:
    print(f"OCR Response: {res}")
    flagged_reasons = []
    coords = order_faces_reading_order(coords) if isinstance(coords, list) else [coords]
    print(f"Co-ordinates of passports: {coords}")

    if not res:
        form.flagged = True
        form.reason = "OCR Extraction failed: Model returned no response"
        form.nin_valid = False
        return form

    is_bhcpf = (
        getattr(form, "scheme", None) == ODCHCScheme.BHCPFP
        or str(getattr(form, "scheme", "")).lower() in ("bhcpfp", "bhcpf", "odchcscheme.bhcpfp")
    )

    form.nin = res.nin
    form.gender = res.gender
    form.address = clean_str(res.address)
    form.occupation = clean_str(res.occupation)
    form.dob = res.dob
    form.phone_number = normalize_ng_phone(res.phone_number)

    form.lga_no = batch["lga_no"]
    form.facility_no = batch["facility_no"]
    form.ward_no = batch["ward_no"]
    form.surname = clean_str(res.surname)
    form.firstname = clean_str(res.first_name)
    form.othername = clean_str(res.other_name)

    if res.next_of_kin:
        form.kin_firstname = clean_str(res.next_of_kin.first_name)

        form.kin_othername = clean_str(res.next_of_kin.other_name)
        form.kin_relationship = clean_str(res.next_of_kin.relationship)

        form.kin_address = clean_str(res.next_of_kin.address)

        form.kin_phone_number = normalize_ng_phone(res.next_of_kin.phone_number)
        form.kin_surname = clean_str(res.next_of_kin.surname)

    title = process_title(
        form.gender, res.marital_status.value if res.marital_status else ""
    )

    form.title = title

    loader = get_loader()

    dob = None
    if form.dob:
        try:
            dob = parser.parse(form.dob, dayfirst=False)
        except (ValueError, OverflowError):
            flagged_reasons.append("Date Format is incorrect, and cannot be parsed")

    category = normalize_category(res.category)
    explicit_category = {"PEOPLE WITH DISABILITIES", "WIDOW/WIDOWER", "PREGNANT WOMEN"}

    if dob:
        if category not in explicit_category:
            category = process_category(
                dob, form.gender, res.marital_status.value if res.marital_status else ""
            )

        form.category = loader.citizen_types.get(category, None)
    else:
            flagged_reasons.append("No date of birth provided cannot determine category")

    if res.marital_status:
        form.marital_status = res.marital_status

    address = form.address
    kin_address = form.kin_address

    if not address:
        form.address = kin_address
    if not kin_address:
        form.kin_address = address

    if not kin_address and not address and form.ward_no:
        address = loader.reverse_ward.get(str(form.ward_no), "")
        form.address = address
        form.kin_address = address

    if not form.kin_relationship:
        form.kin_relationship = "family"

    if not form.kin_firstname and form.kin_othername:
        form.kin_othername, form.kin_firstname = form.kin_firstname, form.kin_othername

    if form.lga_no:
        lga = loader.reverse_lga.get(str(form.lga_no))
        if lga:
            form.settlement = "Urban" if "akure" in lga.strip().lower() else "Rural"

    if not form.nin:
        if is_bhcpf:
            flagged_reasons.append("No nin provided")
            form.nin_valid = False
        else:
            form.nin_valid = True
    elif not re.match(r"^\d{11}$", str(form.nin).strip()):
        flagged_reasons.append("Nin is not 11 digits or contains non numeric character")
        form.nin_valid = False
        form.nin = str(form.nin)[:11]
    else:
        form.nin_valid = True

    phone_number = form.phone_number
    kin_phone_number = form.kin_phone_number
    if not phone_number and not kin_phone_number:
        flagged_reasons.append(
            "No Traceability. Next of kin phone number and enrollee phone number not provided"
        )
    else:
        if not phone_number:
            form.phone_number = kin_phone_number
        elif not kin_phone_number:
            form.kin_phone_number = phone_number

    principal_coords = coords.pop(0)
    if principal_coords["x1"] < 0:
        flagged_reasons.append("No passport provided")
    else:
        form.passport_xmin = principal_coords["x1"]
        form.passport_ymin = principal_coords["y1"]
        form.passport_xmax = principal_coords["x2"]
        form.passport_ymax = principal_coords["y2"]

    if is_bhcpf and category and not form.category:
        flagged_reasons.append(f"Unrecognized category: {category}")

    if not form.gender:
        flagged_reasons.append("Unknown Gender")

    for dpd_res in res.dependants:
        is_spouse = getattr(dpd_res, "is_spouse", False)
        if not is_spouse and dpd_res.dob:
            try:
                dpd_dob_parsed = parser.parse(dpd_res.dob, dayfirst=False)
                today = datetime.utcnow()
                dpd_age = today.year - dpd_dob_parsed.year - ((today.month, today.day) < (dpd_dob_parsed.month, dpd_dob_parsed.day))
                if dpd_age > 18:
                    flagged_reasons.append("child is older than minimum age req")
                    break
            except Exception:
                pass

    if flagged_reasons:
        form.flagged = True
        form.reason = ";".join(flagged_reasons)
    else:
        form.flagged = False
        form.reason = None

    form.department = res.department
    form.employment_id = res.employment_id
    form.present_mda = res.present_mda
    form.cadre = res.cadre
    form.ext_aliment = res.existing_ailment

    for idx, dpd_res in enumerate(res.dependants):
        try:
            dpd_coords = coords[idx]
        except IndexError:
            dpd_coords={
                "x1": 0,
                "y1": 0,
                "x2": 0,
                "y2": 0             
            }

        dpd_record= Dependants(
            uuid=str(uuid_tools.uuid4()),
            dpd_name=dpd_res.name,
            dpd_dob=dpd_res.dob,
            sequence=idx + 1,
            dpd_gender=dpd_res.gender,
            is_spouse=getattr(dpd_res, "is_spouse", False),
            dpd_phone_number=dpd_res.phone_number,
            dpd_medical_history=dpd_res.existing_ailment,
            passport_xmin = dpd_coords["x1"],
            passport_ymin = dpd_coords["y1"],
            passport_xmax = dpd_coords["x2"],
            passport_ymax = dpd_coords["y2"],
        )
        form.dependants.append(dpd_record)
    return form


def order_faces_reading_order(results, row_tolerance_ratio=0.5):
    """
    Reorders detected face crops into reading order: top row first,
    then left-to-right within each row, top-to-bottom across rows.

    `results` is a list of dicts with x1, y1, x2, y2 (as returned by
    generate_crop_dimension_from_face).

    row_tolerance_ratio controls how close two faces' vertical centers
    need to be (relative to average face height) to be considered
    "the same row". Increase if rows are being split incorrectly;
    decrease if separate rows are being merged into one.
    """
    if not results:
        return results

    # Compute center_y, center_x, and height for each face
    enriched = []
    for r in results:
        cy = (r["y1"] + r["y2"]) / 2
        cx = (r["x1"] + r["x2"]) / 2
        height = r["y2"] - r["y1"]
        enriched.append({"data": r, "cy": cy, "cx": cx, "height": height})

    avg_height = sum(f["height"] for f in enriched) / len(enriched)
    row_tolerance = avg_height * row_tolerance_ratio

    # Sort by vertical position first, then cluster into rows
    enriched.sort(key=lambda f: f["cy"])

    rows = []
    current_row = [enriched[0]]
    for face in enriched[1:]:
        if abs(face["cy"] - current_row[-1]["cy"]) <= row_tolerance:
            current_row.append(face)
        else:
            rows.append(current_row)
            current_row = [face]
    rows.append(current_row)

    # Within each row, sort left to right by center_x
    ordered = []
    for row in rows:
        row.sort(key=lambda f: f["cx"])
        ordered.extend(row)

    return [f["data"] for f in ordered]
