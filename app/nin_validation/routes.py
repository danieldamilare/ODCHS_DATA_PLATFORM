from app.nin_validation import nin_bp
from app.nin_validation.schema import NINValidator, NINBatchValidator
from flask import request, jsonify, url_for, stream_with_context
from app.core.utils import serialize_validation_errors
from app import kv
from app.nin_validation.nin_services import NINServices
from pydantic import ValidationError 
import json


@nin_bp.post("/validate")
def validate_nin():
    try:
        res  = NINValidator.model_validate(request.get_json(silent=True))
    except ValidationError as e:
        return jsonify(
            {
                "success": False,
                "msg": serialize_validation_errors(e)
            }
        ), 400

    result = NINServices().validate_nin(res.dob, res.nin)
    if not result.sys_err:
        return (jsonify({"success": result.success, "message": result.msg, "data": result.payload}), 200)

    return (jsonify({"success": result.success, "message": result.msg, "data": result.payload}), 500)

@nin_bp.post("/warm")
def warm_cache():
    NINServices().warmup()
    return "", 204

@nin_bp.get("/batch/<string:job_id>/progress")
def nin_progress_stream(job_id:str):
    payload = NINServices().get_batch_status(job_id, with_stream=True)
    if not payload:
        return jsonify({"success": "False", "msg": "You didn't submit any job with this id"}), 404

    @stream_with_context
    def generate():
        nonlocal payload
        if payload.get("status") == "done":
            yield f"event: complete\ndata: {json.dumps(payload)}\n\n"
            return
        channel = str(payload.get("channel"))
        subscriber = kv.pubsub(ignore_subscribe_messages=True)

        try:
            subscriber.subscribe(channel)
            yield f"event:status\ndata:{json.dumps(payload)}\n\n"

            while True:
                message = subscriber.get_message(timeout=15)
                if message is None:
                    yield ": heartbeat\n\n"
                    continue
                if message['type'] == "message":
                    snapshot = dict(json.loads(message['data']))
                    event_type = snapshot.pop("type", "status")
                    if event_type == "done":
                        yield f"event: complete\ndata: {json.dumps(snapshot)}\n\n"
                        break
                    yield f"event:{event_type}\ndata: {json.dumps(snapshot)}\n\n"
        except Exception:
            yield f"event: error\ndata: {json.dumps({"message": "Connection lost"})}\n\n"
        finally:
            subscriber.unsubscribe(channel)
            subscriber.close()
                    


@nin_bp.get("/batch/<string:job_id>/status")
def nin_status(job_id: str):
    payload = NINServices().get_batch_status(job_id)
    if not payload:
        return jsonify({"success": "False", "msg": "You didn't submit any job with this id"}), 404
    return jsonify({
        "success": True,
        "msg": payload["status"],
        "data": payload
    })



@nin_bp.post("/batch/validate")
def validate_nin_batch():
    try: 
        res = {"batch_file": request.files["batch_file"],
        "generate_report" : True if request.form.get("generate_report", "").lower() == "true" else False,
        "aggregrate_by_lga_ward" : True if request.form.get("aggregrate_by_lga_ward", "").lower() == "true" else False,
        "aggregrate_by_lga_facility" : True if request.form.get("aggregrate_by_lga_facility", "").lower() == "true" else False
        }

        res = NINBatchValidator.model_validate(res)
    except ValidationError as e:
        return jsonify(
            {
                "success": False,
                "msg": serialize_validation_errors(e)
            }
        ), 400
    result = NINServices().start_batch_validation(res)
    if result.status == "duplicate":
        return (jsonify({
            "success": False,
            "msg": result.msg,
            "data" : {
                "job_url": url_for("nin_validation.nin_status", batch_id=result.job_id)
            }
        }), 409)

    if result.status ==  'save_error':
        return (jsonify({
            "success": False,
            "msg": result.msg
        }), 500)

    return (jsonify({
        "success": True,
        "msg": result.msg,
        "data": {
            "job_url": url_for("nin_validation.nin_progress_stream", batch_id=result.job_id)
        }
    }))

