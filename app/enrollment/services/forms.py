from app import db
from app.enrollment.models import Form, FormStatus
from flask import current_app
from app.enrollment.dataloader import get_loader
from werkzeug.datastructures import FileStorage
from app.enrollment.image_processing import read_image, rotate_image
from app.enrollment.schema import FormUpdater
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


class FormServices:
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
        except OSError as e:
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

    def enroll(self, form_id):
        from app.enrollment.his_client import create_enrolle_with_retry

        form = self.get(form_id)
        if not form:
            return FormEnrollmentResult(
                FormEnrollmentState.NOT_EXISTS, "No form with the given id"
            )

        has_coords = form.passport_xmax is not None and form.passport_xmax > 0

        if not form.passport_path and not has_coords:
            return FormEnrollmentResult(
                FormEnrollmentState.NO_PASSPORT_ERROR,
                "Refusing to enroll form without passport, check (enroll without passport) to force enrollment",
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

        loader = get_loader()
        payload = {
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

        result = create_enrolle_with_retry(payload)

        if result.success:
            form.status = FormStatus.ENROLLED
            form.enrolled_at = datetime.utcnow()
            if result.payload and result.payload.get("enrolleeNo"):
                form.enrollee_number = result.payload.get("enrolleeNo")
        else:
            form.status = FormStatus.FAILED
            form.error_message = result.msg

        db.session.commit()
        state = (
            FormEnrollmentState.SUCCESS
            if result.success
            else FormEnrollmentState.HIS_ERROR
        )
        if "exists" in result.msg.lower():
            state = FormEnrollmentState.HIS_DUPLICATE
        return FormEnrollmentResult(state, result.msg)

    def update_form(self, form_id, updater: FormUpdater):
        form = db.session.scalar(sa.select(Form).where(Form.uuid == form_id))
        if not form:
            return FormUpdateResult("invalid", "No form with the given id")

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
            except Exception as e:
                return FormUpdateResult(
                    "rotate_error", "Unable to update form due to image rotation"
                )
        try:
            db.session.add(form)
            db.session.commit()
            return FormUpdateResult("success", "Successfully update form", form)
        except Exception as e:
            db.session.rollback()
            return FormUpdateResult("db_error", "Error updating form")
