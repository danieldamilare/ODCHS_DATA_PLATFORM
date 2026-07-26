from app import db
from app.enrollment.models import Form, Batch, FormStatus, BatchStatus
from flask import current_app
from app.enrollment.utils import compute_hash, is_image_extension
from app.enrollment.dataloader import get_loader
from app.enrollment.tasks import extract_zip_for_processing
from werkzeug.datastructures import FileStorage
from app import kv
import sqlalchemy as sa
from typing import Optional, Literal, Dict
from dataclasses import dataclass
import uuid
import os
import zipfile


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
        form_base_folder = os.path.join(current_app.config["BASE_DIR"], "forms")
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

        try:
            file.save(path)
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
            current_resp["summary"][status] = count
        return current_resp

    def get(self, batch_id) -> Optional[Batch]:
        batch: Optional[Batch] = db.session.scalar(
            sa.select(Batch).where(Batch.uuid == batch_id)
        )
        return batch
