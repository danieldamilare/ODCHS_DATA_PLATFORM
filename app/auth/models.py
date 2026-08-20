from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Tuple
from uuid import uuid4
import sqlalchemy as sa
from werkzeug.security import check_password_hash, generate_password_hash

from app import db


class UserRole(str, Enum):
    ADMIN = "admin"
    USER = "user"


class UserStatus(str, Enum):
    ACTIVE = "active"
    PENDING = "pending"
    DEACTIVATED = "deactivated"


class User(db.Model):
    __tablename__ = "user"

    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(
        db.String(36),
        unique=True,
        default=lambda: str(uuid4()),
        nullable=False,
        index=True,
    )
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=True)
    status = db.Column(db.Enum(UserStatus), default=UserStatus.PENDING, nullable=False)
    role = db.Column(db.Enum(UserRole), default=UserRole.USER, nullable=False)

    expiry_date = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_login = db.Column(db.DateTime(timezone=True), nullable=True)

    def to_dict(self, include_sensitive: bool = False) -> dict:
        data = {
            "id": self.id,
            "uuid": self.uuid,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "email": self.email,
            "status": self.status.value if self.status else None,
            "role": self.role.value if self.role else None,
            "expiry_date": self.expiry_date.isoformat() if self.expiry_date else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_login": self.last_login.isoformat() if self.last_login else None,
        }
        if include_sensitive:
            data["password_hash"] = self.password_hash
        return data

    @property
    def is_expired(self):
        if self.expiry_date:
            expiry = self.expiry_date
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            return expiry < datetime.now(timezone.utc)
        return False

    @classmethod
    def verify_user(
        cls, email: str, password: str
    ) -> Tuple[bool, Optional["User"], str]:
        _DUMMY_HASH = "pbkdf2:sha256:260000$dummy$00000000000000000000000000000000"

        user = db.session.scalar(sa.select(cls).filter_by(email=email.lower().strip()))

        if not user or not user.password_hash:
            check_password_hash(_DUMMY_HASH, password)
            return False, None, "Invalid email or password"

        if not check_password_hash(user.password_hash, password):
            return False, None, "Invalid email or password"

        if user.status == UserStatus.PENDING:
            return (
                False,
                None,
                "Account has not been activated. Please check your email or contact an administrator.",
            )

        if user.status == UserStatus.DEACTIVATED:
            return (
                False,
                None,
                "Your account has been deactivated. Contact an administrator to reactivate.",
            )

        if user.is_expired:
            return False, None, "Account has expired"

        return True, user, "Authentication successful"

    def set_password(self, password: str) -> "User":
        self.password_hash = generate_password_hash(password)
        return self


class UserSession(db.Model):
    __tablename__ = "user_sessions"

    id = db.Column(db.Integer, primary_key=True)
    tok_jti = db.Column(db.String(255), unique=True, nullable=False, index=True)
    user_uuid = db.Column(
        db.String(36),
        db.ForeignKey("user.uuid", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

