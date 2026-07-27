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

    broker_url = REDIS_URL

    broker_transport_options = {"visibility_timeout": 18000}

    beat_schedule = {
        "reclaim-leased-keys-every-5-mins": {
            "task": "app.enrollment.tasks.reclaim_leased_api_keys",
            "schedule": 60.0 * 5,
            "options": {"queue": "high_priority"},
        },
    }
