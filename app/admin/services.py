from app.auth.models import User, UserStatus
from app.admin.schema import UserValidator 
from app.core.tasks import send_email
from app import db
from itsdangerous import URLSafeTimedSerializer
from flask import current_app
import sqlalchemy as sa
from flask_jwt_extended import get_jwt

class AdminServices:
    def create_user(self, res: UserValidator):
        # In AdminServices.create_user:
        existing_user = db.session.scalar(sa.select(User).filter_by(email=res.email))
        if existing_user:
            return {"success": False, "msg": "A user with this email already exists"}

        new_user = User(
            first_name = res.first_name.strip().capitalize(),
            last_name= res.last_name.strip().capitalize(),
            email = res.email,
            role = res.role
        )


        if res.expiry_date:
            new_user.expiry_date = res.expiry_date

        db.session.add(new_user)
        db.session.commit()
        return self.send_activation_email(new_user)

    def generate_activation_token(self, user: User):
        serializer = URLSafeTimedSerializer(current_app.config["SECRET_KEY"])
        return serializer.dumps(user.uuid, salt="account-activation")

    def send_activation_email(self, user: User):
        token = self.generate_activation_token(user)
        frontend_url = current_app.config['FRONTEND_URL']
        activation_url = f"{frontend_url}/auth/activate?token={token}"

        html_content = f"""
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Welcome to ODCHS Data Platform, {user.first_name}!</h2>
    <p>An administrator has created an account for you. Please click the button below to set your password and activate your account:</p>
    <div style="margin: 30px 0;">
        <a href="{activation_url}" 
            style="background-color: #2c3e50; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            Activate My Account
        </a>
    </div>
    <p style="color: #666; font-size: 13px;">This activation link will expire in 48 hours.</p>
    <p style="color: #999; font-size: 12px;">If you did not request this invitation, please ignore this email.</p>
</div>
"""
        try:
            send_email.delay(user.email, user.first_name, html_content, "[ODCHS] Activate your ODCHC Account")
            return {"success": True, "msg": "User Created, An activation email would be sent shortly"}
        except Exception as e:
            return {"success": False, "msg": str(e)}


    def deactivate_user(self, user_id):
        payload = get_jwt()
        if payload.get("sub") == user_id:
            return {"success": False, "msg": "You cannot deactivate yourself"}

        user = db.session.scalar(sa.select(User).filter_by(uuid=user_id))
        if not user:
            return {"success": False, "msg": "You cannot deactivate a user that does not exists"}
        user.status = UserStatus.DEACTIVATED
        db.session.commit()
        return {"success": True, "msg": f"Successfully deactivated user {user.first_name}"}

    def cancel_pending_user_activation(self, user_uuid: str) -> dict:
        user = db.session.scalar(sa.select(User).filter_by(uuid=user_uuid))
        if not user:
            return {"success": False, "msg": "User does not exist"}

        if user.status != UserStatus.PENDING:
            return {"success": False, "msg": "Cannot cancel invitation for an active or already deactivated user"}

        db.session.delete(user)
        db.session.commit()

        return {"success": True, "msg": "Activation has been cancelled, and user has been deleted"}