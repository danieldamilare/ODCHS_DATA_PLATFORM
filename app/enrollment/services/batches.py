from app import db
from app.enrollment.models import Form, Batch, FormStatus, BatchStatus
from flask import current_app
from app.enrollment.utils import compute_hash, is_image_extension
from app.enrollment.dataloader import get_loader
from app.enrollment.tasks import extract_zip_for_processing
from werkzeug.datastructures import FileStorage
from app import kv
from stat import S_IFREG
import sqlalchemy as sa
from typing import Optional, Literal, Dict, Generator, Tuple
from dataclasses import dataclass
import uuid
import os
import zipfile
from datetime import datetime
from stream_zip import stream_zip, ZIP_32


@dataclass
class BatchJobResult:
    status: Literal["created", "duplicate", "save_failed", "empty_zip"]
    batch: Optional[Batch] = None


@dataclass
class BatchDownloadResult:
    status: Literal["404", "invalid", "success"]
    msg: Optional[str]
    generator: Optional[Generator[Tuple, None, None]] = None
    filename: Optional[str] = None


@dataclass
class BatchIdCardJobResult:
    status: Literal[""]
    msg: Optional[str]


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

    def download_forms(
        self, batch_id: str, status: Optional[str] = None
    ) -> BatchDownloadResult:
        batch = self.get(batch_id)
        if not batch:
            return BatchDownloadResult("404", "No batch exists with the given id")
        select_stmt = sa.select(Form).where(Form.batch_id == batch.id)
        if status:
            try:
                select_stmt = select_stmt.where(Form.status == FormStatus(status))
            except ValueError:
                return BatchDownloadResult(
                    "invalid", msg=f"Invalid status filter: {status}"
                )

        result = db.session.scalars(select_stmt).all()
        if not result:
            return BatchDownloadResult("404", msg="No forms in the given batch")

        forms = []
        for form in result:
            forms.append(
                (
                    form.uuid,
                    form.firstname,
                    form.othername,
                    form.surname,
                    form.img_path,
                    form.sequence,
                )
            )

        def yield_files():
            for uuid, firstname, othername, surname, img_path, sequence in forms:
                if not img_path or not os.path.exists(img_path):
                    continue  # should be impossible but defensive programming
                file_name = firstname or ""
                if othername:
                    file_name += ("_" if file_name else "") + othername
                if surname:
                    file_name += ("_" if file_name else "") + surname
                if not file_name:
                    file_name = uuid
                file_name += f"_{sequence}"
                file_name += os.path.splitext(img_path)[1]
                modified_at = datetime.now()
                mode = S_IFREG | 0o666

                def read_file_chunks(img_path=img_path):
                    with open(img_path, "rb") as f:
                        while chunk := f.read(65536):
                            yield chunk

                yield (file_name, modified_at, mode, ZIP_32, read_file_chunks())

        stream_generator = stream_zip(yield_files())
        return BatchDownloadResult(
            "success", generator=stream_generator, msg="", filename=f"{batch_id}.zip"
        )
