from flask import Blueprint
from flask_jwt_extended import verify_jwt_in_request

nin_bp = Blueprint("nin_validation", __name__, url_prefix="/api/nin")

@nin_bp.before_request
def must_have_logged_in():
    verify_jwt_in_request()

from app.nin_validation import routes  # noqa
