from flask import Blueprint, request, current_app, jsonify, Response, stream_with_context
from app.enrollment.models import BatchStatus, Batch, Form, FormStatus
from app import db
import sqlalchemy as sa
from app.enrollment.schema import BatchUploader
from app.enrollment.services import BatchServices, BatchJobResult
from app.enrollment.dataloader import get_loader
from pydantic import ValidationError
from app.enrollment import enrollment_bp
from app import kv
from typing import Optional
import json


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
    try:
        uploader = BatchUploader(
            batch_file=request.files["batch_file"],
            lga_no=request.form.get("lga_no"),
            ward_no=request.form.get("ward_no"),
            facility_no=request.form.get("facility_no"),
        )
    except ValidationError as e:
        return jsonify({"success": False, "errors": e.errors(include_url=False)}), 400

    result: BatchJobResult = BatchServices().create_job(
        lga_no=uploader.lga_no,
        ward_no=uploader.ward_no,
        facility_no=uploader.facility_no,
        file=uploader.batch_file,
    )

    if result.status == "duplicate":
        return (
            jsonify(
                {
                    "success": False,
                    "msg": "This exact file has already been uploaded",
                    "data": result.batch.to_dict(),
                }
            ),
            409,
        )

    if result.status == "save_failed" or result.status == "empty_zip":
        msg = {
            "save_failed": "Failed to save uploaded file. Please try again or contact Administrator",
            "empty_zip": "Zip file does not contain any image object. Nothing to process",
        }
        return (
            jsonify({"success": False, "msg": msg[result.status]}),
            500,
        )

    return (
        jsonify(
            {
                "success": True,
                "msg": "Batch created and queued for processing",
                "data": result.batch.to_dict(),
            }
        ),
        202,
    )


@enrollment_bp.get("/batches/<string:batch_id>")
def get_batch_id(batch_id: str):
    batch_service = BatchServices()
    data = batch_service.get_breakdown_stat(batch_id)
    if not data:
        return (
            jsonify({"success": False, "msg": "No batch exists with the given id"}),
            404,
        )
    return jsonify({"success": True, "msg": "", "data": data})


@enrollment_bp.get("/batches/<string:batch_id>/progress")
def get_batch_progress_stream(batch_id: str):
    batch_service = BatchServices()

    @stream_with_context
    def generate():
        batch = batch_service.get(batch_id)

        if batch is None:
            yield (
                "event: error\n"
                f"data: {json.dumps({'message': 'Batch not found'})}\n\n"
            )
            return

        subscriber = kv.pubsub()

        try:
            subscriber.subscribe(f"channel:{batch_id}")

            progress = kv.hgetall(f"batch:{batch_id}")

            yield (
                "event: status\n"
                f"data: {json.dumps(progress)}\n\n"
            )

            stmt = (
                sa.select(Form.uuid, Form.status)
                .where(
                    Form.batch_id == batch.id,
                    Form.status.in_(
                        [
                            FormStatus.READY,
                            FormStatus.ERROR,
                            FormStatus.NEED_RESCAN,
                        ]
                    ),
                )
            )

            for form_uuid, status in db.session.execute(stmt):
                yield (
                    "event: form_ready\n"
                    f"data: {json.dumps({'id': form_uuid, 'status': status.value})}\n\n"
                )

            db.session.close()

            progress = kv.hgetall(f"batch:{batch_id}")
            if progress.get("status") == "done":
                yield (
                    "event: complete\n"
                    f"data: {json.dumps(progress)}\n\n"
                )
                return

            while True:
                message = subscriber.get_message(timeout=15)
                if message is None:
                    yield ": heartbeat\n\n"

                elif message["type"] != "message":
                    continue

                try:
                    payload = json.loads(message["data"])
                except Exception:
                    continue

                if payload["type"] == "form_ready":
                    del payload['type']
                    yield (
                        "event: form_ready\n"
                        f"data: {json.dumps(payload)}\n\n"
                    )
                if payload["type"] == "status":
                    del payload['type']
                    yield (
                        "event: status\n"
                        f"data: {json.dumps(payload)}\n\n"
                    )

                if payload.get("status") == "done":
                    yield (
                        "event: complete\n"
                        f"data: {json.dumps(progress)}\n\n"
                    )
                    break
        except Exception:
             yield (
                "event: error\n"
                "data: {\"message\": \"Connection lost\"}\n\n"
            )

        finally:
            subscriber.unsubscribe(f"channel:{batch_id}")
            subscriber.close()

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@enrollment_bp.route("/wards/<int:lga_id>")
def get_wards(lga_id):
    loader = get_loader()
    wards = loader.wards.get(str(lga_id), {})
    return jsonify([{"id": code, "name": name} for name, code in wards.items()])


@enrollment_bp.route("/facilities/<int:ward_id>")
def get_facilities(ward_id):
    loader = get_loader()
    facilities = loader.facilities.get(str(ward_id), {})
    return jsonify([{"id": code, "name": name} for name, code in facilities.items()])
