from flask import Blueprint, request, current_app
from models import BatchStatus, Batch, Form, FormStatus
from app import db
import sqlalchemy as sa

enrollment_bp = Blueprint("/api/enrollment", __name__)


@enrollment_bp.route("batches")
def batch_get():
    page = request.args.get("page", 1)
    count = request.args.get("count", current_app.config["DEFUALT_PAGINATION"])
    db.paginate(sa.select(Batch), page, count)
