from flask import Flask
from app.config import Config
from flask_sqlalchemy import SQLAlchemy
from celery import Celery, Task
from redis import Redis

db = SQLAlchemy()
kv: Redis = Redis()
celery_app = Celery(__name__)


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)
    db.init_app(app)
    global kv
    kv = Redis.from_url(app.config["REDIS_URL"], decode_responses=True)

    class FlaskTask(Task):
        def __call__(self, *args: object, **kwargs: object):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery_app.config_from_object(config)
    celery_app.Task = FlaskTask # type: ignore[misc]
    celery_app.autodiscover_tasks(["app.enrollment"])
    from app.enrollment import enrollment_bp

    app.register_blueprint(enrollment_bp)
    return app


app = create_app()
