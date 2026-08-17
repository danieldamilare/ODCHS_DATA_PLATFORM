from flask import Blueprint
from flask_jwt_extended import verify_jwt_in_request

encounter_bp = Blueprint("encounter", __name__, url_prefix="/api/encounter")

@encounter_bp.before_request
def must_have_logged_in():
    verify_jwt_in_request()
from app.encounter import routes, cli # noqa