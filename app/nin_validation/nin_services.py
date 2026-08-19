from app.nin_validation.nin_client import load_nin_client
from app.nin_validation.schema import NINBatchValidator
from app.nin_validation.utils import get_dataset_type
from app.nin_validation.tasks import process_nin_batch_validation
from app.nin_validation.keys import NINKeys
from typing import Tuple, Literal, Optional, Dict, Any
from datetime import date
from app import kv
import threading
from werkzeug.utils import secure_filename
import os
import uuid
from flask import current_app
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

        if kv.exists(checksum):
            job_id = kv.get(checksum)
            return NINBatchResult(
                "duplicate", "You already submitted this document", job_id
            )

        data_type = get_dataset_type(file)
        dir_path = current_app.config["SCRATCH_FILE_PATH"]
        file_name = secure_filename(file.filename)

        try:
            if data_type != ".csv":
                df = pd.read_excel(file.stream, engine="calamine", dtype=str)
                name = os.path.splitext(file_name)[0]
                new_path = os.path.join(dir_path, name) + ".csv"
                df.to_csv(new_path, index=False)
            else:
                new_path = os.path.join(dir_path, file_name)
                file.save(new_path)
        except OSError:
            return NINBatchResult("save_error", "Error occured while saving your file")

        gen_id = str(uuid.uuid4())
        job_id = NINKeys.get_job_key(gen_id)

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
            mapping.update({"generate_report": "true"})

        kv.hset(job_id, mapping=mapping)
        process_nin_batch_validation.delay(gen_id)

        return NINBatchResult(
            "success", "NIN Batch Validation Job has successfully started", gen_id
        )

    def get_batch_status(self, job_id: str, with_stream=False):
        real_id = NINKeys.get_job_key(job_id)
        payload = kv.hgetall(real_id)
        if not payload:
            return None

        new_payload = {}
        new_payload["status"] = payload.get("status")
        new_payload["completed"] = payload.get("completed")
        new_payload["total"] = payload.get("total")
        new_payload["aggregate"] = True if payload.get("aggregate") else False
        new_payload["generate_report"] = payload.get("generate_report")
        if payload.get("status") != "done" and with_stream:
            new_payload["channel"] = NINKeys.get_job_channel(job_id)
        return new_payload

    def get_file_path(self, job_id: str, file_type: str) -> Tuple[bool, Tuple[str, str]]:
        if not file_type:
            return False, ("", "Please select a download type")

        payload = self.get_batch_status(job_id)
        if not payload or payload.get("status") != "done":
            return False, ("", "You either didn't submit any job with this id or the job is still being processed")

        clean_id = NINKeys.clean_id(job_id)
        mapping = {
            "result": ("csv_result_path", f"nin_result_{clean_id}.csv", None),
            "breakdown": (
                "csv_breakdown_result_path",
                f"nin_breakdown_{clean_id}.zip",
                "You didn't generate a breakdown for this job",
            ),
            "report": (
                "pdf_result_path",
                f"nin_report_{clean_id}.pdf",
                "You didn't generate a report for this job",
            ),
        }

        if file_type not in mapping:
            return False, ("", "Invalid selected type")

        field, download_filename, not_generated_msg = mapping[file_type]
        if not_generated_msg and not payload.get(
            "aggregate" if file_type == "breakdown" else "generate_report"
        ):
            return False, ("", not_generated_msg)

        real_id = NINKeys.get_job_key(job_id)
        download_path = kv.hget(real_id, field)
        if not download_path or not os.path.exists(download_path):
            return False, ("", "Requested file is not available on the server")

        return True, (download_path, download_filename)