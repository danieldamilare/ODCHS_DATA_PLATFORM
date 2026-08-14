from flask import Blueprint

enrollment_bp = Blueprint("enrollment", __name__, url_prefix="/api/enrollment")
from app.enrollment import routes  # noqa
from app.enrollment import cli  # noqa
