from app import db
from app.enrollment.models import Form, FormStatus
from flask import current_app
from app.enrollment.dataloader import get_loader
from werkzeug.datastructures import FileStorage
from app.enrollment.image_processing import read_image, rotate_image
from app.enrollment.schema import FormUpdater
from app.enrollment.his_client import HISClient, HISEnrollStatus
from app.enrollment.idcard.generator import IdCardGenerator
from app.enrollment.utils import generate_id_card_path
from enum import Enum, auto
import sqlalchemy as sa
from typing import Optional, Literal
from dataclasses import dataclass
import os
import cv2
import base64
from datetime import datetime


@dataclass
class FormPassportUpdateResult:
    success: bool
    msg: str


class FormEnrollmentState(Enum):
    NOT_EXISTS = auto()
    HIS_ERROR = auto()
    NO_PASSPORT_ERROR = auto()
    HIS_DUPLICATE = auto()
    SUCCESS = auto()


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
        return {
            "title": form.title or "",
            "surname": form.surname or "",
            "first_name": form.firstname or "",
            "other_name": form.othername or "",
            "phone_number": form.phone_number or "",
            "dob": form.dob or "",
            "address": form.address or "",
            "state_id": loader.state_code,
            "lga": form.lga_no,
            "b64_passport": b64_passport,
            "marital_status": form.marital_status,
            "plan_id": loader.plan_id,
            "gender": form.gender,
            "category": form.category,
            "origin_lga": loader.reverse_lga.get(str(form.lga_no), ""),
            "ward": form.ward_no,
            "facility": form.facility_no,
            "nin": form.nin or "",
            "settlement": form.settlement or "",
            "next_of_kin": {
                "first_name": form.kin_firstname or "",
                "surname": form.kin_surname or "",
                "other_name": form.kin_othername or "",
                "relationship": form.kin_relationship or "",
                "phone_number": form.kin_phone_number or "",
                "address": form.kin_address or "",
            },
        }

    def enroll(self, form_id):

        form = self.get(form_id)
        if not form:
            return FormEnrollmentResult(
                FormEnrollmentState.NOT_EXISTS, "No form with the given id"
            )
        if form.status == FormStatus.ENROLLED:
            return FormEnrollmentResult(
                FormEnrollmentState.HIS_DUPLICATE,
                "You have already enrolled this form before",
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
        if (
            form.status == FormStatus.ENROLLED
            or form.status == FormStatus.ALREADY_EXIST
        ):
            return FormUpdateResult(
                "invalid", "You cannot update a form that has been enrolled"
            )

        for key, value in updater.get_updates().items():
            if key in form.UPDATABLE_FIELDS:
                setattr(form, key, value)

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
