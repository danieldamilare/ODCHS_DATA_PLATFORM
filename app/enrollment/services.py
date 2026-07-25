from app import db
from app.enrollment.models import Form, Batch, FormStatus, BatchStatus
from flask import current_app
from app.enrollment.utils import compute_hash
from app.enrollment.dataloader import get_loader
from werkzeug.datastructures import FileStorage
import sqlalchemy as sa
from typing import Tuple
import uuid
import os


class BatchServices:
    def create_job(
        self, lga_no, ward_no, facility_no, file: FileStorage
    ) -> Tuple[Batch, bool]:
        file_hash = compute_hash(file)
        batch = db.session.scalar(sa.select(Batch).where(Batch.zip_hash == file_hash))
        if batch:
            return batch, True
        batch_id = str(uuid.uuid4())
        path = os.path.join(
            str(current_app.config["BASE_DIR"]), "forms", f"{batch_id}.zip"
        )
        loader = get_loader()
        file.save(path)
        batch = Batch(
            uuid=batch_id,
            status=BatchStatus.PROCESSING,
            lga_no=lga_no,
            state_code = loader.state_code,
            plan_id = loader.plan_id,
            ward_no=ward_no,
            facility_no=facility_no,
            zip_hash=file_hash,
        )

        # start job here

        # return to user
        return batch, False
