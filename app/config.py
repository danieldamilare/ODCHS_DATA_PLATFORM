import os


class Config:
    MAX_CONTENT_LENGTH = 500 * 1024 * 1024
    BASE_DIR = os.path.dirname(__file__)
    SECRET_KEY = os.getenv("SECRET_KEY")
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL") or "sqlite:///" + os.path.join(
        BASE_DIR, "..", "app.db"
    )  # currently using sqlite for easy testing
    CELERY_BROKER_URL = "redis://localhost:6379/0"
    BROKER_TRANSPORT_OPTIONS = {'visibility_timeout': 18000}