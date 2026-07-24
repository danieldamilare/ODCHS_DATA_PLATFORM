from flask import Blueprint, request, current_app, jsonify
from models import BatchStatus, Batch, Form, FormStatus
from app import db
import sqlalchemy as sa
from validators import BatchUploader
from app.enrollment.utils import compute_hash
from pydantic import ValidationError

enrollment_bp = Blueprint("enrollment", __name__, url_prefix="/api/enrollment")


@enrollment_bp.route("/batches")
def batch_get():
    page = int(request.args.get("page", 1))
    count = int(request.args.get("count", current_app.config["DEFAULT_PAGINATION"]))
    batches = db.paginate(sa.select(Batch), page=page, per_page=count)
    return (
        jsonify(
            {
                "success": True,
                "msg": "Successfully got batch",
                "data": [batch.to_dict() for batch in batches.items],
                "pagination": {
                    "total": batches.total,
                    "has_next": batches.has_next,
                    "has_prev": batches.has_prev,
                    "per_page": batches.per_page,
                    "page": batches.page,
                    "total_pages": batches.pages,
                },
            }
        ),
        200,
    )


@enrollment_bp.post("/batches")
def batch_post():
    payload = {**request.form}
    payload["batch_file"] = request.files.get("batch")
    try:
        uploader = BatchUploader(
            batch_file=request.files["batch_file"],
            lga_no=request.form.get("lga_no"),
            ward_no=request.form.get("ward_no"),
            facility_no=request.form.get("facility_no"),
        )
    except ValidationError as e:
        return jsonify({"success": False, "errors": e.errors(include_url=False)}), 400

    batch, existing = BatchService.create_batch_job()
