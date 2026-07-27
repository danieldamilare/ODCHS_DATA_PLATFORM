from flask import (
    Blueprint,
    request,
    current_app,
    jsonify,
    Response,
    stream_with_context,
    send_from_directory,
    url_for,
)
from app.enrollment.models import BatchStatus, Batch, Form, FormStatus
from app import db
import sqlalchemy as sa
from app.enrollment.schema import BatchUploader, FormPassPortUploader, FormUpdater
from app.enrollment.services import BatchServices, BatchJobResult, FormServices, FormEnrollmentState
from app.enrollment.dataloader import get_loader
from pydantic import ValidationError
from app.enrollment import enrollment_bp
from app import kv
from typing import Optional
import json
import os


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

        if batch.status == BatchStatus.DONE:
            yield ("event: complete\n" f"data: {json.dumps(batch.to_dict())}\n\n")
            return

        subscriber = kv.pubsub()

        try:
            subscriber.subscribe(f"channel:{batch_id}")

            progress = kv.hgetall(f"batch:{batch_id}")

            yield ("event: status\n" f"data: {json.dumps(progress)}\n\n")

            stmt = sa.select(Form.uuid, Form.status).where(
                Form.batch_id == batch.id,
                Form.status.in_(
                    [
                        FormStatus.READY,
                        FormStatus.ERROR,
                        FormStatus.NEED_RESCAN,
                    ]
                ),
            )

            for form_uuid, status in db.session.execute(stmt):
                yield (
                    "event: form_ready\n"
                    f"data: {json.dumps({'id': form_uuid, 'status': status.value})}\n\n"
                )

            db.session.close()

            progress = kv.hgetall(f"batch:{batch_id}")
            if progress.get("status") == "done":
                db.session.expire(batch)
                yield ("event: complete\n" f"data: {json.dumps(batch.to_dict())}\n\n")
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
                    del payload["type"]
                    yield ("event: form_ready\n" f"data: {json.dumps(payload)}\n\n")
                elif payload["type"] == "status":
                    del payload["type"]
                    yield ("event: status\n" f"data: {json.dumps(payload)}\n\n")

                if payload.get("status") == "done":
                    db.session.expire(batch)
                    yield (
                        "event: complete\n" f"data: {json.dumps(batch.to_dict())}\n\n"
                    )
                    break
        except Exception:
            yield ("event: error\n" 'data: {"message": "Connection lost"}\n\n')

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


@enrollment_bp.get("/asset/form/<string:asset_id>")
def get_form_asset(asset_id: str):
    form_service = FormServices()
    form = form_service.get(asset_id)
    if not form:
        return (jsonify({"success": False, "msg": "Asset cannot be found"}), 404)
    return send_from_directory(
        os.path.join(current_app.config["FORM_PATH"], form.batch.uuid),
        os.path.basename(form.img_path),
        as_attachment=True,
    )


@enrollment_bp.get("/asset/passport/<string:asset_id>")
def get_passport_asset(asset_id: str):
    form_service = FormServices()
    form = form_service.get(asset_id)
    if not form or not form.passport_path:
        return (jsonify({"success": False, "msg": "Asset cannot be found"}), 404)
    return send_from_directory(
        os.path.join(current_app.config["PASSPORT_PATH"], form.batch.uuid),
        os.path.basename(form.passport_path),
        as_attachment=True,
    )


@enrollment_bp.get("/form/<string:form_id>")
def get_form(form_id: str):
    form_service = FormServices()
    form = form_service.get(form_id)
    if not form:
        return (
            jsonify(
                {
                    "success": False,
                    "msg": "No form with the given id",
                }
            ),
            404,
        )
    data = form.to_dict()
    data["img_path"] = url_for("enrollment.get_form_asset", asset_id=form.uuid)
    if data["passport_path"]:
        data["passport_path"] = url_for("enrollment.get_passport_asset", asset_id= form.uuid)
    return jsonify({"success": True, "msg": "Successfully Got form", "data": data})


@enrollment_bp.post("/form/<string:form_id>/passport")
def update_form_passport(form_id: str):
    form_service = FormServices()
    form = form_service.get(form_id)
    if not form:
        return (
            jsonify(
                {
                    "success": False,
                    "msg": "No form with the given id",
                }
            ),
            404,
        )
    try:
        passport = request.files.get("passport")
        uploader = FormPassPortUploader(passport=passport)
    except ValidationError as e:
        return jsonify({"success": False, "errors": e.errors(include_url=False)}), 400
    result = form_service.update_passport(uploader.passport, form)
    if result.success == False:
        return (jsonify({"success": False, "msg": result.msg}), 500)
    return jsonify({"success": True, "msg": result.msg}), 200


@enrollment_bp.patch("/form/<string:form_id>")
def update_form(form_id: str):
    form_service = FormServices()
    form = form_service.get(form_id)
    if not form:
        return (
            jsonify(
                {
                    "success": False,
                    "msg": "No form with the given id",
                }
            ),
            404,
        )

    try:
        updater = FormUpdater(**request.get_json(silent=True) or {})
    except ValidationError as e:
        return jsonify({"success": False, "msg": e.errors(include_url=False)}), 400
    for key, value in updater.get_updates().items():
        if key in form.UPDATABLE_FIELDS:
            setattr(form, key, value)
    try:
        db.session.add(form)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return (jsonify({"success": False, "msg": "Error updating form"})), 500
    return (
        jsonify(
            {"success": True, "msg": "Successful updated form", "data": form.to_dict()}
        )
    ), 200

@enrollment_bp.post("/form/<string:form_id>/reject")
def reject_form(form_id: str):
    form_service = FormServices()
    form =  form_service.get(form_id)
    if not form:
        return (jsonify({"success": False, "msg": "No form exists with the given id"}), 404)

    reason = (request.get_json(silent=True) or {}).get("reason", "")
    if reason:
        form.reason = reason
    form.status = FormStatus.REJECTED
    db.session.add(form)
    db.session.commit()
    return (jsonify({"success": True, "msg": "rejected"}))


@enrollment_bp.post("/form/<string:form_id>/enroll")
def enroll_form(form_id: str):
    form_service = FormServices()
    strict = (request.get_json(silent=True) or {}).get("strict", True)
    result = form_service.enroll(form_id, strict=strict)

    if result.status == FormEnrollmentState.NOT_EXISTS:
        return jsonify({"success": False,  "status": "error", "msg": result.msg}), 404
    if result.status == FormEnrollmentState.NO_PASSPORT_ERROR:
        return jsonify({"success": False,  "status": "error",  "msg": result.msg}), 422
    if result.status == FormEnrollmentState.HIS_ERROR:
        return jsonify({"success": False, "status" : "error", "msg": result.msg}), 502
        status = "duplicate" if result.status == FormEnrollmentState.HIS_DUPLICATE else "enrolled"

    return jsonify({"success": True, "status": status, "msg": result.msg}), 200


@enrollment_bp.get("/lgas")
def get_lgas():
    loader = get_loader()

    return jsonify([{"id": code, "name": name} for name, code in loader.lgas.items()])


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
