from pydantic import BaseModel, EmailStr, Field, field_validator

class EmailValidator(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str):
        return str(v).lower()

class LoginValidator(EmailValidator):
    password: str = Field(min_length=8, max_length=128)