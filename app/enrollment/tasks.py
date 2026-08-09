import os
import zipfile
import tempfile
import uuid as uuid_tools
import sqlalchemy as sa
from werkzeug.utils import secure_filename
from typing import Optional
import json
from app.enrollment.utils import generate_id_card_path
from app import celery_app, kv, db
from app.enrollment.image_processing import (
    is_image_too_blurry,
    read_image,
    process_form_orientation_and_crop,
)
from app.enrollment.utils import is_image_extension
from app.enrollment.models import Form, FormStatus, BatchStatus, Batch
from app.enrollment.normalization import normalize_form_object
from app.enrollment.his_client import HISClient
from app.enrollment.idcard.generator import IdCardGenerator, ProgressEvent

from flask import current_app
from app.enrollment.llm.clients import (
    AllKeysExhausted,
    gemini_client,
    ServerConnectionError,
)
from celery import group, chord
from time import perf_counter
import cv2
import traceback
from datetime import datetime


@celery_app.task
def extract_zip_for_processing(path: str, batch_id: str):
    kv_batch_name = f"batch:{batch_id}"

    batch = db.session.scalar(sa.select(Batch).where(Batch.uuid == batch_id))
    print("Got batch", batch)
    if not batch:
        kv.hset(kv_batch_name, mapping={"status": "FAILED", "msg": "Batch not found"})
        return

    if not os.path.exists(path):
        kv.hset(
            kv_batch_name, mapping={"status": "FAILED", "msg": "File does not exist"}
        )
        db.session.execute(
            sa.update(Batch)
            .where(Batch.uuid == batch_id)
            .values(status=BatchStatus.FAILED)
        )
        db.session.commit()
        return

    try:
        folder = os.path.join(current_app.config["BASE_DIR"], "forms", str(batch_id))
        os.makedirs(folder, exist_ok=True)

        form_uuids = []

        with zipfile.ZipFile(path) as zf:
            imglist = [
                file
                for file in zf.infolist()
                if not file.is_dir() and is_image_extension(file.filename)
            ]

            for idx, m in enumerate(imglist):
                current_name = m.filename
                m.filename = secure_filename(current_name)

                zf.extract(current_name, folder)

                form_path = os.path.join(folder, m.filename)
                new_form = Form(
                    uuid=str(uuid_tools.uuid4()),
                    img_path=form_path,
                    batch_id=batch.id,
                    sequence=idx + 1,
                    status=FormStatus.PENDING,
                )
                print("Created new form: ", new_form)
                db.session.add(new_form)

                form_uuids.append(str(new_form.uuid))

        db.session.commit()
        kv.hset(kv_batch_name, mapping={"status": "PROCESSING"})
        os.remove(path)

        job_group = group(process_image_pipeline.s(uuid) for uuid in form_uuids)
        job_group.apply_async()

    except Exception as e:
        db.session.rollback()
        kv.hset(
            kv_batch_name,
            mapping={"status": "FAILED", "msg": f"Error extracting zipfile: {str(e)}"},
        )
        try:
            db.session.execute(
                sa.update(Batch)
                .where(Batch.uuid == batch_id)
                .values(status=BatchStatus.FAILED)
            )
            db.session.commit()
        except Exception:
            db.session.rollback()


def _finalize_image_processing(batch_name: str, batch_id: str, form: Form):
    kv.hincrby(batch_name, "done", 1)
    ret = kv.hincrby(batch_name, "remaining", -1)
    status = kv.hgetall(batch_name)

    payload = {
        "type": "form_ready",
        "id": form.uuid,
        "status": form.status.value,
        "surname": form.surname or "",
        "firstname": form.firstname or "",
    }
    if ret == 0:
        db.session.execute(
            sa.update(Batch)
            .where(Batch.uuid == batch_id)
            .values(status=BatchStatus.DONE)
        )
        db.session.commit()
        status["status"] = "done"
        kv.delete(batch_name)

    status_payload = {"type": "status", **status}
    kv.publish(f"channel:{batch_id}", json.dumps(status_payload))

    kv.publish(f"channel:{batch_id}", json.dumps(payload))


def llm_extract(img_path):
    return gemini_client(img_path)


def _process_image_pipeline(form: Form, batch: Batch):
    t0 = perf_counter()
    image_matrix = read_image(form.img_path)
    print(f"read_image: {perf_counter() - t0:.3f}s")

    t0 = perf_counter()
    if is_image_too_blurry(image_matrix):
        form.status = FormStatus.NEED_RESCAN
        form.reason = "Image is too blurry. Please rescan"
        db.session.commit()
        return
    print(f"blur: {perf_counter() - t0:.3f}s")

    t0 = perf_counter()
    correct_form, coords = process_form_orientation_and_crop(image_matrix)
    print(f"yunet crop and orientation correction: {perf_counter() - t0:.3f}s")

    desc, path = tempfile.mkstemp(suffix=os.path.splitext(form.img_path)[1])
    os.close(desc)
    cv2.imwrite(path, correct_form)
    os.replace(path, form.img_path)

    t0 = perf_counter()
    res = llm_extract(form.img_path)
    print(f"gemini: {perf_counter() - t0:.3f}s")

    form = normalize_form_object(form, batch, res, coords)
    form.status = FormStatus.READY

    db.session.add(form)
    db.session.commit()


@celery_app.task(bind=True, max_retries=None)
def process_image_pipeline(self, form_id: str, is_batch=True):
    form: Optional[Form] = db.session.scalar(
        sa.select(Form).where(Form.uuid == form_id)
    )
    if not form or form.status != FormStatus.PENDING:
        return

    batch = form.batch
    batch_id = batch.uuid
    batch_name = f"batch:{batch_id}"

    try:
        _process_image_pipeline(form, batch)
        if is_batch:
            _finalize_image_processing(batch_name, batch_id, form)

    except AllKeysExhausted:
        traceback.print_exc()
        countdown = min(45 * (self.request.retries + 1), 5 * 60)
        raise self.retry(countdown=countdown)
    except ServerConnectionError:
        countdown = min(60 * 3 * (self.request.retries + 1), 15 * 60)
        raise self.retry(countdown=countdown)

    except Exception as e:
        traceback.print_exc()
        db.session.rollback()
        active_form = db.session.scalar(sa.select(Form).where(Form.uuid == form_id))
        try:
            if active_form:
                active_form.status = FormStatus.ERROR
                active_form.error_message = str(e)
                db.session.commit()
        except Exception:
            traceback.print_exc()
            db.session.rollback()
        if is_batch and active_form:
            _finalize_image_processing(batch_name, batch_id, active_form)


@celery_app.task
def reclaim_leased_api_keys():
    from app.enrollment.llm.keys import KEY_POOL, LEASE, LEASE_TRACKER
    from hashlib import md5

    keys = kv.lrange(LEASE, 0, -1)
    for key in keys:
        key_hash = md5(key.encode()).hexdigest()
        tracker_exist = kv.exists(f"{LEASE_TRACKER}:{key_hash}")
        if not tracker_exist:
            removed = kv.lrem(LEASE, 1, key)
            if removed:
                kv.rpush(KEY_POOL, key)


@celery_app.task
def get_his_id_card_payload(path: str, enroll_no: str, batch_id: str):
    kv_status_key = f"batch_idcard_status:{batch_id}"
    try:
        client = HISClient()
        result = client.fetch_id_details_from_his(enroll_no)
        outcome = result.success
    except Exception:
        result = None
        outcome = False

    fetched = int(kv.hincrby(kv_status_key, "fetched", 1))
    total = int(kv.hget(kv_status_key, "total") or 0)
    kv.publish(
        f"channel:batch_idcard:{batch_id}",
        json.dumps({"type": "fetch_progress", "fetched": fetched, "total": total, "enrollee_no": enroll_no, "success": outcome})
    )
    return (path, result) if result else None

@celery_app.task
def generate_id_card(result, batch_id):
    kv_batch_id_name = f"batch_idcard:{batch_id}"
    kv_batch_id_status = f"batch_idcard_status:{batch_id}"

    kv.hset(kv_batch_id_status, "status", "generating")
    to_generate = []
    for res in result:
        if res is None:
            kv.hincrby(kv_batch_id_status, "failed", 1)
            continue
        path, cur = res

        if not cur.success:
            kv.hincrby(kv_batch_id_status, "failed", 1)
            continue
        to_generate.append((path, cur.payload))

    def publish_update_idcard_status(event: ProgressEvent):
        completed = int(kv.hincrby(kv_batch_id_status, "completed", 1))
        all_data = kv.hgetall(kv_batch_id_status)
        success = int(all_data.get('success', 0))
        failed = int(all_data.get('failed', 0))
        total = int(all_data.get('total', 0))
        if event.success:
            success = int(kv.hincrby(kv_batch_id_status, "success", 1))
            kv.sadd(kv_batch_id_name, event.path)
        else:
            failed = int(kv.hincrby(kv_batch_id_status, "failed", 1))

        payload = {
            "type": "generate_progress",
            "completed": completed,
            "total": total,
            "status": all_data.get("status", ""), 
            "failed": failed,
            "success": success,
        }
        kv.publish(f"channel:batch_idcard:{batch_id}", json.dumps(payload))

    generator = IdCardGenerator()
    generator.create_id_card_sync(to_generate, publish_update_idcard_status)
    kv.hset(kv_batch_id_status, "status", "done")
    payload = {"type": "status", "status": "done"}
    kv.publish(f"channel:batch_idcard:{batch_id}", json.dumps(payload))
    kv.expire(kv_batch_id_name, 86400)
    kv.expire(kv_batch_id_status, 86400)


@celery_app.task
def start_id_card_generate_job(batch_id: str):
    batch = db.session.scalar(
        sa.select(Batch).where(Batch.uuid == batch_id)
    )
    if not batch:
        return
    forms = db.session.scalars(
        sa.select(Form).where(
            Form.batch_id == batch.id,
            Form.status == FormStatus.ENROLLED,
            Form.enrollee_number.isnot(None),
        )
    ).all()
    kv_batch_id_name = f"batch_idcard:{batch_id}"
    kv_batch_id_status = f"batch_idcard_status:{batch_id}"

    if not forms:
        return

    already_succeed = 0
    task_headers = []
    for form in forms:
        id_path = generate_id_card_path(
            form.uuid, form.firstname, form.othername, form.surname
        )

        if os.path.exists(id_path):
            kv.sadd(kv_batch_id_name, id_path)
            already_succeed += 1
            continue

        enrollee_number = form.enrollee_number
        payload = {"path": id_path, "enroll_no": enrollee_number}
        task_headers.append(get_his_id_card_payload.s(**payload))

    kv.hset(
        kv_batch_id_status,
        mapping={
            "total": len(forms),
            "status": "fetching" if task_headers else "done",
            "success": already_succeed,
            "completed": already_succeed,
            "failed": 0,
            "time_started": datetime.timestamp(datetime.now()),
        },
    )
    
    if task_headers:
        callback = generate_id_card.s(batch_id)
        chord(task_headers)(callback)
    else:
        payload = {"type": "status", "status": "done"}
        kv.publish(f"channel:batch_idcard:{batch_id}", json.dumps(payload))
