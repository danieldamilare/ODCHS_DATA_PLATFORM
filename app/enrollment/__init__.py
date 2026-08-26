from flask import Blueprint
from flask_jwt_extended import verify_jwt_in_request

enrollment_bp = Blueprint("enrollment", __name__, url_prefix="/api/enrollment")


@enrollment_bp.before_request
def must_have_logged_in():
    verify_jwt_in_request()


from app.enrollment import routes  # noqa

