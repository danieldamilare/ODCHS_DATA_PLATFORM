from app import kv
import zipfile
import os
import shutil
from werkzeug.utils import secure_filename
from app import celery_app
import json
import pandas as pd
from typing import Optional, Tuple, Dict
import re
from app import db
import sqlalchemy as sa
from app.encounter.encounter import get_ext, load_clean_dataframe, process_df, save_to_file
from app.encounter.disease_classifier import load_diagnosis_lines, serialize_from_redis_cache
from app.encounter.models import DiagnosisCache
from app.encounter.keys import EncounterKeys
from flask import current_app


class NeedUserInput(Exception):
    def __init__(self, payload: str, msg=""):
        super().__init__(msg)
        self.payload = payload

ORANGHIS_ENCOUNTER_WORKFLOW_STATE = ["sheet_verification", "header_row_disambiguation"]
ORANGHIS_REQUIRED_COLUMNS = {"age", "client name", "diagnosis", "sex", "policy number"}

@celery_app.task(ignore_result=True)
def start_encounter_process(job_id):
    job_key = EncounterKeys.get_job_key(job_id)
    path = str(kv.hget(job_key, "path") or "")
    jobs = EncounterKeys.get_jobs_hash_key(job_id)
    folder = os.path.dirname(path)
    channel = EncounterKeys.get_job_channel(job_id)
    kv.hset(job_key, "status", "extracting")

    if path.endswith(".zip"):
        try:
            with zipfile.ZipFile(path) as zf:
                filelist = [
                    file
                    for file in zf.infolist()
                    if not file.is_dir()
                    and not file.filename.startswith(".")
                    and (
                        os.path.splitext(file.filename)[1].lower()
                        in [".csv", ".xls", ".xlsx", ".ods"]
                    )
                ]
                if not filelist:
                    kv.hset(job_key, "status", "failed")
                    kv.expire(job_key, 60 * 60)
                    kv.publish(
                        channel,
                        json.dumps(
                            {
                                "type": "error",
                                "status": "failed",
                                "message": "No valid spreadsheet files found in zip",
                            }
                        ),
                    )
                    return

                for idx, file in enumerate(filelist, start=1):
                    current_name = file.filename
                    file.filename = secure_filename(os.path.basename(current_name))
                    zf.extract(current_name, folder)
                    file_path = os.path.join(folder, file.filename)
                    kv.hset(jobs, f"job:{idx}", file_path)
        except Exception as e:
            kv.hset(job_key, "status", "failed")
            kv.delete(jobs)
            try:
                shutil.rmtree(folder, ignore_errors=True)
            except Exception:
                pass
            kv.expire(job_key, 60 * 60)
            kv.publish(
                channel,
                json.dumps(
                    {"type": "error", "status": "failed", "message": str(e)}
                ),
            )
            return
    else:
        kv.hset(jobs, "job:1", path)

    status = kv.hget(job_key, "status")
    length = kv.hlen(jobs)

    kv.hset(job_key, "state", get_start_state())
    kv.hset(job_key, mapping={"completed": 0, "total": length})
    files = kv.hgetall(jobs)
    file_list = {int(str(idx).split(":")[1]) : os.path.basename(file) for idx, file in files.items()}
    kv.hset(job_key, "files", json.dumps(file_list))

    kv.publish(
        channel,
        json.dumps(
            {
                "type": "extracting",
                "status": status,
                "total": length,
                "files": file_list
            }
        ),
    )
    kv.hset(job_key, "current_job", "1")
    kv.hset(job_key, "status", "validating")
    start_encounter_validation.delay(job_id)

def get_start_state():
    return "sheet_verification"

def _preview_rows(df: pd.DataFrame) -> list:
    return [
        [
            None if pd.isna(v) 
            else v.isoformat() if hasattr(v, "isoformat") 
            else v
            for v in row
        ]
        for row in df.values.tolist()
    ]

def get_answer_url(job_idx: str, job_num: int):
    job_key=EncounterKeys.clean_id(job_idx)
    return f'/api/{job_key}/{job_num}/answer'

def handle_sheet_verification(job_id):
    job_key = EncounterKeys.get_job_key(job_id)
    channel = EncounterKeys.get_job_channel(job_id)
    current_job = int(kv.hget(job_key, "current_job") or 0)
    jobs = EncounterKeys.get_jobs_hash_key(job_id)
    job_idx = f"job:{current_job}"
    cache_path = EncounterKeys.get_cache_key(job_id, current_job)
    metadata = EncounterKeys.get_metadata_key(job_id, current_job)
    path = str(kv.hget(jobs, job_idx) or "")
    job_key = EncounterKeys.get_job_key(job_id)

    kv.publish(
        channel,
        json.dumps(
            {
                "type": "validating",
                "status": "validating",
                "state": "sheet_verification",
                "job_num": int(kv.hget(job_key, "current_job") or 0),
                "completed": int(kv.hget(job_key, "completed") or 0),
                "file": os.path.basename(path),
                "total": int(kv.hget(EncounterKeys.get_job_key(job_id), "total") or 0),
            }),
    )

    if not path:
        return

    ext = get_ext(path)
    sheet_holder = {}
    if ext == ".csv":
        df = pd.read_csv(path, nrows=20, header=None)
        if not df.empty:
            sheet_value = _preview_rows(df)
            sheet_holder[0] = sheet_value
            kv.hset(cache_path, str(0), json.dumps(sheet_value, default=str))
    else:
        engine = "odf" if ext == ".ods" else "calamine"
        file = pd.ExcelFile(path, engine=engine)
        sheets = file.sheet_names
        for sheet in sheets:
            df = file.parse(sheet, nrows=20, header=None)
            if df.empty:
                continue
            sheet_value = _preview_rows(df)
            kv.hset(cache_path, str(sheet), json.dumps(sheet_value, default=str))
            sheet_holder[sheet] = sheet_value

    
        if not sheet_holder:
            kv.publish(
                channel,
                json.dumps(
                    {
                        "type": "message",
                        "status": "validating",
                        "state": "sheet_verification",
                        "job_num": int(kv.hget(job_key, "current_job") or 0),
                        "file": os.path.basename(path),
                        "total": int(kv.hget(EncounterKeys.get_job_key(job_id), "total") or 0),
                        "message": f"Skipped empty file: {os.path.basename(path)}",
                    }),
            )


    if len(sheet_holder) == 1:
        kv.hset(metadata, "sheet_name", list(sheet_holder.keys())[0])
        return

    payload = {
        "type": "require_user_input",
        "status": "validating",
        "job_num": current_job,
        "total": int(kv.hget(EncounterKeys.get_job_key(job_id), "total") or 0),
        "state": "sheet_verification",
        "data": sheet_holder,
        "answer_url": get_answer_url(job_id, current_job),
    }

    raise NeedUserInput(payload=json.dumps(payload))


def _find_header_row(
    raw_df: pd.DataFrame, needed: set
) -> Optional[Tuple[int, Dict[str, int]]]:
    def _normalise(val) -> str:
        return re.sub(r"[^a-z0-9_]", "", str(val).lower().strip().replace(" ", "_"))

    pos = {}
    for row_idx, (_, row) in enumerate(raw_df.iterrows()):
        normalised_row = [_normalise(v) for v in row.values]
        normalised_set = set(normalised_row)

        if needed.issubset(normalised_set):
            for col_idx, col_name in enumerate(normalised_row):
                if col_name in needed:
                    pos[col_name] = col_idx
            return row_idx, pos
    return None


def handle_row_disambiguation(job_id):
    job_key = EncounterKeys.get_job_key(job_id)
    current_job = int(kv.hget(job_key, "current_job") or 0)
    cache_path = EncounterKeys.get_cache_key(job_id, current_job)
    metadata = EncounterKeys.get_metadata_key(job_id, current_job)
    channel = EncounterKeys.get_job_channel(job_id)
    jobs = EncounterKeys.get_jobs_hash_key(job_id)

    sheet = str(kv.hget(metadata, "sheet_name") or "")
    result = json.loads(str(kv.hget(cache_path, sheet) or ""))
    df = pd.DataFrame(result)
    needed = ORANGHIS_REQUIRED_COLUMNS
    path = str(kv.hget(jobs, f"job:{current_job}") or "")

    kv.publish(
        channel,
        json.dumps(
            {
                "type": "validating",
                "status": "validating",
                "state": "header_row_disambiguation",
                "job_num": int(kv.hget(job_key, "current_job") or 0),
                "completed": int(kv.hget(job_key, "completed") or 0),
                "file": os.path.basename(path),
                "total": int(kv.hget(EncounterKeys.get_job_key(job_id), "total") or 0),
            }),
    )
    res = _find_header_row(df, needed)

    if res:
        header_row, col = res
        kv.hset(metadata, mapping={"header_row": header_row, "col": json.dumps(col)})
        return

    payload = {
        "type": "require_user_input",
        "status": "validating",
        "job_num": current_job,
        "total": int(kv.hget(EncounterKeys.get_job_key(job_id), "total") or 0),
        "state": "header_row_disambiguation",
        "needed_columns": list(needed),
        "data": result,
        "answer_url": get_answer_url(job_id, current_job),
    }
    raise NeedUserInput(payload=json.dumps(payload))


def set_next_state(job_id, state: str, run_analysis=True):
    job_key = EncounterKeys.get_job_key(job_id)
    current_job = int(kv.hget(job_key, "current_job") or 0)
    cache_path = EncounterKeys.get_cache_key(job_id, current_job)
    jobs = EncounterKeys.get_jobs_hash_key(job_id)
    channel = EncounterKeys.get_job_channel(job_id)
    path = str(kv.hget(jobs, f"job:{current_job}") or "")
    total_length = int(kv.hget(job_key, "total") or 0)
    if current_job == total_length and state == "done_validating":
        return

    states = {
        "sheet_verification": "header_row_disambiguation",
        "header_row_disambiguation": "done_validating",
    }
    next_state = states.get(state, state)

    if next_state == "done_validating":
        kv.publish(channel,  json.dumps({
            "type": "done_validating",
            "status": "analysing",
            "completed": int(kv.hget(job_key, "completed") or 0),
            "job_num": current_job,
            "file":  os.path.basename(path),
            "total": int(kv.hget(job_key, "total") or 0),
            "message": "Validation complete, starting analysis",

        }))
        if run_analysis:
            start_encounter_analysis.delay(job_id, current_job)
        kv.delete(cache_path)  # only safe now — this file is fully validated

        if current_job < total_length:
            current_job += 1
            kv.hset(job_key, "current_job", str(current_job))
            next_state = get_start_state()

    kv.hset(EncounterKeys.get_job_key(job_id), "state", next_state)


state_handler = {
    "sheet_verification": handle_sheet_verification,
    "header_row_disambiguation": handle_row_disambiguation,
}


@celery_app.task(ignore_result=True)
def start_encounter_validation(job_id: str):
    job_key = EncounterKeys.get_job_key(job_id)
    channel = EncounterKeys.get_job_channel(job_id)
    jobs = EncounterKeys.get_jobs_hash_key(job_id)
    current_job = int(kv.hget(job_key, "current_job") or 0)
    path = kv.hget(jobs, f"job:{current_job}")

    while True:
        state = str(kv.hget(job_key, "state") or "")
        current_job = int(kv.hget(job_key, "current_job") or 0)
        if state == "done_validating":
            kv.hset(job_key, "status", "analysing")

            kv.publish(
                channel,
                json.dumps({
                    "type": "analysing",
                    "status": "analysing",
                    "completed": int(kv.hget(job_key, "completed") or 0),
                    "job_num" : current_job,
                    "file":  os.path.basename(path),
                    "total": int(kv.hget(job_key, "total") or 0),
                }),
            )
            break
        try:
            handler = state_handler[state]
            handler(job_id)
        except NeedUserInput as e:
            kv.hset(job_key, "pending_question", e.payload)
            kv.publish(channel, e.payload)
            return
        set_next_state(job_id, state)


def _construct_path(job_id: str, job_num: Optional[int] = None, suffix: str = "", prefix: str = ""):
    clean_id = EncounterKeys.clean_id(job_id)
    path = os.path.join(current_app.config["SCRATCH_FILE_PATH"], "encounter", clean_id)
    os.makedirs(path, exist_ok=True)
    return os.path.join(path, prefix + f"{clean_id}_{job_num if job_num else ''}_{suffix}")


@celery_app.task(ignore_result=True)
def start_encounter_analysis(job_id, job_num):
    job_key = EncounterKeys.get_job_key(job_id)
    jobs = EncounterKeys.get_jobs_hash_key(job_id)
    job_item_key = f"job:{job_num}"
    channel = EncounterKeys.get_job_channel(job_id)
    path = str(kv.hget(jobs, job_item_key) or "")
    metadata_key = EncounterKeys.get_metadata_key(job_id, job_num)
    metadata = kv.hgetall(metadata_key)
    if "header_row" not in metadata:
        return
    metadata["header_row"] = int(metadata["header_row"])
    metadata["col"] = json.loads(metadata["col"])
    total = int(kv.hget(job_key, "total") or 0)
    completed = int(kv.hget(job_key, "completed") or 0)

    publish_payload = {
        "type": "done_analysing",
        "status": "analysing",
        "job_num": job_num,
        "file": os.path.basename(path),
        "completed": completed,
        "total": total,
    }

    result = load_clean_dataframe(path, metadata)
    facility, encounter_df, utilization_df = None, None, None

    if result.success:
        master_diagnosis_list = load_diagnosis_lines()
        facility, encounter_df, utilization_df = process_df(result.data, master_diagnosis_list)
        encounter_path = _construct_path(job_id, job_num, "encounter.parquet")
        utilization_path = _construct_path(job_id, job_num, "utilization.parquet")
        encounter_df.to_parquet(encounter_path)
        utilization_df.to_parquet(utilization_path)
        entry = {
            "facility": facility,
            "encounter_path": encounter_path,
            "utilization_path": utilization_path,
        }
    else:
        entry = {"failed": True, "file": os.path.basename(path)}
    kv.hset(EncounterKeys.get_results_key(job_id), str(job_num), json.dumps(entry))

    total = int(kv.hget(job_key, "total") or 0)
    completed = kv.hlen(EncounterKeys.get_results_key(job_id))

    publish_payload = {
        "type": "done_analysing",
        "status": "analysing",
        "job_num": job_num,
        "file": os.path.basename(path),
        "completed": completed,
        "total": total,
    }

    if not result.success:
        publish_payload["message"] = f"Error processing {os.path.basename(path)}: {result.err_msg}"
    kv.publish(channel, json.dumps(publish_payload))

    if completed == total:
        if kv.hsetnx(EncounterKeys.get_job_key(job_id), "done", "true"):
            finalize_encounter_analysis.delay(job_id)
    kv.delete(metadata_key)


@celery_app.task(ignore_result=True)
def finalize_encounter_analysis(job_id):
    job_key = EncounterKeys.get_job_key(job_id)
    result_queue = EncounterKeys.get_results_key(job_id)
    all_entries = kv.hgetall(result_queue)
    kv.delete(result_queue)
    kv.hset(job_key, "status", "generating")
    completed = int(kv.hget(job_key, "completed") or 0)
    total = int(kv.hget(job_key, "total") or 0)

    encounters, utilizations = [], {}

    publish_payload = {
        "type": "generating_report",
        "status": "analysing",
        "completed": completed,
        "total": total,
    }

    kv.publish(EncounterKeys.get_job_channel(job_id),
               json.dumps(publish_payload))

    for entry in all_entries.values():
        data = json.loads(entry)
        if data.get("failed") or data.get("skipped"):
            continue  
        encounters.append(pd.read_parquet(data["encounter_path"]))
        utilizations[data["facility"]] = pd.read_parquet(data["utilization_path"])
        if os.path.exists(data["encounter_path"]):
            os.unlink(data["encounter_path"])
        if os.path.exists(data["utilization_path"]):
            os.unlink(data["utilization_path"])
    if encounters:
        combined_encounter_report = pd.concat(encounters)
        combined_encounter_report[("GRAND TOTAL", "Male")] = combined_encounter_report.loc[:, (slice(None), "Male")].sum(axis=1, min_count=1)
        combined_encounter_report[("GRAND TOTAL", "Female")] = combined_encounter_report.loc[:, (slice(None), "Female")].sum(axis=1, min_count=1)
        combined_encounter_report.loc["GRAND TOTAL(S)"] = combined_encounter_report.sum(min_count=1)
        output_file_name = _construct_path(job_id=job_id, suffix="report.xlsx", prefix="encounter_utilization")
        save_to_file(combined_encounter_report, utilizations, output_file_name)
        updated_cache = serialize_from_redis_cache()
        res = db.session.scalar(sa.select(DiagnosisCache).where(DiagnosisCache.key == "global"))
        kv.hset(job_key, "report_path", output_file_name)

        if res:
            res.cache = updated_cache
            db.session.commit()

    kv.hset(job_key, mapping={"status": "done", "completed": total})
    kv.delete(EncounterKeys.get_jobs_hash_key(job_id))

    kv.publish(
        EncounterKeys.get_job_channel(job_id),
        json.dumps(
            {
                "type": "done",
                "status": "done",
                "completed": int(kv.hget(job_key, "total") or 0),
                "total": int(kv.hget(job_key, "total") or 0),
            }
        ),
    )

    kv.expire(job_key, 60 * 60 * 24)
