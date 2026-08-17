from app.encounter import encounter_bp
from app.encounter.schema import EncounterValidator
from app.core.utils import serialize_validation_errors
from flask import request, jsonify
from pydantic import ValidationError
from app.encounter.services import EncounterServices
from app.encounter.tasks import ORANGHIS_REQUIRED_COLUMNS


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
        return jsonify(
            {
                "success": False,
                "msg": "BHCPF Encounter analysis engine not implemented yet"
            }
        )
    if result.success:
        return (
            jsonify(
                {
                    "success": result.success,
                    "msg": result.msg,
                }
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