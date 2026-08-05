from app.nin_validation import nin_blueprint
from app.nin_validation.schema import NINValidator, NINBatchValidator
from flask import request, jsonify, url_for
from app.core.utils import serialize_validation_errors
from app.nin_validation.nin_services import NINServices
from pydantic import ValidationError 


@nin_blueprint.post("/validate")
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

@nin_blueprint.post("/warm")
def warm_cache():
    NINServices().warmup()
    return "", 204

@nin_blueprint.post("/batch/validate")
def validate_nin_batch():
    try: 
        res = NINBatchValidator.model_validate(request.get_json(silent=True))
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
                "job_url": url_for("nin_progress", result.job_id)
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
            "job_ur": url_for("nin_progress", result.job_id)
        }
    }))