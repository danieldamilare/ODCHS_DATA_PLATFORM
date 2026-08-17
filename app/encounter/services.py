import uuid
import os
import json
from flask import current_app
from app.encounter.schema import EncounterValidator
from dataclasses import dataclass
from typing import Optional, Dict
from werkzeug.utils import secure_filename
from app import kv
from app.encounter.tasks import start_encounter_process, set_next_state, ORANGHIS_ENCOUNTER_WORKFLOW_STATE, ORANGHIS_REQUIRED_COLUMNS, start_encounter_validation


@dataclass
class EncounterResult:
    success: bool
    msg: Optional[str] = None
    job_id: Optional[str] = None


class EncounterServices:
    def start_encounter_job(self, res: EncounterValidator) -> EncounterResult:
        gen_id = str(uuid.uuid4())
        job_id = f"encounter:{gen_id}"
        path = os.path.join(
            current_app.config["SCRATCH_FILE_PATH"], "encounter", gen_id
        )
        os.makedirs(path, exist_ok=True)
        encounter_file = res.encounter_file
        file_name = secure_filename(str(encounter_file.filename or ""))
        real_path = os.path.join(path, file_name)
        try:
            encounter_file.save(real_path)
        except OSError:
            return EncounterResult(False, "Error occurred while uploading file")
        kv.hset(
            job_id,
            mapping={
                "path": real_path,
                "status": "Starting",
                "encounter_type": res.encounter_type,
            },
        )
        start_encounter_process.delay(job_id)
        return EncounterResult(
            success=True, msg="Successful Started encounter job", job_id=gen_id
        )

    def process_user_answer(self, job_idx: str, job_num:int, json_response: Dict):
        job_id = f"encounter:{job_idx}"

        state = str(kv.hget(job_id, "state") or "")
        current_job = int(kv.get(f"{job_id}:current_job") or 0)

        if current_job != job_num:
           return {"success": False, "msg": "This question is no longer active for this job"}

        if state not in ORANGHIS_ENCOUNTER_WORKFLOW_STATE:
            return {"success": False, "msg": "No pending question for this job"}

        if state == "sheet_verification":
            if json_response.get("state") != "sheet_verification":
                return {"success": False, "msg": "Mistmatch in state, expected sheet_verification"}
            if not json_response.get("sheet_name"):
                return {"success": False, "msg": "Missing sheet_name in response"}
            kv.hset(f"{job_id}:{current_job}:metadata", "sheet_name", str(json_response.get("sheet_name")))
        elif state == "header_row_disambiguation":
            if json_response.get("state") != "header_row_disambiguation":
                return {"success": False, "msg": "Mistmatch in state, expected header_row_disambiguation"}
            required = ORANGHIS_REQUIRED_COLUMNS
            col_mapping = json_response.get("col")
            header_row = json_response.get("header_row")

            if not isinstance(col_mapping, dict) or set(col_mapping.keys()) != required:
                return {"success": False, "msg": f"col must map exactly these keys: {sorted(required)}"}
            if header_row is None:
                return{"success": False, "msg": "header_row is required"}

            kv.hset(f"{job_id}:{current_job}:metadata", mapping={"header_row": header_row, "col": json.dumps(col_mapping)})
        set_next_state(job_id, state)
        start_encounter_validation.delay(job_id)
        return {"success": True, "msg": "Answer processed successfully"}