from flask import Flask
from app.config import Config
from flask_sqlalchemy import SQLAlchemy
from celery import Celery, Task
from redis import Redis

app = Flask(__name__)
app.config.from_object(Config)
db = SQLAlchemy()
db.init_app(app)
kv = Redis(host='localhost',  port=6379, decode_responses=True)

class FlaskTask(Task):
    def __call__(self, *args: object, **kwargs: object):
        with app.app_context():
            return self.run(*args, **kwargs)

celery_app = Celery(
    app.name,
    broker= app.config['CELERY_BROKER_URL']
    task_cls= FlaskTask
)
celery_app.conf.update(broker_transport_option={
    'visibility_timeout': 18000

})
