from app.admin import admin_bp
from flask import request, jsonify, current_app
from app.admin.schema import UserValidator
from app.admin.services import AdminServices
from app.core.utils import serialize_validation_errors
from app.auth.models  import UserStatus, User
from pydantic import ValidationError
import sqlalchemy as sa
from app import db
from datetime import datetime, timezone


@admin_bp.post('/users')
def create_user():
    res = request.get_json(silent=True) or {}
    try:
        valid_res = UserValidator.model_validate(res)
    except ValidationError as e:
        return jsonify({
            "success": False,
            "msg": serialize_validation_errors(e)
        }), 400
    resp = AdminServices().create_user(valid_res)
    if resp["success"]:
        return jsonify(resp)
    else:
        return jsonify(resp), 400


@admin_bp.get('/users')
def get_users():
    page = int(request.args.get("page", 1))
    count = int(request.args.get("count", current_app.config["DEFAULT_PAGINATION"]))
    users = db.paginate(sa.select(User), page=page, per_page=count)

    return jsonify({
        "success": True,
        "data": {
            "users": [user.to_dict() for user in users],
            "total": users.total,
            "page": users.page,
            "pages": users.pages,
        }
    })

@admin_bp.post('/users/<string:user_id>/deactivate')
def deactivate_user(user_id):
   resp =  AdminServices().deactivate_user(user_id)
   if resp['success'] == False:
       return jsonify(resp), 400
   return jsonify(resp)

@admin_bp.get('/users/<string:user_id>')
def get_user_by_id(user_id):
    user = db.session.scalar(sa.select(User).filter_by(uuid=user_id))
    if not user:
        return jsonify({
            "success": False,
            "msg": "User does not exists"
        }), 400
    return jsonify({
        "success": True,
        "data": {
            "user": user.to_dict()
        }
    })

@admin_bp.post("/users/<string:user_id>/reactivate")
def  reactivate_user(user_id):
    user = db.session.scalar(sa.select(User).filter_by(uuid=user_id))
    msg = None

    if not user:
        return jsonify({"success": False, "msg": "User does not exist"}), 400
    if user.status == UserStatus.PENDING:
        return jsonify({"success": False, "msg": "User is not activated yet, resend activation email instead"}), 400
    if user.status != UserStatus.DEACTIVATED and not user.is_expired:
        return jsonify({"success": False, "msg": "User is already active"}), 400

    req_json = request.get_json(silent=True) or {}
    expiry = req_json.get("expiry_date")
    user.status = UserStatus.ACTIVE
    if expiry:
        expiry_date = datetime.fromisoformat(expiry)
        expiry_date = expiry_date.replace(tzinfo=timezone.utc)
        user.expiry_date = expiry_date
    else:
        user.expiry_date = None

    db.session.commit()
    return jsonify({
        "success": True,
        "msg": "Successfully reactivated user"
    })

@admin_bp.post("/users/<string:user_id>/resend-activation")
def resend_user_activation(user_id):
    user = db.session.scalar(sa.select(User).filter_by(uuid = user_id))
    if not user or user.status != UserStatus.PENDING:
        return jsonify({
            "success": False,
            "msg": "You can only send reactivation email to a valid or pending user"
        }), 400

    AdminServices().send_activation_email(user)
    return jsonify({
        "success": True,
        "msg": "Activation email has been sent to this user"
    })

@admin_bp.post("/users/<string:user_id>/cancel-activation")
def cancel_user_activation(user_id):
    resp = AdminServices().cancel_pending_user_activation(user_id)

    if not resp.get("success"):
        return jsonify(resp), 400
    return jsonify(resp)
