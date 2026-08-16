from flask import Blueprint, jsonify
from flask_jwt_extended import verify_jwt_in_request, get_jwt
from app.auth.models import UserRole

admin_bp = Blueprint('admin', __name__, url_prefix='/api/admin')

@admin_bp.before_request
def must_be_admin():
    verify_jwt_in_request()
    payload = get_jwt()
    role = payload.get("role")
    if role != UserRole.ADMIN.value:
        return jsonify({
            "success": False,
            "msg": "Forbidden: Administrator access required"
        }), 403

from app.admin import routes, cli #noqa