from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator, ConfigDict
from werkzeug.datastructures import FileStorage
from app.enrollment.utils import validate_zip_file


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


class BatchUploader(BaseModel):
    batch_file: FileStorage
    lga_no: Optional[int] = None
    ward_no: Optional[int] = None
    facility_no: Optional[int] = None

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @field_validator("batch_file")
    @classmethod
    def validate_file(cls, file: FileStorage):
        return validate_zip_file(file)
