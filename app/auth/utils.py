from functools import wraps
from flask import g, jsonify
from flask_jwt_extended import verify_jwt_in_request, get_jwt
import sqlalchemy as sa
from app import db
from app.auth.models import User, UserStatus

def get_current_user():
    """
    Call only inside a request already covered by @login_required
    (or after verify_jwt_in_request()). Caches on flask.g per-request
    so repeated calls don't re-hit the DB.
    """
    if "current_user" in g:
        return g.current_user

    payload = get_jwt()
    user_uuid = payload.get("sub")
    user = db.session.scalar(sa.select(User).filter_by(uuid=user_uuid))
    g.current_user = user
    return user


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        user = get_current_user()
        if not user or user.status != UserStatus.ACTIVE:
            return jsonify({"success": False, "msg": "User not found"}), 401
        return fn(*args, **kwargs)
    return wrapper
