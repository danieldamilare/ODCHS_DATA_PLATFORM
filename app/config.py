import os


class Config:
    # --- File Upload & Safety Constraints ---
    # 500 MB maximum threshold to handle massive field agent ZIP files safely
    MAX_CONTENT_LENGTH = 500 * 1024 * 1024
    BASE_DIR = os.path.dirname(os.path.dirname(__file__))
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")

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

    broker_transport_options = {"visibility_timeout": 18000}

    beat_schedule = {
        "reclaim-leased-keys-every-5-mins": {
            "task": "app.enrollment.tasks.reclaim_leased_api_keys",
            "schedule": 60.0 * 5,
            "options": {"queue": "high_priority"},
        },
    }
