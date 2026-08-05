import os


class Config:
    # --- File Upload & Safety Constraints ---
    # 500 MB maximum threshold to handle massive field agent ZIP files safely
    MAX_CONTENT_LENGTH = 500 * 1024 * 1024
    BASE_DIR = os.path.dirname(os.path.dirname(__file__))
    SECRET_KEY = os.getenv("SECRET_KEY")

    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL") or "sqlite:///" + os.path.join(
        BASE_DIR, "app.db"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    DEFAULT_PAGINATION = 20
    FORM_PATH = os.path.join(BASE_DIR, "forms")
    PASSPORT_PATH = os.path.join(FORM_PATH, "passports")
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    MALE_AVATAR_PATH = os.path.join(
        BASE_DIR, "app", "static", "asset", "male_avatar.jpeg"
    )
    FEMALE_AVATAR_PATH = os.path.join(
        BASE_DIR, "app", "static", "asset", "female_avatar.jpeg"
    )
    NIN_SERVER_TOKEN_URL = os.getenv("NIN_SERVER_TOKEN_URL")
    NIN_VALIDATE_URL = os.getenv("NIN_VALIDATE_URL")
    NIN_SERVER_URL = os.getenv("NIN_SERVER_URL")
    NIN_ORIGIN = os.getenv("NIN_ORIGIN")
    SCRATCH_FILE_PATH = os.path.join(BASE_DIR, "temp")



    HIS_SESSION_CONFIG = {
        "user_id": os.getenv("HIS_USER_ID"),
        "deployState": os.getenv("HIS_DEPLOY_STATE"),
        "staffType": os.getenv("HIS_STAFF_TYPE"),
        "name": os.getenv("HIS_NAME"),
        "emailAddress": os.getenv("HIS_EMAIL_ADDRESS"),
        "mobileNo": os.getenv("HIS_MOBILE_NO"),
        "organisation": os.getenv("HIS_ORGANIZATION"),
        "department": os.getenv("HIS_DEPARTMENT"),
        "jobtitle": os.getenv("HIS_JOBTITLE"),
        "Origin": os.getenv("HIS_WEBSITE_ORIGIN"),
        "Referer": os.getenv("HIS_WEBSITE_REFERER"),
    }

    broker_url = REDIS_URL
    task_acks_late = True
    worker_reject_on_worker_lost = True

    broker_transport_options = {"visibility_timeout": 18000}
    broker_connection_retry_on_startup = True

    task_publish_retry = True
    task_publish_retry_policy = {
        "max_retries": 5,  # Try up to 5 times if Redis socket is flaky
        "interval_start": 0.2,  # Start with a 200ms delay
        "interval_step": 0.5,  # Progressively wait longer between attempts
        "interval_max": 2.0,  # Cap retry intervals at 2 seconds max
    }

    beat_schedule = {
        "reclaim-leased-keys-every-5-mins": {
            "task": "app.enrollment.tasks.reclaim_leased_api_keys",
            "schedule": 60.0 * 5,
        },
    }
