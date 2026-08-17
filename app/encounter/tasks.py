from app import kv
import zipfile
import os
import shutil
from werkzeug.utils import secure_filename
from app import celery_app
import json
import pandas as pd
from flask import url_for
from typing import Optional, Tuple, Dict
import re
from app import db
import sqlalchemy as sa
from app.encounter.encounter import get_ext, load_clean_dataframe, process_df, save_to_file
from app.encounter.disease_classifier import load_diagnosis_lines, serialize_from_redis_cache
from app.encounter.models import DiagnosisCache
from flask import current_app

class NeedUserInput(Exception):
    def __init__(self, payload: str, msg=""):
        super().__init__(msg)
        self.payload = payload


ORANGHIS_ENCOUNTER_WORKFLOW_STATE = ["sheet_verification", "header_row_disambiguation"]
ORANGHIS_REQUIRED_COLUMNS = {"age", "client name", "diagnosis", "sex", "policy number"}

@celery_app.task
def start_encounter_process(job_id):
    path = str(kv.hget(job_id, "path") or "")
    jobs = f"{job_id}:jobs"
    folder = os.path.dirname(path)
    channel = f"channel:{job_id}"
    kv.hset(job_id, "status", "extracting")
    current_job_key = f"{job_id}:current_job"

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
                    kv.hset(job_id, "status", "failed")
                    kv.expire(job_id, 60 * 60)
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
            kv.hset(job_id, "status", "failed")
            kv.delete(jobs)
            try:
                shutil.rmtree(folder, ignore_errors=True)
            except Exception:
                pass
            kv.expire(job_id, 60 * 60)
            kv.publish(
                channel,
                json.dumps(
                    {"type": "error", "status": "failed", "message": str(e)}
                ),
            )
            return
    else:
        kv.hset(jobs, f"job:1", path)
    status = kv.hget(job_id, "status")
    length = kv.hlen(jobs)

    kv.hset(job_id, "state", get_start_state())
    kv.hset(job_id, mapping={"completed": 0, "total": length})
    kv.publish(
        channel,
        json.dumps(
            {
                "type": "extracting",
                "status": status,
                "total": length,
                "message": f"Extracted {length} files",
            }
        ),
    )
    kv.set(current_job_key, "1")
    kv.hset(job_id, "status", "validating")
    start_encounter_validation.delay(job_id)


def get_start_state():
    return "sheet_verification"


def get_answer_url(job_idx: str, job_num: int):
    return url_for(
        "encounter.post_answer",
        job_idx=job_idx.removeprefix("encounter:"),
        job_num=job_num,
    )


def handle_sheet_verification(job_id):
    current_job_key = f"{job_id}:current_job"
    channel = f"channel:{job_id}"
    current_job = int(kv.get(current_job_key) or 0)
    jobs = f"{job_id}:jobs"
    job_idx = f"job:{current_job}"
    cache_path = f"{job_id}:{current_job}:cache"
    metadata = f"{job_id}:{current_job}:metadata"
    path = str(kv.hget(jobs, job_idx) or "")
    if not path:
        return
    ext = get_ext(path)
    sheet_holder = {}
    if ext == ".csv":
        df = pd.read_csv(path, nrows=20, header=None)
        if not df.empty:
            sheet_value = df.values.tolist()
            sheet_holder[0] = sheet_value
            kv.hset(cache_path, str(0), json.dumps(sheet_value))
    else:
        engine = "odf" if ext == ".ods" else "calamine"
        file = pd.ExcelFile(path, engine=engine)
        sheets = file.sheet_names
        for sheet in sheets:
            df = file.parse(sheet, nrows=20, header=None)
            if df.empty:
                continue
            sheet_value = df.values.tolist()
            kv.hset(cache_path, str(sheet), json.dumps(sheet_value))
            sheet_holder[sheet] = sheet_value
        if not sheet_holder:
            kv.publish(
                channel,
                json.dumps(
                    {
                        "type": "validating",
                        "status": "validating",
                        "job_num": int(kv.get(current_job_key) or 0),
                        "total": int(kv.hget(job_id, "total") or 0),
                        "message": f"Skipped empty file: {os.path.basename(path)}",
                    }
                ),
            )
    if len(sheet_holder) == 1:
        kv.hset(metadata, "sheet_name", list(sheet_holder.keys())[0])
        return

    payload = {
        "type": "require_user_input",
        "status": "validating",
        "job_num": current_job,
        "total": int(kv.hget(job_id, "total") or 0),
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
    current_job_key = f"{job_id}:current_job"
    current_job = int(kv.get(current_job_key) or 0)
    jobs = f"{job_id}:jobs"
    job_idx = f"job:{current_job}"
    cache_path = f"{job_id}:{current_job}:cache"
    metadata = f"{job_id}:{current_job}:metadata"
    sheet = str(kv.hget(metadata, "sheet_name") or "")
    result = json.loads(str(kv.hget(cache_path, sheet) or ""))
    df = pd.DataFrame(result)
    needed = ORANGHIS_REQUIRED_COLUMNS
    res = _find_header_row(df, needed)
    if res:
        header_row, col = res
        kv.hset(metadata, mapping={"header_row": header_row, "col": json.dumps(col)})
        return

    payload = {
        "type": "require_user_input",
        "status": "validating",
        "job_num": current_job,
        "total": int(kv.hget(job_id, "total") or 0),
        "state": "header_row_disambiguation",
        "needed_columns": list(needed),
        "data": result,
        "answer_url": get_answer_url(job_id, current_job),
    }
    raise NeedUserInput(payload=json.dumps(payload))


def set_next_state(job_id, state: str):
    current_job_key = f"{job_id}:current_job"
    current_job = int(kv.get(current_job_key) or 0)
    cache_path = f"{job_id}:{current_job}:cache"
    jobs = f"{job_id}:jobs"
    states = {
        "sheet_verification": "header_row_disambiguation",
        "header_row_disambiguation": "done_processing",
    }
    next_state = states[state]

    if next_state == "done_processing":
        start_encounter_analysis.delay(job_id, current_job)
        total_length = kv.hlen(jobs)
        number = current_job
        if number < total_length:
            number += 1
            kv.set(current_job_key, str(number))
            next_state = get_start_state()

    kv.delete(cache_path)
    kv.hset(job_id, "state", next_state)


state_handler = {
    "sheet_verification": handle_sheet_verification,
    "header_row_disambiguation": handle_row_disambiguation,
}


@celery_app.task
def start_encounter_validation(job_id: str):
    channel = f"channel:{job_id}"
    jobs = f"{job_id}:jobs"
    current_job_key = f"{job_id}:current_job"
    while True:
        state = str(kv.hget(job_id, "state") or "")
        if state == "done_processing":
            kv.hset(job_id, "status", "analysing")
            kv.publish(
                channel,
                json.dumps({
                    "type": "analysing",
                    "status": "analysing",
                    "completed": 0,
                    "total": int(kv.hget(job_id, "total") or 0),
                    "message": "Validation complete, starting analysis",
                }),
            )
            break
        try:
            handler = state_handler[state]
            handler(job_id)
        except NeedUserInput as e:
            kv.publish(channel, e.payload)
            return
        set_next_state(job_id, state)

def _construct_path(job_id: str, job_num: Optional[int] = None, suffix: str = "", prefix: str=""):
    path = os.path.join(current_app.config['SCRATCH_FILE_PATH'], job_id)
    os.makedirs(path, exist_ok=True)
    return  os.path.join(path, prefix + f'{job_id}_{job_num if job_num else ""}_{suffix}')

@celery_app.task
def start_encounter_analysis(job_id, job_num):
    jobs = f"{job_id}:jobs"
    job_key = f"job:{job_num}"
    channel = f"channel:{job_id}"
    path = str(kv.hget(jobs, job_key) or "")
    metadata_key = f"{job_id}:{job_num}:metadata"
    metadata = kv.hgetall(metadata_key)
    metadata["col"] = json.loads(metadata["col"])
    kv.delete(metadata_key)

    result = load_clean_dataframe(path, metadata)
    facility, encounter_df, utilization_df = None, None, None

    if result.success:
        master_diagnosis_list = load_diagnosis_lines()
        facility, encounter_df, utilization_df = process_df(result.data, master_diagnosis_list)
        encounter_path = _construct_path(job_id, job_num, "encounter.parquet")
        utilization_path = _construct_path(job_id, job_num, "utilization.parquet")
        encounter_df.to_parquet(encounter_path)
        utilization_df.to_parquet(utilization_path)
        kv.rpush(f"{job_id}:results", json.dumps({
            "facility": facility, "encounter_path": encounter_path, "utilization_path": utilization_path,
        }))

    total = int(kv.hget(job_id, "total") or 0)
    completed = int(kv.hincrby(job_id, "completed", 1))

    publish_payload = {
        "type": "analysing",
        "status": "analysing",
        "completed": completed,
        "total": total,
    }
    if not result.success:
        publish_payload["message"] = f"Error processing {os.path.basename(path)}: {result.err_msg}"
    kv.publish(channel, json.dumps(publish_payload))

    if completed == total:
        finalize_encounter_analysis.delay(job_id)

@celery_app.task
def finalize_encounter_analysis(job_id):
    result_queue = f"{job_id}:results"
    all_entries = kv.lrange(result_queue, 0, -1)
    kv.delete(result_queue)
    encounters, utilizations = [], {}

    for entry in all_entries:
        data = json.loads(entry)
        encounters.append(pd.read_parquet(data["encounter_path"]))
        utilizations[data["facility"]] = pd.read_parquet(data["utilization_path"])
        os.unlink(data["encounter_path"])
        os.unlink(data["utilization_path"])
        
    combined_encounter_report = pd.concat(encounters)
    combined_encounter_report[('GRAND TOTAL', 'Male')]   = combined_encounter_report.loc[:, (slice(None), 'Male')].sum(axis=1, min_count=1)
    combined_encounter_report[('GRAND TOTAL', 'Female')] = combined_encounter_report.loc[:, (slice(None), 'Female')].sum(axis=1, min_count=1)
    combined_encounter_report.loc['GRAND TOTAL(S)']      = combined_encounter_report.sum(min_count=1)
    output_file_name = _construct_path(job_id=job_id, suffix="report.xlsx", prefix="encounter_utilization")
    save_to_file(combined_encounter_report, utilizations, output_file_name)
    updated_cache = serialize_from_redis_cache()
    res = db.session.scalar(sa.select(DiagnosisCache).where(DiagnosisCache.key == 'global'))
    res.cache = updated_cache
    db.session.commit()
    kv.hset(job_id, "report_path", output_file_name)
    kv.hset(job_id, "status", "done")
    kv.delete(f"{job_id}:jobs")
    kv.publish(
        f"channel:{job_id}",
        json.dumps(
            {
                "type": "done",
                "status": "done",
                "completed": int(kv.hget(job_id, "total") or 0),
                "total": int(kv.hget(job_id, "total") or 0),
            }
        ),
    )
    kv.expire(job_id, 60 * 60 * 24)
