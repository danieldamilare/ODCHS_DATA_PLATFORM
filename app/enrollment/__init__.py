from flask import Blueprint

enrollment_bp = Blueprint("enrollment", __name__, url_prefix="/api/enrollment")
from app.enrollment import routes
from app.enrollment import cli
