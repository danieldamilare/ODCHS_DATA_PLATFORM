from app.nin_validation.nin_client import load_nin_client
from app.nin_validation.schema import NINBatchValidator
from app.nin_validation.utils import get_dataset_type
from app.nin_validation.tasks import process_nin_batch_validation
from typing import Tuple
from datetime import date
from app import kv
import threading
from werkzeug.utils import secure_filename
import os
import uuid
from flask import current_app
from typing import Literal, Optional, Dict, Any
import hashlib
import pandas as pd
from dataclasses import dataclass


@dataclass
class NINBatchResult:
    status: Literal["duplicate", "save_error", "success"]
    msg: str
    job_id: Optional[str] = None


class NINServices:
    def __init__(self):
        self.client = load_nin_client()

    def validate_nin(self, dob: date, nin: str):
        return self.client.validate_nin(dob, nin)

    def warmup(self):
        thr = threading.Thread(target=self.client.refresh_token, daemon=True)
        thr.start()

    def start_batch_validation(self, res: NINBatchValidator):
        file = res.batch_file
        checksum = hashlib.md5(file.read()).hexdigest()
        file.stream.seek(0)

        if kv.exists(checksum):  # ooops you are only allowed one trial a day
            job_id = kv.get(checksum)
            return NINBatchResult(
                "duplicate", "You already submitted this document", job_id
            )

        data_type = get_dataset_type(file)
        dir_path = current_app.config["SCRATCH_FILE_PATH"]
        file_name = secure_filename(file.filename)
        try:

            if data_type != "csv":
                df = pd.read_excel(file.stream)
                name = os.path.splitext(file_name)[0]
                new_path = os.path.join(dir_path, name) + ".csv"
                df.to_csv(new_path)
            else:
                new_path = os.path.join(dir_path, file_name)
                file.save(new_path)
        except OSError:
            return NINBatchResult("save_error", "Error occured while saving your file")
        gen_id = str(uuid.uuid4())
        job_id = "nin:batch:" + gen_id

        kv.set(checksum, gen_id)
        aggregate = None
        if res.aggregate_by_lga_facility:
            aggregate = "facility"
        elif res.aggregate_by_lga_ward:
            aggregate = "ward"
        mapping: Dict[Any, Any] = {
            "checksum": checksum,
            "path": new_path,
            "status": "loading",
            "completed": 0,
        }
        if aggregate:
            mapping.update({"aggregate": aggregate})
        if res.generate_report:
            mapping.update({"generate_report": True})
        kv.hset(
            job_id,
            mapping=mapping,
        )

        process_nin_batch_validation.delay(job_id)
        return NINBatchResult(
            "success", "NIN Batch Validation Job has successfully started", gen_id
        )

    def get_batch_status(self, job_id: str, with_stream=False):
        real_id = "nin:batch:" + job_id
        payload = kv.hgetall(real_id)
        if not payload:
            return None

        new_payload = {}
        new_payload["status"] = payload.get("status")
        new_payload["completed"] = payload.get("completed")
        new_payload["total"] = payload.get("total")
        new_payload["aggregate"] = payload.get("aggregate")
        new_payload["generate_report"] = payload.get("generate_report")
        if payload["status"] != "done" and with_stream:
            new_payload["channel"] = f"channel:{real_id}"
        return new_payload

    def get_file_path(self, job_id, file_type) -> Tuple[bool, Tuple[str, str]]:
        if not file_type:
            return False, ("", "Please select a download type")
        payload = self.get_batch_status(job_id)
        if not payload:
            return False, ("", "You didn't submit any job with this id")

        real_id = f"nin:batch:{job_id}"
        mapping = {
            "result": ("csv_result_path", "nin_result_", None),
            "breakdown": (
                "csv_breakdown_result_path",
                "nin_breakdown_",
                "You didn't generate a breakdown for this job",
            ),
            "report": (
                "pdf_result_path",
                "nin_report_",
                "You didn't generate report for this job",
            ),
        }
        if file_type not in mapping:
            return False, ("", "Invalid selected type")

        field, prefix, not_generated_msg = mapping[file_type]
        if not_generated_msg and not payload.get(
            "aggregate" if file_type == "breakdown" else "generate_report"
        ):
            return False, ("", not_generated_msg)

        download_path = str(kv.hget(real_id, field) or "")
        file_path = os.path.basename(download_path)
        file_path = file_path.removeprefix("nin:batch:")
        if not download_path:
            return False, ("", "Job is still processing, no file available yet")
        return True, (download_path, prefix + file_path)
