from flask import (
    Blueprint,
    request,
    current_app,
    jsonify,
    Response,
    stream_with_context,
    send_from_directory,
    send_file,
    url_for,
)
from app.enrollment.models import BatchStatus, Batch, Form, FormStatus
from app import db
import sqlalchemy as sa
from app.enrollment.schema import BatchUploader, FormPassPortUploader, FormUpdater
from app.enrollment.services import (
    BatchServices,
    BatchJobResult,
    FormServices,
    FormEnrollmentState,
    FormUpdateResult,
)
from app.enrollment.dataloader import get_loader
from pydantic import ValidationError
from app.enrollment import enrollment_bp
from app.enrollment.tasks import process_image_pipeline
from app import kv
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


@enrollment_bp.get("/batches/<string:batch_id>/forms/download")
def download_batch_forms(batch_id: str):
    batch_service = BatchServices()
    status_filter = request.args.get("status", None)
    download_type = request.args.get("type", None)

    if not download_type:
        return jsonify({"success": False, "msg": "Please select a download type"}), 400

    if download_type.strip().lower() == 'form':
        result = batch_service.download_forms(batch_id, status_filter)
        if result.status == "invalid":
            return jsonify({"success": False, "msg": result.msg}), 400
        elif result.status ==  "404":
            return jsonify({"success": False, "msg": result.msg}), 404

        response = Response(result.generator, mimetype="application/zip")
        response.headers['Content-Disposition'] = f'attachment; filename={result.filename}'
        return response
    elif download_type.strip().lower() =="idcard":
        result = batch_service.start_id_card_generation()
        # handle return
    else:
        return jsonify({"success": False, "msg": f"Invalid download type {download_type}. Use 'form' or 'idcard' as type"}), 400


@enrollment_bp.get("/batches/<string:batch_id>/forms")
def get_batch_forms(batch_id: str):
    batch_service = BatchServices()
    batch = batch_service.get(batch_id)
    if not batch:
        return jsonify({"success": False, "msg": "No batch with the given id"}), 404

    status_filter = request.args.get("status")
    after = request.args.get("after")
    count = int(request.args.get("count", 20))

    query = sa.select(Form).where(Form.batch_id == batch.id)

    if status_filter:
        query = query.where(Form.status == FormStatus(status_filter))

    if after:
        cursor_form = db.session.scalar(
            sa.select(Form.sequence).where(Form.uuid == after)
        )
        if cursor_form is not None:
            query = query.where(Form.sequence > cursor_form)

    query = query.order_by(Form.sequence.asc()).limit(count)

    forms = db.session.scalars(query).all()

    return jsonify(
        {
            "success": True,
            "data": [f.to_dict() for f in forms],
            "has_more": len(forms) == count,
        }
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
                print(f"got message: {message}")
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

def _serve_form_file(asset_id: str, as_attachment:bool = False):
    form_service = FormServices()
    form = form_service.get(asset_id)
    if not form:
        return (jsonify({"success": False, "msg": "Asset cannot be found"}), 404)
    if not as_attachment:
        return send_from_directory(
            os.path.join(current_app.config["FORM_PATH"], form.batch.uuid),
            os.path.basename(form.img_path),
            max_age=86400,
        )
    else:
        return send_from_directory(
            os.path.join(current_app.config["FORM_PATH"], form.batch.uuid),
            os.path.basename(form.img_path),
            as_attachment=True,
        )



@enrollment_bp.get("/asset/form/<string:asset_id>")
def get_form_asset(asset_id: str):
    return _serve_form_file(asset_id= asset_id, as_attachment=False)
    
@enrollment_bp.get("/asset/passport/<string:asset_id>")
def get_passport_asset(asset_id: str):
    form_service = FormServices()
    form = form_service.get(asset_id)
    if not form or not form.passport_path:
        return (jsonify({"success": False, "msg": "Asset cannot be found"}), 404)
    return send_from_directory(
        os.path.join(current_app.config["PASSPORT_PATH"], form.batch.uuid),
        os.path.basename(form.passport_path),
        max_age=86400,
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

    data["MALE_AVATAR"] = url_for(
        "static", filename="asset/male_avatar.jpeg", _external=True
    )
    data["FEMALE_AVATAR"] = url_for(
        "static", filename="asset/female_avatar.jpeg", _external=True
    )
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
    try:
        updater = FormUpdater(**request.get_json(silent=True) or {})
    except ValidationError as e:
        return jsonify({"success": False, "msg": e.errors(include_url=False)}), 400
    form_service = FormServices()
    result: FormUpdateResult = form_service.update_form(form_id, updater)

    if result.status == "rotate_error":
        return (jsonify({"success": False, "msg": result.msg}), 400)
    elif result.status == "db_error":
        return (jsonify({"success": False, "msg": result.msg}), 500)
    elif result.status == "invalid":
        return (jsonify({"success": False, "msg": result.msg}), 404)
    else:
        return (
            jsonify(
                {"success": True, "msg": result.msg, "data": result.form.to_dict()}
            ),
            200,
        )


@enrollment_bp.post("/form/<string:form_id>/rescan")
def rescan_form(form_id: str):
    form_service = FormServices()
    form = form_service.get(form_id)
    if not form:
        return jsonify({"success": False, "msg": "No form with the given id"}), 404
    if form.status != FormStatus.NEED_RESCAN:
        return (
            jsonify(
                {
                    "success": False,
                    "msg": "Only forms flagged for rescan can be replaced",
                }
            ),
            400,
        )

    new_image = request.files.get("image")
    if not new_image:
        return jsonify({"success": False, "msg": "No replacement image provided"}), 400

    new_image.save(form.img_path)  # overwrite in place, same path
    form.status = FormStatus.PENDING
    form.error_message = None
    form.reason = None
    db.session.commit()

    process_image_pipeline.delay(form.uuid, is_batch=False)
    return jsonify({"success": True, "msg": "New scan queued for processing"}), 202


@enrollment_bp.post("/form/<string:form_id>/reject")
def reject_form(form_id: str):
    form_service = FormServices()
    form = form_service.get(form_id)
    if not form:
        return (
            jsonify({"success": False, "msg": "No form exists with the given id"}),
            404,
        )

    reason = (request.get_json(silent=True) or {}).get("reason", "")
    if reason:
        form.reason = reason
    form.status = FormStatus.REJECTED
    db.session.add(form)
    db.session.commit()
    return jsonify({"success": True, "msg": "rejected"})


@enrollment_bp.post("/form/<string:form_id>/enroll")
def enroll_form(form_id: str):
    form_service = FormServices()
    result = form_service.enroll(form_id)

    if result.status == FormEnrollmentState.NOT_EXISTS:
        return jsonify({"success": False, "status": "error", "msg": result.msg}), 404
    if result.status == FormEnrollmentState.NO_PASSPORT_ERROR:
        return jsonify({"success": False, "status": "error", "msg": result.msg}), 422
    if result.status == FormEnrollmentState.HIS_ERROR:
        return jsonify({"success": False, "status": "error", "msg": result.msg}), 502
    status = (
        "duplicate"
        if result.status == FormEnrollmentState.HIS_DUPLICATE
        else "enrolled"
    )

    return jsonify({"success": True, "status": status, "msg": result.msg}), 200


@enrollment_bp.post("/form/<string:form_id>/reprocess")
def reprocess_form(form_id: str):
    form_service = FormServices()
    form = form_service.get(form_id)

    if not form:
        return jsonify({"success": False, "msg": "No form with the given id"}), 404
    if form.status not in (FormStatus.ERROR, FormStatus.NEED_RESCAN):
        return (
            jsonify(
                {
                    "success": False,
                    "msg": "Only errored or rescan forms can be reprocessed",
                }
            ),
            400,
        )

    form.status = FormStatus.PENDING
    form.error_message = None
    form.reason = None
    db.session.commit()

    process_image_pipeline.delay(form.uuid, is_batch=False)
    return jsonify({"success": True, "msg": "Form queued for reprocessing"}), 202

@enrollment_bp.get("/form/<string:form_id>/download")
def download_form(form_id: str):
    return _serve_form_file(form_id, as_attachment=True)



@enrollment_bp.get("/form/<string:form_id>/download")
def download_form_idcard(form_id: str):
    type = request.args.get()
    form_service = FormServices()
    result = form_service.download_id_card(form_id)
    if result.status == "invalid":
        return jsonify({"success": False, "msg": "No form with the given id"}), 404
    return send_file(result.file, mimetype="application/jpeg", as_attachment=True, download_name = result.download_name)


@enrollment_bp.get("/lgas")
def get_lgas():
    loader = get_loader()
    lga = loader.lgas or {}
    return jsonify([{"id": code, "name": name} for name, code in lga.items()])


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


@enrollment_bp.route("/categories")
def get_categories():
    loader = get_loader()
    citizen_types = loader.citizen_types or {}
    return jsonify([{"id": code, "name": name} for name, code in citizen_types.items()])
