from app.encounter import encounter_bp
from app.encounter.schema import EncounterValidator
from app.core.utils import serialize_validation_errors
from flask import request, jsonify, stream_with_context, Response, send_file
from pydantic import ValidationError
from app.encounter.services import EncounterServices
from app.encounter.keys import EncounterKeys
from app import kv
import json


@encounter_bp.post("/upload")
def upload_encouter():
    chai_only = request.form.get("chai_only")
    args = {
        "encounter_file": request.files.get("encounter_file"),
        "encounter_type": request.form.get("encounter_type"),
        "chai_only": True if chai_only and chai_only.lower() == "true" else False,
    }
    try:
        res = EncounterValidator.model_validate(args)
    except ValidationError as e:
        return (jsonify({"success": False, "msg": serialize_validation_errors(e)})), 400

    if res.encounter_type == "oranghis":
        result = EncounterServices().start_encounter_job(res)
    else:
        return (
            jsonify(
                {
                    "success": False,
                    "msg": "BHCPF Encounter analysis engine not implemented yet",
                }
            ),
            501,
        )
    if result.success:
        return (
            jsonify(
                {"success": result.success, "msg": result.msg, "job_id": result.job_id}
            )
        ), 200
    else:
        return (jsonify({"success": result.success, "msg": result.msg})), 500


@encounter_bp.post("/<job_idx>/<int:job_num>/answer")
def post_answer(job_idx, job_num):
    try:
        json_response = request.get_json(force=True)
    except Exception:
        return jsonify({"success": False, "msg": "Invalid JSON payload"}), 400

    result = EncounterServices().process_user_answer(job_idx, job_num, json_response)
    if not result.get("success"):
        return jsonify(result), 400
    return jsonify(result), 200


@encounter_bp.get("/<job_id>/progress")
def encounter_progress(job_id):
    job_key = EncounterKeys.get_job_key(job_id)
    if not kv.exists(job_key):
        return (
            jsonify(
                {"success": False, "msg": "There is no valid encounter job with the id"}
            ),
            404,
        )
    channel = EncounterKeys.get_job_channel(job_id)

    @stream_with_context
    def generate():
        nonlocal job_key, channel
        subscriber = kv.pubsub(ignore_subscribe_messages=True)
        try:
            subscriber.subscribe(channel)
            snapshot = kv.hgetall(job_key)
            snapshot.pop("path", "")
            if snapshot.get("status") == "done":
                yield f"event: done\ndata: {json.dumps(snapshot)}\n\n"
                return

            yield f"event: status\ndata: {json.dumps(snapshot)}\n\n"

            while True:
                message = subscriber.get_message(timeout=15)
                if message is None:
                    yield ": heartbeat\n\n"
                    continue
                if message["type"] == "message":
                    payload = dict(json.loads(message["data"]))
                    print(payload)
                    event_type = payload.pop("type", "status")

                    if event_type == "done":
                        snapshot = kv.hgetall(job_key)
                        yield f"event: done\ndata: {json.dumps(snapshot)}\n\n"
                        continue

                    yield f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
        except Exception:
            yield f"event: error\ndata: {json.dumps({'message': 'Connection lost'})}\n\n"
        finally:
            subscriber.unsubscribe(channel)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@encounter_bp.get("/<string:job_id>/status")
def get_encounter_status(job_id):
    job_key = EncounterKeys.get_job_key(job_id)
    res_len = kv.hlen(EncounterKeys.get_results_key(job_id))
    if not kv.exists(job_key):
        return {"success": False, "msg": "No encounter job exists with this id"}, 404
    result = kv.hgetall(job_key)
    result["completed"] = res_len
    result.pop("path", "")
    return jsonify({"success": True, "msg": "Loaded status", "data": result})


@encounter_bp.get("/<string:job_idx>/download")
def download_encounter(job_idx):
    job_key = EncounterKeys.get_job_key(job_idx)
    result_path = kv.hget(job_key, "report_path") or ""
    return send_file(
        result_path,
        as_attachment=True,
    )
