from app import db
from app.enrollment.models import Form, FormStatus, Dependants
from flask import current_app
from app.enrollment.dataloader import get_loader
from werkzeug.datastructures import FileStorage
from app.enrollment.image_processing import read_image, rotate_image
from app.enrollment.schema import FormUpdater
from app.enrollment.his_client import HISClient, HISEnrollStatus
from app.enrollment.idcard.generator import IdCardGenerator
from app.enrollment.utils import generate_id_card_path
from pydantic import ValidationError
from app.core.utils import serialize_validation_errors
from enum import Enum, auto
import sqlalchemy as sa
from typing import Optional, Literal
from dataclasses import dataclass
import os
import cv2
import base64
from datetime import datetime
from dateutil import parser


@dataclass
class FormPassportUpdateResult:
    success: bool
    msg: str


class FormEnrollmentState(Enum):
    NOT_EXISTS = auto()
    HIS_ERROR = auto()
    NO_PASSPORT_ERROR = auto()
    HIS_DUPLICATE = auto()
    ALREADY_ENROLLED = auto()
    SUCCESS = auto()
    VALIDATION_ERROR = auto()


@dataclass
class FormEnrollmentResult:
    status: FormEnrollmentState
    msg: str


@dataclass
class FormUpdateResult:
    status: Literal["rotate_error", "db_error", "success", "invalid"]
    msg: str
    form: Optional[Form] = None


@dataclass
class FormIdCardResult:
    status: Literal["invalid", "success", "not_enrolled", "failed"]
    msg: str
    file: Optional[str] = None
    filename: Optional[str] = None


class FormServices:
    def __init__(self, his_client=None):
        self.his_client = his_client or HISClient()

    def get(self, form_id) -> Optional[Form]:
        form: Form = db.session.scalar(sa.select(Form).where(Form.uuid == form_id))
        return form

    def update_passport(self, file: FileStorage, form: Form):
        passport_path = os.path.join(
            current_app.config["PASSPORT_PATH"], form.batch.uuid
        )
        os.makedirs(passport_path, exist_ok=True)
        path = os.path.join(
            passport_path, f"{form.uuid}{os.path.splitext(file.filename)[1]}"
        )
        try:
            file.stream.seek(0)
            file.save(path)
        except OSError:
            return FormPassportUpdateResult(
                False, "Failed to save uploaded passport. Please try again"
            )
        try:
            form.passport_path = path
            db.session.add(form)
            db.session.commit()
        except Exception:
            db.session.rollback()
            return FormPassportUpdateResult(
                False, "Error saving passport to form database"
            )
        return FormPassportUpdateResult(True, "Successfully update passport")

    def _get_passport_base64(self, form) -> str:
        has_coords = form.passport_xmax is not None and form.passport_xmax > 0

        if not form.passport_path and not has_coords:
            raise ValueError(
                "Refusing to enroll form without passport",
            )
        else:
            if form.passport_path:
                img = read_image(form.passport_path)
            else:
                img = read_image(form.img_path)
                img = img[
                    form.passport_ymin : form.passport_ymax,
                    form.passport_xmin : form.passport_xmax,
                ]
            _, buf = cv2.imencode(".jpg", img)
            b64_passport = base64.b64encode(buf).decode("utf-8")
            return b64_passport

    def _build_payload_from_form(self, form, loader, b64_passport) -> dict:
        plan_id = loader.get_plan_id(form.scheme)
        dependants_list = []
        for dpd in form.dependants:
            # Rule: non-spouse dependants older than 18 are not eligible as child dependants
            if not dpd.is_spouse and dpd.dpd_dob:
                try:
                    b_date = parser.parse(dpd.dpd_dob, dayfirst=False).date()
                    today = datetime.utcnow().date()
                    age = today.year - b_date.year - ((today.month, today.day) < (b_date.month, b_date.day))
                    if age > 18:
                        continue
                except Exception:
                    pass

            dpd_b64 = ""
            try:
                if dpd.passport_path:
                    img = read_image(dpd.passport_path)
                    _, buf = cv2.imencode(".jpg", img)
                    dpd_b64 = base64.b64encode(buf).decode("utf-8")
                elif dpd.passport_xmax and dpd.passport_xmax > 0:
                    img = read_image(form.img_path)
                    cropped = img[
                        dpd.passport_ymin : dpd.passport_ymax,
                        dpd.passport_xmin : dpd.passport_xmax,
                    ]
                    _, buf = cv2.imencode(".jpg", cropped)
                    dpd_b64 = base64.b64encode(buf).decode("utf-8")
            except Exception:
                dpd_b64 = ""

            dependants_list.append({
                "name": dpd.dpd_name or "",
                "dob": dpd.dpd_dob or "",
                "gender": dpd.dpd_gender or "",
                "phone_number": dpd.dpd_phone_number or "",
                "lga_no": dpd.dpd_lga_no or form.lga_no,
                "facility_no": dpd.dpd_facility_no or form.facility_no,
                "medical_history": dpd.dpd_medical_history or "",
                "is_spouse": bool(dpd.is_spouse),
                "b64_passport": dpd_b64,
            })

        return {
            "title": form.title or "",
            "surname": form.surname or "",
            "first_name": form.firstname or "",
            "other_name": form.othername or "",
            "phone_number": form.phone_number or "",
            "dob": form.dob or "",
            "address": form.address or "",
            "state_id": str(loader.state_code),
            "lga": form.lga_no,
            "b64_passport": b64_passport,
            "marital_status": form.marital_status or "Single",
            "plan_id": plan_id,
            "gender": form.gender,
            "category": form.category,
            "origin_lga": loader.reverse_lga.get(str(form.lga_no), ""),
            "ward": form.ward_no,
            "facility": form.facility_no,
            "nin": form.nin or "",
            "settlement": form.settlement or "",
            "dependants": dependants_list,
            "employment_id": form.enployment_id,
            "next_of_kin": {
                "first_name": form.kin_firstname or "",
                "surname": form.kin_surname or "",
                "other_name": form.kin_othername or "",
                "relationship": form.kin_relationship or "",
                "phone_number": form.kin_phone_number or "",
                "address": form.kin_address or "",
            },
        }

    def run_validation_on_form(self, form: Form):

        vals = {
            "title": form.title,
            "surname": form.surname,
            "firstname": form.firstname,
            "othername": form.othername,
            "dob": form.dob,
            "settlement": form.settlement,
            "gender": form.gender,
            "phone_number": form.phone_number,
            "nin": form.nin,
            "address": form.address,
            "category": form.category,
            "marital_status": form.marital_status,
            "occupation": form.occupation,
            "kin_firstname": form.kin_firstname,
            "kin_surname": form.kin_surname,
            "kin_othername": form.kin_othername,
            "kin_relationship": form.kin_relationship,
            "kin_phone_number": form.kin_phone_number,
            "kin_address": form.kin_address,
            "lga_no": form.lga_no,
            "ward_no": form.ward_no,
            "facility_no": form.facility_no,
            "scheme": form.scheme,
        }

        try:
            FormUpdater.model_validate(vals)
        except ValidationError as e:
            print(str(e))
            return False, serialize_validation_errors(e)
        return True, ""



    def enroll(self, form_id):

        form = self.get(form_id)
        if not form:
            return FormEnrollmentResult(
                FormEnrollmentState.NOT_EXISTS, "No form with the given id"
            )
        if form.status == FormStatus.ENROLLED:
            return FormEnrollmentResult(
                FormEnrollmentState.ALREADY_ENROLLED,
                "You have already enrolled this form before",
            )
        success, err = self.run_validation_on_form(form)

        if not success:
            return FormEnrollmentResult(
                FormEnrollmentState.VALIDATION_ERROR,
                err
            )

        try: 
            b64_passport = self._get_passport_base64(form)
        except ValueError as e:
            return FormEnrollmentResult(FormEnrollmentState.NO_PASSPORT_ERROR, str(e))
        loader = get_loader()

        payload = self._build_payload_from_form(form, loader, b64_passport)

        result = self.his_client.create_enrollee(payload)

        if result.status == HISEnrollStatus.CREATED:
            form.status = FormStatus.ENROLLED
            form.enrolled_at = datetime.utcnow()
            if result.payload and result.payload.get("enrolleeNo"):
                form.enrollee_number = result.payload.get("enrolleeNo")

        elif result.status == HISEnrollStatus.ALREADY_EXISTS:
            form.status = FormStatus.ALREADY_EXIST
        else:
            form.status = FormStatus.FAILED
            form.error_message = result.message

        try:
            db.session.commit()

        except Exception:
            return FormEnrollmentResult(
                FormEnrollmentState.HIS_ERROR, "Failed saving enrollment result."
            )

        state = (
            FormEnrollmentState.SUCCESS
            if result.success
            else FormEnrollmentState.HIS_ERROR
        )

        if result.status == HISEnrollStatus.ALREADY_EXISTS:
            state = FormEnrollmentState.HIS_DUPLICATE

        return FormEnrollmentResult(state, result.message)

    def update_form(self, form_id, updater: FormUpdater):
        form = db.session.scalar(sa.select(Form).where(Form.uuid == form_id))
        if not form:
            return FormUpdateResult("invalid", "No form with the given id")
        if  form.status == FormStatus.ENROLLED:
            return FormUpdateResult(
                "invalid", "You cannot update a form that has been enrolled"
            )

        for key, value in updater.get_updates().items():
            if key in form.UPDATABLE_FIELDS:
                setattr(form, key, value)

        if updater.dependants is not None:
            # Rule: Filter out any non-spouse dependants older than 18 years
            valid_dependants_data = []
            for d in updater.dependants:
                is_spouse = bool(d.get("is_spouse", False))
                dob_str = d.get("dob")
                if not is_spouse and dob_str:
                    try:
                        b_date = parser.parse(dob_str, dayfirst=False).date()
                        today = datetime.utcnow().date()
                        age = today.year - b_date.year - ((today.month, today.day) < (b_date.month, b_date.day))
                        if age > 18:
                            continue
                    except Exception:
                        pass
                valid_dependants_data.append(d)

            kept_dpd_uuids = set()
            for idx, dpd_data in enumerate(valid_dependants_data):
                dpd_id = dpd_data.get("id") or dpd_data.get("uuid")
                dpd_seq = dpd_data.get("sequence", idx + 1)
                dpd = None
                if dpd_id:
                    dpd = next((d for d in form.dependants if d.uuid == dpd_id), None)
                elif dpd_seq is not None:
                    dpd = next((d for d in form.dependants if d.sequence == dpd_seq), None)

                if dpd:
                    kept_dpd_uuids.add(dpd.uuid)
                    dpd.sequence = idx + 1
                    if "name" in dpd_data:
                        dpd.dpd_name = dpd_data["name"]
                    if "dob" in dpd_data:
                        dpd.dpd_dob = dpd_data["dob"]
                    if "gender" in dpd_data:
                        dpd.dpd_gender = dpd_data["gender"]
                    dpd.dpd_lga_no = dpd_data.get("lga_no") or form.lga_no
                    dpd.dpd_facility_no = dpd_data.get("facility_no") or form.facility_no
                    dpd.dpd_phone_number = dpd_data.get("phone_number") or form.phone_number or ""
                    if "medical_history" in dpd_data:
                        dpd.dpd_medical_history = dpd_data["medical_history"]
                    if "is_spouse" in dpd_data:
                        dpd.is_spouse = bool(dpd_data["is_spouse"])

                    if dpd_data.get("passport_base64") or dpd_data.get("b64_passport"):
                        raw_b64 = dpd_data.get("passport_base64") or dpd_data.get("b64_passport")
                        if "," in raw_b64:
                            raw_b64 = raw_b64.split(",", 1)[1]
                        try:
                            img_bytes = base64.b64decode(raw_b64)
                            passport_dir = os.path.join(current_app.config["PASSPORT_PATH"], form.batch.uuid)
                            os.makedirs(passport_dir, exist_ok=True)
                            dpd_file_name = f"dpd_{dpd.uuid}.jpg"
                            save_path = os.path.join(passport_dir, dpd_file_name)
                            with open(save_path, "wb") as f:
                                f.write(img_bytes)
                            dpd.passport_path = save_path
                            dpd.passport_xmin = None
                            dpd.passport_ymin = None
                            dpd.passport_xmax = None
                            dpd.passport_ymax = None
                        except Exception as e:
                            print(f"Error saving dependant passport image: {e}")
                    elif "passport_coord" in dpd_data and dpd_data["passport_coord"]:
                        c = dpd_data["passport_coord"]
                        dpd.passport_xmin = c.get("xmin")
                        dpd.passport_ymin = c.get("ymin")
                        dpd.passport_xmax = c.get("xmax")
                        dpd.passport_ymax = c.get("ymax")
                    elif "passport_xmin" in dpd_data:
                        dpd.passport_xmin = dpd_data.get("passport_xmin")
                        dpd.passport_ymin = dpd_data.get("passport_ymin")
                        dpd.passport_xmax = dpd_data.get("passport_xmax")
                        dpd.passport_ymax = dpd_data.get("passport_ymax")
                else:
                    new_dpd = Dependants(
                        form_id=form.uuid,
                        sequence=idx + 1,
                        dpd_name=dpd_data.get("name"),
                        dpd_dob=dpd_data.get("dob"),
                        dpd_gender=dpd_data.get("gender"),
                        dpd_lga_no=dpd_data.get("lga_no") or form.lga_no,
                        dpd_facility_no=dpd_data.get("facility_no") or form.facility_no,
                        dpd_medical_history=dpd_data.get("medical_history"),
                        dpd_phone_number=dpd_data.get("phone_number") or form.phone_number or "",
                        is_spouse=bool(dpd_data.get("is_spouse", False)),
                    )
                    if dpd_data.get("passport_base64") or dpd_data.get("b64_passport"):
                        raw_b64 = dpd_data.get("passport_base64") or dpd_data.get("b64_passport")
                        if "," in raw_b64:
                            raw_b64 = raw_b64.split(",", 1)[1]
                        try:
                            img_bytes = base64.b64decode(raw_b64)
                            passport_dir = os.path.join(current_app.config["PASSPORT_PATH"], form.batch.uuid)
                            os.makedirs(passport_dir, exist_ok=True)
                            dpd_file_name = f"dpd_{new_dpd.uuid}.jpg"
                            save_path = os.path.join(passport_dir, dpd_file_name)
                            with open(save_path, "wb") as f:
                                f.write(img_bytes)
                            new_dpd.passport_path = save_path
                            new_dpd.passport_xmin = None
                            new_dpd.passport_ymin = None
                            new_dpd.passport_xmax = None
                            new_dpd.passport_ymax = None
                        except Exception as e:
                            print(f"Error saving new dependant passport image: {e}")
                    elif "passport_coord" in dpd_data and dpd_data["passport_coord"]:
                        c = dpd_data["passport_coord"]
                        new_dpd.passport_xmin = c.get("xmin")
                        new_dpd.passport_ymin = c.get("ymin")
                        new_dpd.passport_xmax = c.get("xmax")
                        new_dpd.passport_ymax = c.get("ymax")
                    elif "passport_xmin" in dpd_data:
                        new_dpd.passport_xmin = dpd_data.get("passport_xmin")
                        new_dpd.passport_ymin = dpd_data.get("passport_ymin")
                        new_dpd.passport_xmax = dpd_data.get("passport_xmax")
                        new_dpd.passport_ymax = dpd_data.get("passport_ymax")
                    form.dependants.append(new_dpd)
                    db.session.flush()
                    kept_dpd_uuids.add(new_dpd.uuid)

            # Remove any dependants no longer in the valid list
            for dpd in list(form.dependants):
                if dpd.uuid not in kept_dpd_uuids:
                    form.dependants.remove(dpd)
                    db.session.delete(dpd)


        if updater.use_avatar:
            gender = form.gender
            if gender.lower() == "male":
                form.passport_path = current_app.config["MALE_AVATAR_PATH"]
            elif gender.lower() == "female":
                form.passport_path = current_app.config["FEMALE_AVATAR_PATH"]

        if updater.rotate_angle:
            if updater.passport_xmin is None and form.passport_path is None:
                return FormUpdateResult(
                    "rotate_error",
                    "Please set a new passport crop coordinate, cannot use a stale coordinate on a rotated imge",
                )
            try:
                rotate_image(form.img_path, updater.rotate_angle)
            except Exception:
                return FormUpdateResult(
                    "rotate_error", "Unable to update form due to image rotation"
                )
        try:
            db.session.add(form)
            db.session.commit()
            return FormUpdateResult("success", "Successfully update form", form)
        except Exception:
            db.session.rollback()
            return FormUpdateResult("db_error", "Error updating form")

    def download_form_idcard(self, form_id):
        form = self.get(form_id)
        if not form:
            return FormIdCardResult("invalid", "No form exists with the given id")
        if not form.enrollee_number or not form.status == FormStatus.ENROLLED:
            return FormIdCardResult(
                "not_enrolled",
                "You cannot generate ID card for this form. It either has no enrollee number or has not been enrolled. Please check the HIS site",
            )
        path = generate_id_card_path(
            form.uuid, form.firstname, form.othername, form.surname
        )
        if os.path.exists(path):
            return FormIdCardResult("success", "Id successfully generated", path)
        result = self.his_client.fetch_id_details_from_his(form.enrollee_number)
        dir_name = os.path.dirname(path)
        os.makedirs(dir_name, exist_ok=True)

        if not result.success:
            return FormIdCardResult("failed", result.msg)
        id_card_generator = IdCardGenerator(concurrency=1)
        try:
            _, errors = id_card_generator.create_id_card_sync([(path, result.payload)])
        except Exception:
            return FormIdCardResult("failed", "ID card generation failed")
        filename = os.path.basename(path)

        return FormIdCardResult(
            "success", "Successfully Generated Id Card", path, filename
        )
