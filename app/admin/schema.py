from pydantic import BaseModel, EmailStr, Field, field_validator
from app.auth.models import UserRole, ODCHCScheme
from typing import Optional
from datetime import datetime

class UserValidator(BaseModel):
    first_name: str = Field(..., min_length=3, max_length=25)
    last_name: str = Field(..., min_length=3, max_length=25)
    email: EmailStr
    role: UserRole
    expiry_date: Optional[datetime] = None
    scheme: ODCHCScheme

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str):
        return str(v).lower()