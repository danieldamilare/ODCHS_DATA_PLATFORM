from dateutil import parser, relativedelta
from datetime import datetime
from app.enrollment.dataloader import get_loader
from typing import Dict, Optional
from app.enrollment.models import Form, Batch
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
    return None


def compute_age(dob) -> int:
    if isinstance(dob, str):
        dob = parser.parse(dob, dayfirst=False).date()
    elif isinstance(dob, datetime):
        dob = dob.date()
    today = datetime.today().date()
    return relativedelta.relativedelta(today, dob).years


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
    form: Form, batch: Batch, res: OCRResponse, coords: Dict
) -> Form:

    flagged_reasons = []

    form.nin = res.nin
    form.gender = res.gender
    form.address = res.address
    form.dob = res.dob
    form.phone_number = normalize_ng_phone(res.phone_number)

    form.lga_no = batch.lga_no
    form.facility_no = batch.facility_no
    form.ward_no = batch.ward_no
    form.surname = res.surname
    form.firstname = res.first_name
    form.othername = res.other_name

    if res.next_of_kin:
        form.kin_firstname = res.next_of_kin.first_name
        form.kin_othername = res.next_of_kin.other_name
        form.kin_relationship = res.next_of_kin.relationship
        form.kin_address = res.next_of_kin.address
        form.kin_phone_number = normalize_ng_phone(res.next_of_kin.phone_number)
        form.kin_surname = res.next_of_kin.surname

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

    category = None
    if dob:
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

    if form.lga_no:
        lga = loader.reverse_lga.get(str(form.lga_no))
        if lga:
            form.settlement = "Urban" if "akure" in lga.strip().lower() else "Rural"

    if not form.nin:
        flagged_reasons.append("No nin provided")
        form.nin_valid = False
    elif not re.match(r"^\d{11}$", str(form.nin).strip()):
        flagged_reasons.append("Nin is not 11 digits or contains non numeric character")
        form.nin_valid = False
        form.nin = None

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

    if coords["x1"] < 0:
        flagged_reasons.append("No passport provided")
    else:
        form.passport_xmin = coords["x1"]
        form.passport_ymin = coords["y1"]
        form.passport_xmax = coords["x2"]
        form.passport_ymax = coords["y2"]

    if category and not form.category:
        flagged_reasons.append(f"Unrecognized category: {category}")

    if not form.gender:
        flagged_reasons.append("Unknown Gender")

    if flagged_reasons:
        form.flagged = True
        form.reason = ";".join(flagged_reasons)

    return form
