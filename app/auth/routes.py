from app import db, kv
from app.auth import auth_bp
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
from app.auth.models import User, UserStatus, UserSession
import sqlalchemy as sa
from flask import current_app, jsonify, request
from app.auth.schema import EmailValidator, LoginValidator
from app.core.utils import serialize_validation_errors
from app.core.tasks import send_email
from pydantic import ValidationError
from datetime import datetime, timezone
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required, set_access_cookies, set_refresh_cookies, get_jwt, unset_jwt_cookies
from uuid import uuid4
from werkzeug.security import check_password_hash

def verify_timed_token(token: str, salt:str, max_age: int):
    serializer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
    try:
        uuid = serializer.loads(token, salt=salt, max_age=max_age)
    except SignatureExpired:
        return None, "The link has expired. Please request a new one"
    except BadSignature:
        return None, "Invalid or corrupted link"
    return uuid, None

def generate_user_tokens(user: User) -> tuple[str, str]:
    tok_jti = str(uuid4())
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)

    refresh_token = create_refresh_token(
        identity=user.uuid,
        additional_claims={"role": role_val, "jti": tok_jti},
    )
    access_token = create_access_token(
        identity=user.uuid,
        additional_claims={"role": role_val},
    )

    user_session = UserSession(tok_jti=tok_jti, user_uuid=user.uuid)
    db.session.add(user_session)
    db.session.commit()
    return access_token, refresh_token

@auth_bp.get("/token/<string:token>")
def verify_token(token: str):
    uuid, err = verify_timed_token(token, salt="account-activation", max_age=48 * 3600)
    if not uuid:
        return jsonify({"success": False, "msg": err}), 400

    user = db.session.scalar(sa.select(User).filter_by(uuid=uuid))
    if user is None or user.status != UserStatus.PENDING:
        return jsonify({
            "success": False,
            "msg": "Account does not exist or has already been activated",
        }), 400

    return jsonify({
        "success": True,
        "msg": "Token is valid",
        "data": {
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
        },
    }), 200


@auth_bp.post("/activate")
def activate_account():
    res = request.get_json(silent=True) or {}
    token = res.get("token")
    password = res.get("password")

    if not token or not password:
        return jsonify({
            "success": False,
            "msg": "Token and password are required",
        }), 400

    uuid, err = verify_timed_token(token, salt="account-activation", max_age=48 * 3600)
    if not uuid:
        return jsonify({"success": False, "msg": err}), 400

    user = db.session.scalar(sa.select(User).filter_by(uuid=uuid))
    if user is None or user.status != UserStatus.PENDING:
        return jsonify({
            "success": False,
            "msg": "Account does not exist or has already been activated",
        }), 400

    if len(password) < 8 or len(password) > 128:
        return jsonify({
            "success": False,
            "msg": "Password must be between 8 and 128 characters long",
        }), 400

    user.set_password(password)
    user.status = UserStatus.ACTIVE
    db.session.commit()

    access_token, refresh_token = generate_user_tokens(user)

    response = jsonify({
        "success": True,
        "msg": "Account activated successfully",
        "user": user.to_dict(),
    })
    set_access_cookies(response, access_token)
    set_refresh_cookies(response, refresh_token)
    return response, 200


@auth_bp.post("/reset")
def request_password_reset():
    try:
        res = EmailValidator.model_validate(request.get_json(silent=True) or {})
    except ValidationError as e:
        return jsonify({
            "success": False,
            "msg": serialize_validation_errors(e),
        }), 400

    serializer = URLSafeTimedSerializer(current_app.config["SECRET_KEY"])
    user = db.session.scalar(sa.select(User).filter_by(email=res.email.lower().strip()))

    if user and user.status == UserStatus.ACTIVE:
        token = serializer.dumps(user.uuid, salt="account-reset")
        frontend_url = current_app.config["FRONTEND_URL"]
        reset_url = f"{frontend_url}/auth/reset-password?token={token}"

        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2>Reset your password</h2>
            <p>Hi {user.first_name},</p>
            <p>We received a request to reset your ODCHC password. Please click the button below to change your password:</p>
            <div style="margin: 30px 0;">
                <a href="{reset_url}" 
                   style="background-color: #2c3e50; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                    Reset Password
                </a>
            </div>
            <p style="color: #666; font-size: 13px;">This link will expire in 3 hours.</p>
            <p style="color: #999; font-size: 12px;">If you didn't request a password reset, you can safely ignore this email.</p>
        </div>
        """
        send_email.delay(user.email, user.first_name, html_content, "[ODCHC] Reset your password")

    return jsonify({
        "success": True,
        "msg": "If an account with that email exists, a password reset link has been sent to your inbox.",
    }), 200


@auth_bp.post("/login")
@jwt_required(optional=True)
def login():
    try:
        res = LoginValidator.model_validate(request.get_json(silent=True) or {})
    except ValidationError as e:
        return jsonify({
            "success": False,
            "msg": serialize_validation_errors(e),
        }), 400

    success, user, msg = User.verify_user(res.email, res.password)
    if not success or not user:
        return jsonify({
            "success": False,
            "msg": msg,
        }), 400
    response  = jsonify({
        "success": True,
        "msg": msg,
        "data": {
            "user": user.to_dict(),
        },
    })
    access_token, refresh_token = generate_user_tokens(user)
    set_access_cookies(response, access_token)
    set_refresh_cookies(response, refresh_token)

    return response, 200

@auth_bp.post("/reset/confirm")
def confirm_password_reset():
    res = request.get_json(silent=True) or {}
    token = res.get("token")
    password = res.get("password")

    if not token or not password:
        return jsonify({
            "success": False,
            "msg": "Token and new password are required",
        }), 400

    uuid, err = verify_timed_token(token, salt="account-reset", max_age=3 * 3600)
    if not uuid:
        return jsonify({"success": False, "msg": err}), 400

    user = db.session.scalar(sa.select(User).filter_by(uuid=uuid))
    if not user or user.status != UserStatus.ACTIVE:
        return jsonify({"success": False, "msg": "Invalid account or account is disabled"}), 400

    if len(password) < 8 or len(password) > 128:
        return jsonify({
            "success": False,
            "msg": "Password must be between 8 and 128 characters long",
        }), 400

    user.set_password(password)
    db.session.execute(sa.delete(UserSession).filter_by(user_uuid=user.uuid))
    db.session.commit()

    return jsonify({
        "success": True,
        "msg": "Password has been successfully updated. You can now log in.",
    }), 200

@auth_bp.post('/logout')
@jwt_required(refresh=True)
def logout():
    payload = get_jwt()
    tok_jti = payload['jti']
    try:
        db.session.execute(sa.delete(UserSession).filter_by(tok_jti = tok_jti))
        db.session.commit()
    except Exception:
        db.session.rollback()

    response = jsonify({
        "success": True,
        "msg": "You've been logged out"
    })
    unset_jwt_cookies(response)
    return response, 200

@auth_bp.post('/refresh')
@jwt_required(refresh=True)
def refresh_token():
    payload = get_jwt()
    tok_jti = payload['jti']
    user_id = payload['sub']
    current_session = db.session.scalar(sa.select(UserSession).filter_by(tok_jti = tok_jti))
    if not current_session:
        db.session.execute(sa.delete(UserSession).filter_by(user_uuid = user_id))
        db.session.commit()
        response = jsonify({
            "success": False,
            "msg": "Invalid Refresh Token. Please log in"
        })
        unset_jwt_cookies(response)
        return response, 400
    user = db.session.scalar(sa.select(User).filter_by(uuid=user_id))
    msg = None
    if not user:
        msg = "Invalid User account"
    elif user.status == UserStatus.DEACTIVATED:
        msg = "Account has been deactivated"
    elif user.is_expired:
        msg = "Account has expired"
    if msg or not user:
        db.session.delete(current_session)
        db.session.commit()
        response = jsonify({
            "success": False,
            "msg": msg
        })
        unset_jwt_cookies(response)
        return response, 400

    access_token, refresh_token = generate_user_tokens(user)

    try:
        db.session.delete(current_session)
        db.session.commit()
    except Exception:
        db.session.rollback()
    response = jsonify({"success": True, "msg": "Successfully refreshed token"})
    set_refresh_cookies(response, refresh_token)
    set_access_cookies(response, access_token)
    return response, 200

@auth_bp.get("/me")
@jwt_required()
def get_current_user():
    payload = get_jwt()
    user_uuid = payload['sub']
    user = db.session.scalar(sa.select(User).filter_by(uuid=user_uuid))
    
    if not user or user.status != UserStatus.ACTIVE:
        return jsonify({"success": False, "msg": "User not found or account disabled"}), 401
        
    return jsonify({
        "success": True,
        "data": {
        "user": user.to_dict()}
    }), 200



@auth_bp.post("/change-password")
@jwt_required()
def change_password():
    payload = get_jwt()
    user_uuid = payload["sub"]
    res = request.get_json(silent=True) or {}
    old_password = res.get("old_password")
    new_password = res.get("new_password")

    if not old_password or not new_password:
        return jsonify({"success": False, "msg": "Old and new passwords are required"}), 400

    user = db.session.scalar(sa.select(User).filter_by(uuid=user_uuid))
    if not user or not check_password_hash(user.password_hash, old_password):
        return jsonify({"success": False, "msg": "Current password is incorrect"}), 400

    if len(new_password) < 8 or len(new_password) > 128:
        return jsonify({"success": False, "msg": "Password must be 8-128 characters"}), 400

    user.set_password(new_password)
    db.session.execute(sa.delete(UserSession).filter_by(user_uuid=user.uuid))
    db.session.commit()

    return jsonify({"success": True, "msg": "Password updated successfully"}), 200