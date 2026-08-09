from app import celery_app
from celery import chord, chain
from app import kv
from app.nin_validation.nin_client import load_nin_client
from dateutil import parser
from datetime import datetime, timedelta
import csv
import shutil
import json
from app.nin_validation.nin_tools import generate_donut_chart, generate_lga_bar_charts, TEMPLATE_PATH, render_pdf_from_html
from flask import current_app
import os
import pandas as pd
import asyncio
from jinja2 import Template
import gc

"""
After stress testing, I noticed the nin servers only perform well on 5 concurrent with just 8% 503 unavailable eror.
Due to this we need a way to limit workers globally without creating a seperate celery queue.
So a global worker tracker using redis is used, we lease space to worker until they finish their task, they are required
to send an heartbeat after every processsing (nin validation ) which should take according to benchmark at most 18s (in the 99 percentile)
a seperate background reaper would work to reap stale worker, finally the finalize process work sequentially to reclaim validation stuck in
processing limbo
"""


MAX_WORKER = 3 #limit to 3 to avoid the overload, and also give breathing room to interactive enrollment NIN validation

RETRY_COUNTDOWN = 5 * 60


class InlineRetry(Exception):
    pass


def parse_dob_safely(dob_raw: str):
    dob_raw = str(dob_raw).strip().replace(".", "")
    if dob_raw.isdigit():
        serial = int(dob_raw)
        return datetime(1899, 12, 30) + timedelta(days=serial)
    return parser.parse(dob_raw)


@celery_app.task(queue="io_bound")
def process_nin_batch_validation(job_id: str):
    path = kv.hget(job_id, "path")
    if not path:
        return
    queue_path = f"{job_id}:queue"
    idx = 0
    with open(path, "r") as f:
        reader = csv.reader(f)
        header = next(reader)
        dob_col = None 
        nin_col = None 

        for i, h in enumerate(header):
            if h.lower() == "dob":
                dob_col = i
            elif h.lower() == "nin":
                nin_col = i
        if dob_col is None or nin_col is None:
            return 
        
        job_result = f"{job_id}:result"
        count = 0

        for idx, row in enumerate(reader):
            try:
                dob = parse_dob_safely(row[dob_col].strip())
                dob_str = dob.date().strftime("%d/%m/%Y")
            except Exception:
                payload = {"nin_verified": False, "nin_msg": "DOB is invalid"}
                kv.hset(job_result, str(idx), json.dumps(payload))
                continue

            nin = row[nin_col].strip()
            if not nin or not nin.isdigit() or len(nin) != 11:
                if not nin:
                    payload = {"nin_verified": False, "nin_msg": "Empty NIN"}
                elif not nin.isdigit():
                    payload = {"nin_verified": False, "nin_msg": "NIN contains non digit characters"}
                else:
                    payload = {"nin_verified": False, "nin_msg": "Incomplete NIN"}

                kv.hset(job_result, str(idx), json.dumps(payload))
                continue

            count+=1
            payload = {"nin": row[nin_col], "dob": dob_str, "idx": idx}
            kv.rpush(queue_path, json.dumps(payload))
        kv.hset(job_id, "total", count)

    kv.hset(job_id, "status", "validating")
    status = kv.hget(job_id, "status")
    completed = kv.hget(job_id, "completed")
    total = kv.hget(job_id, "total")

    kv.publish(
        f"channel:{job_id}",
        json.dumps({"type": "validating", "status": status, "completed": completed, "total": total}),
    )
    workers = []
    workers = chord(
        [process_nin_row.s(job_id, i) for i in range(MAX_WORKER)],
        finalize_nin_process.s(job_id),
    )
    workers()

def generate_processing_queue_path(job_id, worker_no): 
    return f"{job_id}:{worker_no}:queue:processing"

def process_inline(job_id: str, job_result: str, payload: dict):
    client = load_nin_client()
    dob = datetime.strptime(payload["dob"], "%d/%m/%Y")
    result = client.validate_nin(dob, payload["nin"])
    idx = int(payload["idx"])

    if result.retry:
        raise  InlineRetry

    new_payload = {"nin_verified": result.success, "nin_msg": result.msg}
    inserted = kv.hsetnx(job_result, str(idx), json.dumps(new_payload))
    if not inserted:
        return #try to be idempotent
    completed = kv.hincrby(job_id, "completed")

    status = kv.hget(job_id, "status")
    total = kv.hget(job_id, "total")
    kv.publish(
        f"channel:{job_id}",
        json.dumps({"type": "validating", "completed": completed, "status": status, "total": total}),
    )


@celery_app.task(bind=True, queue="io_bound")
def process_nin_row(self, job_id: str, worker_no: int):

    queue_path = f"{job_id}:queue"
    processing_queue_path = generate_processing_queue_path(job_id, worker_no)
    job_result = f"{job_id}:result"

    while True:
        result = kv.lmove(queue_path, processing_queue_path)
        if not result:
            break
        payload = json.loads(result)
        try:
            process_inline(job_id, job_result, payload)
        except InlineRetry:
            raise self.retry(countdown = 60 * (self.request_retries + 1)) #avoid holding worker space hostage
        kv.rpop(processing_queue_path)


def _load_data(path):
    df = pd.read_csv(path)
    df.columns = [str(s).lower() for s in df.columns]
    
    for col in df.select_dtypes(include=['object']).columns:

        if df[col].nunique() < 1000:
            df[col] = df[col].astype('category')
    return df


@celery_app.task(queue="cpu_bound")
def generate_aggregate_breakdown(job_id, path, aggregate_type):
    kv.hset(job_id, "status", "breakdown")
    status = kv.hget(job_id, "status")
    completed = kv.hget(job_id, "completed")
    total = kv.hget(job_id, "total")

    kv.publish(
        f"channel:{job_id}",
        json.dumps({"type": "breakdwon", "status": status, "completed": completed, "total": total}),)

    agg_col = str(aggregate_type).lower()
    parent_path = os.path.join(current_app.config['SCRATCH_FILE_PATH'], job_id)
    os.makedirs(parent_path, exist_ok=True)
    
    df = _load_data(path)
    try:
        lga_group = df.groupby('lga', observed=False)
        
        for lga_name, lga_df in lga_group:
            if lga_df.empty:
                continue
                
            safe_lga = str(lga_name).replace('/', '_')
            new_path = os.path.join(parent_path, safe_lga)
            os.makedirs(new_path, exist_ok=True)
            
            sub_group = lga_df.groupby(agg_col, observed=False)
            
            for agg_name, sub_df in sub_group:
                if sub_df.empty:
                    continue
                safe_name = str(agg_name).replace('/', '_') + '.csv'
                file_path = os.path.join(new_path, safe_name)
                sub_df.to_csv(file_path, index=False)
        final_path = shutil.make_archive(parent_path, 'zip', parent_path)
        kv.hset(job_id, "csv_breakdown_result_path", final_path)
        return path #return path so next chain can consume

    finally:
        del df
        gc.collect()
        if os.path.exists(parent_path):
            shutil.rmtree(parent_path)

@celery_app.task(queue='io_bound')
def merge_csv_result(job_id: str, job_result: str) -> str:
    kv.hset(job_id, "status", "merging")
    status = kv.hget(job_id, "status")
    completed = kv.hget(job_id, "completed")
    total = kv.hget(job_id, "total")

    kv.publish(
        f"channel:{job_id}",
        json.dumps({"type": "merging", "status": status, "completed": completed, "total": total}),)

    old_path = kv.hget(job_id, "path") or ""
    new_path = os.path.join(current_app.config["SCRATCH_FILE_PATH"], job_id) + ".csv"
    
    with open(old_path, "r", encoding="utf-8") as input, open(
        new_path, "w", newline=""
    ) as output:
        reader = csv.DictReader(input)
        fieldnames = list(reader.fieldnames or [])
        fieldnames.extend(["nin_valid", "reason"])
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        results = kv.hgetall(job_result)

        for idx, row in enumerate(reader):
            payload = results.get(str(idx), None)
            if payload:
                res = json.loads(payload)
                row["nin_valid"] = res["nin_verified"]
                row["reason"] = res["nin_msg"]
            else:
                row.setdefault("nin_valid", "")
                row.setdefault("reason", "not processed")
            writer.writerow(row)
    kv.delete(job_result)
    os.remove(old_path)
    kv.hset(job_id, "csv_result_path", new_path)
    return new_path


@celery_app.task(queue='cpu_bound')
def generate_pdf_report(job_id, data_path):
    kv.hset(job_id, "status", "report")
    status = kv.hget(job_id, "status")
    completed = kv.hget(job_id, "completed")
    total = kv.hget(job_id, "total")

    kv.publish(
        f"channel:{job_id}",
        json.dumps({"type": "report", "status": status, "completed": completed, "total": total}),)

    df = _load_data(data_path)
    try:
        total = len(df)
        valid_mask = df["nin_valid"].astype(str).str.strip().str.lower().isin(["true", "1"])
        valid_nin_total = int(valid_mask.sum())
        invalid_nin_total = total - valid_nin_total
        invalid_nin_df = df[~valid_mask]
        nin_breakdown = invalid_nin_df["reason"].value_counts().to_dict()

        lga_nin_breakdown = df.groupby(["lga", "reason"], observed=False).size().unstack(fill_value=0)
        scratch_dir = os.path.join(current_app.config["SCRATCH_FILE_PATH"], f"pdf_{job_id}")
        os.makedirs(scratch_dir, exist_ok=True)
        d1_path = os.path.join(scratch_dir, "donut_overall.png")
        d2_path = os.path.join(scratch_dir, "donut_detailed.png")
        
        generate_donut_chart(["Valid", "Invalid"], [valid_nin_total, invalid_nin_total], total, d1_path)
        generate_donut_chart(list(df["reason"].value_counts().index), list(df["reason"].value_counts().values), total, d2_path)
        
        lga_chart_paths = generate_lga_bar_charts(lga_nin_breakdown, scratch_dir)
    finally:
        del df
        gc.collect()

    def to_file_uri(p):
        return f"file://{os.path.abspath(p)}"

    valid_pct = round((valid_nin_total / total) * 100, 1) if total > 0 else 0
    invalid_pct = round((invalid_nin_total / total) * 100, 1) if total > 0 else 0

    context = {
        "total_records": f"{total:,}",
        "valid_total": f"{valid_nin_total:,}",
        "valid_pct": valid_pct,
        "invalid_total": f"{invalid_nin_total:,}",
        "invalid_pct": invalid_pct,
        "nin_breakdown": nin_breakdown,
        "donut_1_path": to_file_uri(d1_path),
        "donut_2_path": to_file_uri(d2_path),
        "lga_chart_paths": [to_file_uri(p) for p in lga_chart_paths]
    }

    with open(TEMPLATE_PATH) as f:
        html_string = f.read()
    template = Template(html_string)
    render_html = template.render(**context)
    pdf_path = os.path.join(current_app.config["SCRATCH_FILE_PATH"], f"{job_id}.pdf")
    asyncio.run(render_pdf_from_html(render_html, pdf_path))
    kv.hset(job_id, "pdf_result_path", pdf_path)
    shutil.rmtree(scratch_dir)
    return data_path #let other chain consume

@celery_app.task(queue='io_bound')
def update_final(job_id):
    kv.hset(job_id, "status", "done")
    kv.expire(job_id, 60 * 60 *24)
    checksum = str(kv.hget(job_id, "checksum") or "")
    kv.expire(checksum, 60*60*24)
    status = kv.hget(job_id, "status")
    completed = kv.hget(job_id, "completed")
    total = kv.hget(job_id, "total")

    kv.publish(
        f"channel:{job_id}",
        json.dumps({"type": "done", "status": status, "completed": completed, "total": total}),)



@celery_app.task(queue='io_bound', bind=True, max_retries=None)
def finalize_nin_process(self, job_id: str):
    max_worker = MAX_WORKER

    job_result = f"{job_id}:result"
    for w in range(max_worker):
        processing_queue_path = generate_processing_queue_path(job_id, w)
        while current := kv.lrange(processing_queue_path, 0, 0):
            item = current[0]
            payload = json.loads(item)
            try:
                process_inline(job_id, job_result, payload)
            except InlineRetry:
                raise self.retry(countdown=60* (self.request_retries + 1))

            kv.lpop(processing_queue_path)
        kv.delete(processing_queue_path)
    kv.delete(f"{job_id}:queue")

    aggregate_type = kv.hget(job_id, "aggregate")
    generate_report = kv.hget(job_id, "generate_report")

    logic_task = None
    if aggregate_type and generate_report:
        logic_task = chain(generate_aggregate_breakdown.s(job_id=job_id, aggregate_type=aggregate_type),
                            generate_pdf_report.s(job_id=job_id))
    elif aggregate_type:
        logic_task = generate_aggregate_breakdown.s(job_id=job_id, aggregate_type=aggregate_type)
    elif generate_report:
        logic_task = generate_pdf_report.s(job_id=job_id)

    if logic_task:
        task = chain(merge_csv_result.si(job_id, job_result), logic_task, update_final.si(job_id))
    else:
        task = chain(merge_csv_result.si(job_id, job_result), update_final.si(job_id))
    task.delay()