from flask import Flask
from app.config import Config
from flask_sqlalchemy import SQLAlchemy
from celery import Celery, Task
from redis import Redis
from flask_jwt_extended import JWTManager
from flask_migrate import Migrate

db = SQLAlchemy()
kv: Redis = Redis()
celery_app = Celery(__name__)
jwt = JWTManager()
migrate = Migrate()


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)
    db.init_app(app)
    jwt.init_app(app)
    global kv
    migrate.init_app(app, db)

    kv = Redis.from_url(app.config["REDIS_URL"], decode_responses=True)

    class FlaskTask(Task):
        def __call__(self, *args: object, **kwargs: object):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery_app.config_from_object(config)
    celery_app.Task = FlaskTask  # type: ignore[misc]
    celery_app.autodiscover_tasks(
        ["app.enrollment", "app.nin_validation", "app.encounter", "app.core"]
    )
    from app.enrollment import enrollment_bp
    from app.nin_validation import nin_bp
    from app.encounter import encounter_bp
    from app.auth import auth_bp
    from app.admin import admin_bp
    from app.auth import models as auth_models
    from app.encounter import models as encounter_models
    from app.enrollment import models as enrollment_models
    from app.jobs import models as job_models

    app.register_blueprint(enrollment_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(nin_bp)
    app.register_blueprint(encounter_bp)
    app.register_blueprint(admin_bp)
    return app


app = create_app()
