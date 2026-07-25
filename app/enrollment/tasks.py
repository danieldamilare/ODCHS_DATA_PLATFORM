import os
import zipfile
import tempfile
import uuid as uuid_tools
import threading
import sqlalchemy as sa
from werkzeug.utils import secure_filename

from app import celery_app, kv, db
from app.enrollment.image_processing import is_image_extension,  is_image_too_blurry, read_image, correct_form_orentation, extract_full_passport_with_backend
from app.enrollment.models import Form, FormStatus, BatchStatus, Batch
from app.enrollment.normalization import normalize_form_object

from flask import current_app
from app.enrollment.llm.clients import AllKeysExhausted, gemini_client
from concurrent.futures import ThreadPoolExecutor, as_completed
from celery import group
import cv2


@celery_app.task
def extract_zip_for_processing(path: str, batch_id: str):
    kv_batch_name = f"batch:{batch_id}"
    
    if not os.path.exists(path):
        kv.hset(
            kv_batch_name, 
            mapping={"status": "FAILED", "msg": "File does not exist"}
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
                file for file in zf.infolist() 
                if not file.is_dir() and is_image_extension(file.filename)
            ]
            
            kv.hset(
                kv_batch_name, 
                mapping={"remaining": len(imglist), "total": len(imglist), "done": 0}
            )

            for idx, m in enumerate(imglist):
                current_name = m.filename
                m.filename = secure_filename(current_name)
                
                zf.extract(current_name, folder)
                
                form_path = os.path.join(folder, m.filename)
                new_form = Form(
                    uuid = str(uuid_tools.uuid4()),
                    img_path=form_path,
                    batch_id=batch_id,
                    sequence=idx + 1,
                    status=FormStatus.PENDING,
                )
                db.session.add(new_form)
                
                form_uuids.append(str(new_form.uuid))

        db.session.commit()
        kv.hset(kv_batch_name, mapping={"status": "PROCESSING"})

        
        job_group = group(process_image_pipeline.s(uuid) for uuid in form_uuids)
        job_group.apply_async()

    except Exception as e:
        db.session.rollback()
        kv.hset(
            kv_batch_name, 
            mapping={"status": "FAILED", "msg": f"Error extracting zipfile: {str(e)}"}
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

def _finalize_image_processing(batch_name, batch_id):
    kv.hincrby(batch_name, "done", 1)
    ret = kv.hincrby(batch_name, "remaining", -1)
    if ret == 0:
        db.session.execute(sa.update(Batch).where(Batch.uuid == batch_id).values(status = BatchStatus.DONE))
        db.session.commit()

def llm_extract(img_path):
    return gemini_client(img_path)



@celery_app.task(bind=True)
def process_image_pipeline(self, form_id: str):
    form =  db.session.scalar(sa.select(Form).where(Form.uuid== form_id))
    if not form:
        return

    batch_id = form.batch_id
    batch_name = f"batch:{batch_id}"
    batch = db.session.scalar(sa.select(Batch).where(Batch.uuid == batch_id))

    try:
        image_matrix = read_image(form.img_path)
        if is_image_too_blurry(image_matrix):
            form.status = FormStatus.NEED_RESCAN
            db.session.commit()
            _finalize_image_processing(batch_name, batch_id)
            return

        correct_form = correct_form_orentation(image_matrix)
        desc, path = tempfile.mkstemp(suffix = os.path.splitext(form.img_path)[1])
        os.close(desc)
        cv2.imwrite(path, correct_form)
        os.replace(path, form.img_path)

        with ThreadPoolExecutor(max_workers=1) as executor:
            futures = executor.submit(llm_extract, form.img_path)
            coords = extract_full_passport_with_backend(correct_form)
            res =  futures.result()
        form = normalize_form_object(form, batch, res, coords)
        form.status = FormStatus.READY

        db.session.add(form)
        db.session.commit()

        _finalize_image_processing(batch_name, batch_id)

    except AllKeysExhausted as e:
        raise self.retry(countdown = 15 * 60)

    except Exception as e:
        db.session.rollback()
        try:
            active_form = db.session.scalar(sa.select(Form).where(Form.uuid == form_id))
            if active_form:
                active_form.status = FormStatus.ERROR
                active_form.error_message = str(e)
                db.session.commit()
        except Exception:
            db.session.rollback()
        _finalize_image_processing(batch_name, batch_id)