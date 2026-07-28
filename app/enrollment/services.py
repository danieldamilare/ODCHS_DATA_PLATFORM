from app import db
from app.enrollment.models import Form, Batch, FormStatus, BatchStatus
from flask import current_app
from app.enrollment.utils import compute_hash, is_image_extension
from app.enrollment.dataloader import get_loader
from app.enrollment.tasks import extract_zip_for_processing
from werkzeug.datastructures import FileStorage
from app.enrollment.image_processing import read_image
from enum import Enum, auto
from app import kv
import sqlalchemy as sa
from typing import Optional, Literal, Dict
from dataclasses import dataclass
import uuid
import os
import zipfile
import cv2
import base64
from datetime import datetime


@dataclass
class BatchJobResult:
    status: Literal["created", "duplicate", "save_failed", "empty_zip"]
    batch: Optional[Batch] = None


class BatchServices:
    def create_job(
        self, lga_no, ward_no, facility_no, file: FileStorage
    ) -> BatchJobResult:
        loader = get_loader()
        file_hash = compute_hash(file)
        batch = db.session.scalar(sa.select(Batch).where(Batch.zip_hash == file_hash))

        if batch:
            return BatchJobResult(status="duplicate", batch=batch)

        batch_id = str(uuid.uuid4())
        form_base_folder = current_app.config["FORM_PATH"]
        os.makedirs(form_base_folder, exist_ok=True)
        images = []
        file.stream.seek(0)
        with zipfile.ZipFile(file.stream) as zf:
            images = [
                f
                for f in zf.infolist()
                if not f.is_dir() and is_image_extension(f.filename)
            ]
        if not images:
            return BatchJobResult(status="empty_zip")

        file.seek(0)
        path = os.path.join(form_base_folder, f"{batch_id}.zip")
        passport_path = os.path.join(current_app.config["PASSPORT_PATH"], batch_id)

        try:
            file.save(path)
            os.makedirs(passport_path, exist_ok=True)
        except OSError:
            return BatchJobResult(status="save_failed")

        batch = Batch(
            uuid=batch_id,
            status=BatchStatus.PROCESSING,
            lga_no=lga_no,
            state_code=loader.state_code,
            plan_id=loader.plan_id,
            ward_no=ward_no,
            facility_no=facility_no,
            zip_hash=file_hash,
            total=len(images),
        )

        db.session.add(batch)
        try:
            db.session.commit()
        except sa.exc.IntegrityError:
            db.session.rollback()
            os.remove(path)
            existing = db.session.scalar(
                sa.select(Batch).where(Batch.zip_hash == file_hash)
            )
            return BatchJobResult(status="duplicate", batch=existing)

        kv.hset(
            f"batch:{batch.uuid}",
            mapping={
                "status": "extracting",
                "total": len(images),
                "done": 0,
                "remaining": len(images),
            },
        )
        extract_zip_for_processing.delay(path, batch_id)
        return BatchJobResult(status="created", batch=batch)

    def get_breakdown_stat(self, batch_id) -> Dict:
        batch: Optional[Batch] = db.session.scalar(
            sa.select(Batch).where(Batch.uuid == batch_id)
        )

        if not batch:
            return {}

        summary_stmt = (
            sa.select(Form.status, sa.func.count(Form.id))
            .where(Form.batch_id == batch.id)
            .group_by(Form.status)
        )

        current_resp = batch.to_dict()
        current_resp["summary"] = {
            "ready": 0,
            "enrolled": 0,
            "failed": 0,
            "need_rescan": 0,
            "error": 0,
            "rejected": 0,
        }

        result = db.session.execute(summary_stmt).all()
        for status, count in result:
            status_name = status.value if hasattr(status, "value") else str(status)
            current_resp["summary"][status_name] = count
        return current_resp

    def get(self, batch_id) -> Optional[Batch]:
        batch: Optional[Batch] = db.session.scalar(
            sa.select(Batch).where(Batch.uuid == batch_id)
        )
        return batch


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
