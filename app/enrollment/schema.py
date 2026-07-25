from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field


class MaritalStatusEnum(str, Enum):
    DIVORCED = "Divorced"
    MARRIED = "Married"
    SINGLE = "Single"
    WIDOW = "Widow"


class Gender(str, Enum):
    MALE = "Male"
    FEMALE = "Female"


class NextOfKin(BaseModel):
    first_name: str = ""
    surname: str = ""
    other_name: Optional[str] = ""
    relationship: str = ""
    phone_number: str = ""
    address: str = ""


class OCRResponse(BaseModel):
    surname: str = ""
    first_name: str = ""
    other_name: Optional[str] = ""
    dob: str = Field(default="", description="Format: MM-DD-YYYY")
    marital_status: Optional[MaritalStatusEnum] = None
    address: str = ""
    gender: Optional[Gender]
    phone_number: str = ""
    nin: str = ""
    next_of_kin: Optional[NextOfKin] = None
