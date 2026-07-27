from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator, ConfigDict
from werkzeug.datastructures import FileStorage
from app.enrollment.utils import validate_zip_file
from app.enrollment.utils import is_image_extension


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


class FormPassPortUploader(BaseModel):
    passport: FileStorage
    model_config = ConfigDict(arbitrary_types_allowed=True)

    @field_validator("passport")
    @classmethod
    def validate_passport_image(cls, file: FileStorage):
        if file and is_image_extension(file.filename):
            return file
        raise ValueError("File is not a valid image object")


class FormUpdater(BaseModel):
    title: Optional[str] = None
    surname: Optional[str] = None
    firstname: Optional[str] = None
    othername: Optional[str] = None
    dob: Optional[str] = None
    settlement: Optional[str] = None
    gender: Optional[str] = None
    phone_number: Optional[str] = None
    nin: Optional[str] = None
    address: Optional[str] = None
    category: Optional[int] = None
    marital_status: Optional[int] = None
    occupation: Optional[str] = None
    genotype: Optional[str] = None
    medical_history: Optional[str] = None
    kin_firstname: Optional[str] = None
    kin_surname: Optional[str] = None
    kin_othername: Optional[str] = None
    kin_relationship: Optional[str] = None
    kin_phone_number: Optional[str] = None
    kin_address: Optional[str] = None
    passport_xmin: Optional[int] = None
    passport_ymin: Optional[int] = None
    passport_xmax: Optional[int] = None
    passport_ymax: Optional[int] = None
    lga_no: Optional[int] = None
    ward_no: Optional[int] = None
    facility_no: Optional[int] = None
    passport_path: Optional[str] = None

    def get_updates(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v is not None}
