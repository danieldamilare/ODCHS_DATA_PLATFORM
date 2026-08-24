from enum import Enum
from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator, ConfigDict, model_validator
from werkzeug.datastructures import FileStorage
from app.core.utils import validate_zip_file
from app.enrollment.utils import is_image_extension
from app.nin_validation.nin_client import load_nin_client
from dateutil import parser


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
    gender: Optional[Gender] = None
    phone_number: str = ""
    category: str = ""
    occupation: str = ""
    nin: str = ""
    next_of_kin: Optional[NextOfKin] = None

    @field_validator("surname", "first_name", "other_name", mode="after")
    @classmethod
    def reject_absurd_length(cls, v):
        if v and len(v) > 50:
            raise ValueError(
                f"Field value implausibly long ({len(v)} chars) — likely extraction failure"
            )
        return v


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
    title: str
    surname: str
    firstname: str
    othername: Optional[str] = None
    dob: str
    settlement: Literal["Urban", "Rural"]
    gender: Literal["Male", "Female"]
    phone_number: str
    nin: str
    nin_verified: Optional[bool] = False
    address: str
    category: int
    marital_status: str
    occupation: Optional[str] = None
    kin_firstname: str
    kin_surname: str
    kin_othername: Optional[str] = None
    kin_relationship: str
    kin_phone_number: str
    kin_address: str
    passport_xmin: Optional[int] = None
    passport_ymin: Optional[int] = None
    passport_xmax: Optional[int] = None
    passport_ymax: Optional[int] = None
    lga_no: int
    ward_no: int
    facility_no: int
    passport_path: Optional[str] = None
    use_avatar: Optional[bool] = False
    rotate_angle: Optional[int] = None

    @field_validator("nin")
    @classmethod
    def validate_nin(cls, nin: str):
        if nin.isdigit() and len(nin) == 11:
            return nin
        raise ValueError("Invalid Nin provided")

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, phone_number: str):
        # frontend always provide leading prefix
        if not phone_number.startswith("+234"):
            raise ValueError("Invalid Phone number: Phone number must starts with +234")
        if not phone_number[1:].isdigit():
            raise ValueError("Phone number must all be digit")
        if len(phone_number) != 14:
            raise ValueError("Incomplete Phone number")
        return phone_number

    @field_validator("rotate_angle")
    @classmethod
    def validate_rotate_angle(cls, rotate_angle: Optional[int]):
        if rotate_angle is None:
            return rotate_angle
        if rotate_angle not in (90, 180, 270):
            raise ValueError("Invalid rotation angle")
        return rotate_angle

    @model_validator(mode="after")
    def validate_model(self):
        client = load_nin_client()
        if self.nin_verified:
            dob = parser.parse(self.dob).date()
            result = client.validate_nin(dob, self.nin)
            if not result.success:
                raise ValueError("NIN is not valid")
        return self

    def get_updates(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v is not None}
