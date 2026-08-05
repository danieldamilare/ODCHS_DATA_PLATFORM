from flask import Blueprint

nin_blueprint = Blueprint("nin_validation", __name__, url_prefix="/api/nin")
from app.nin_validation import routes #noqa