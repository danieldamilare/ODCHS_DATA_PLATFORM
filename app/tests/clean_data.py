import os
import shutil
from app import app, db
from redis import Redis
from app.enrollment.models import Batch, Form, Dependants
from app.jobs.models import Jobs

with app.app_context():
    # 1. Clear database tables (preserving User and UserSession)
    num_dependants = db.session.query(Dependants).delete()
    num_forms = db.session.query(Form).delete()
    num_batches = db.session.query(Batch).delete()
    num_jobs = db.session.query(Jobs).delete()
    db.session.commit()
    print(f"DB Cleaned: deleted {num_dependants} dependants, {num_forms} forms, {num_batches} batches, {num_jobs} jobs.")

    # 2. Clear Redis cache / hashes / celery state
    try:
        r0 = Redis.from_url(app.config.get("REDIS_URL", "redis://localhost:6379/0"))
        r0.flushdb()
        r1 = Redis.from_url(app.config.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/1"))
        r1.flushdb()
        print("Redis cache & Celery queues/results flushed successfully.")
    except Exception as e:
        print(f"Redis flush: {e}")

    # 3. Clean files in forms/ and temp/
    forms_dir = app.config.get("FORM_PATH")
    temp_dir = app.config.get("SCRATCH_FILE_PATH")
    passports_dir = app.config.get("PASSPORT_PATH")

    for folder in [forms_dir, temp_dir]:
        if folder and os.path.exists(folder):
            for item in os.listdir(folder):
                item_path = os.path.join(folder, item)
                if item == "passports":
                    for p in os.listdir(item_path):
                        p_path = os.path.join(item_path, p)
                        if os.path.isfile(p_path) or os.path.islink(p_path):
                            os.unlink(p_path)
                        elif os.path.isdir(p_path):
                            shutil.rmtree(p_path)
                    continue
                if os.path.isfile(item_path) or os.path.islink(item_path):
                    os.unlink(item_path)
                elif os.path.isdir(item_path):
                    shutil.rmtree(item_path)

    os.makedirs(forms_dir, exist_ok=True)
    os.makedirs(passports_dir, exist_ok=True)
    os.makedirs(temp_dir, exist_ok=True)
    print("Storage cleaned: forms/, forms/passports/, and temp/ wiped clean.")
    print("All done! System is ready for fresh test.")
