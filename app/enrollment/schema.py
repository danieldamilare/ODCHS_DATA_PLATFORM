from enum import Enum
from typing import Optional, Literal, List
from pydantic import BaseModel, Field, field_validator, ConfigDict, model_validator
from werkzeug.datastructures import FileStorage
from app.core.utils import validate_zip_file
from app.enrollment.utils import is_image_extension
from app.enrollment.models import ODCHCScheme
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

class Dependants(BaseModel):
    name: str = ""
    dob: str = ""
    phone_number: str = ""
    gender: Optional[Gender] = None
    preferred_hospital: str = ""
    existing_ailment: str = ""
    is_spouse: Optional[bool] = False

class OCRResponse(BaseModel):
    surname: str = Field(default="", description="Enrollee surname/last name. Empty string if blank.")
    first_name: str = Field(default="", description="Enrollee first name. Empty string if blank.")
    other_name: str = Field(default="", description="Enrollee middle/other name. Empty string if blank.")
    dob: str = Field(default="", description="Date of birth formatted as MM-DD-YYYY. Empty string if unreadable or blank.")
    marital_status: Optional[MaritalStatusEnum] = Field(
        default=None, description="Marital status. Null if none selected or blank."
    )
    address: str = Field(default="", description="Residential home address. Empty string if blank.")
    gender: Optional[Gender] = Field(default=None, description="Gender (Male or Female). Null if blank.")
    phone_number: str = Field(default="", description="Phone number digits only. Empty string if blank.")
    category: str = Field(
        default="",
        description="The category checkbox that is explicitly ticked on the form. Return an empty string if NO checkbox is ticked.",
    )
    occupation: str = Field(
        default="",
        description="The occupation checkbox ticked or custom occupation written. Return an empty string if blank or unticked.",
    )
    nin: str = Field(default="", description="The written National Identity Number. Empty string if blank.")
    next_of_kin: Optional[NextOfKin] = None

    # additional response for formal form
    existing_ailment: str = Field(default="", description="Enrollee Existing ailment. Empty sting value is blank or not exists on form")
    preferred_hospital: str = Field(default="", description="Enrollee Choosen preferred hospital, this is related tot eh local govertment area selected. Empty string value if blank or not exists on form")
    employment_id: str = Field(default="", description="Enrollee employment id. Empty sting value is blank or not exists on form")
    present_mda: str = Field(default="", description="Enrollee present MDA. Empty sting value is blank or not exists on form")
    department: str = Field(default="", description="Enrollee present MDA. Empty sting value is blank or not exists on form")
    cadre: str = Field(default="", description="Enrollee Cadrre. Empty sting value is blank or not exists on form")

    dependants: Optional[List[Dependants]] = None


    @field_validator("surname", "first_name", "other_name", mode="after")
    @classmethod
    def reject_absurd_length(cls, v: Optional[str]) -> str:
        if v is None:
            return ""
        if len(v) > 50:
            raise ValueError(
                f"Field value implausibly long ({len(v)} chars) — likely extraction failure"
            )
        return v


class BatchUploader(BaseModel):
    batch_file: FileStorage
    lga_no: Optional[int] = None
    ward_no: Optional[int] = None
    facility_no: Optional[int] = None
    name: str = ""
    scheme: Optional[ODCHCScheme] = None
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
    model_config = ConfigDict(extra="ignore")

    title: str
    surname: str
    firstname: str
    othername: Optional[str] = None
    dob: str
    settlement: Optional[str] = None
    gender: Literal["Male", "Female"]
    phone_number: str
    nin: Optional[str] = None
    nin_verified: Optional[bool] = False
    address: str
    category: Optional[int] = None
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
    lga_no: Optional[int] = None
    ward_no: Optional[int] = None
    facility_no: Optional[int] = None
    scheme: Optional[ODCHCScheme] = None
    passport_path: Optional[str] = None
    use_avatar: Optional[bool] = False
    rotate_angle: Optional[int] = None
    enployment_id: Optional[str] = None
    ext_aliment: Optional[str] = None
    present_mda: Optional[str] = None
    department: Optional[str] = None
    cadre: Optional[str] = None
    dependants: Optional[list[dict]] = None

    @field_validator(
        "category",
        "ward_no",
        "lga_no",
        "facility_no",
        "passport_xmin",
        "passport_ymin",
        "passport_xmax",
        "passport_ymax",
        "rotate_angle",
        mode="before",
    )
    @classmethod
    def coerce_empty_ints(cls, v):
        if v is None or v == "":
            return None
        if isinstance(v, str) and v.strip().isdigit():
            return int(v.strip())
        return v

    @field_validator("scheme", mode="before")
    @classmethod
    def coerce_scheme(cls, v):
        if not v:
            return None
        if isinstance(v, str):
            v_lower = v.strip().lower()
            for s in ODCHCScheme:
                if s.value == v_lower or s.name.lower() == v_lower:
                    return s
        return v

    @field_validator("nin")
    @classmethod
    def validate_nin(cls, nin: Optional[str]):
        if not nin:
            return nin
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
        if self.scheme == ODCHCScheme.BHCPFP:
            if not self.ward_no:
                raise ValueError("Ward is required for BHCPF scheme")
            if not self.settlement:
                raise ValueError("Settlement is required for BHCPF scheme")
            if self.settlement not in ("Urban", "Rural"):
                raise ValueError("Settlement must be Urban or Rural")
            if self.category is None:
                raise ValueError("Category is required for BHCPF scheme")
            if not self.nin:
                raise ValueError("NIN is required for BHCPF scheme")
            if self.nin_verified:
                client = load_nin_client()
                dob = parser.parse(self.dob).date()
                result = client.validate_nin(dob, self.nin)
                if not result.success:
                    raise ValueError("NIN is not valid")
        return self

    def get_updates(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v is not None}
    
class DependantsUpdater(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sequence: int
    form_id: str
    dpd_name: str
    dpd_dob: str
    dpd_gender: Literal["Male", "Female"]
    dpd_phone_number: str
    dpd_medical_history: str
    dpd_lga_no: Optional[int] = None
    dpd_facility_no: Optional[int] = None
    is_spouse: Optional[bool] = False
    passport_xmin: Optional[int] = None
    passport_ymin: Optional[int] = None
    passport_xmax: Optional[int] = None
    passport_ymax: Optional[int] = None
    passport_path: Optional[str] = None
    use_avatar: Optional[bool] = False
    rotate_angle: Optional[int] = None

    @field_validator(
        "dpd_lga_no",
        "dpd_facility_no",
        "passport_xmin",
        "passport_ymin",
        "passport_xmax",
        "passport_ymax",
        "rotate_angle",
        mode="before",
    )
    @classmethod
    def coerce_dpd_empty_ints(cls, v):
        if v is None or v == "":
            return None
        if isinstance(v, str) and v.strip().isdigit():
            return int(v.strip())
        return v

    @field_validator("dpd_phone_number")
    @classmethod
    def validate_dpd_phone_number(cls, dpd_phone_number: str):
        # frontend always provide leading prefix
        if not dpd_phone_number.startswith("+234"):
            raise ValueError("Invalid Phone number: Phone number must starts with +234")
        if not dpd_phone_number[1:].isdigit():
            raise ValueError("Phone number must all be digit")
        if len(dpd_phone_number) != 14:
            raise ValueError("Incomplete Phone number")
        return dpd_phone_number

    @field_validator("rotate_angle")
    @classmethod
    def validate_rotate_angle(cls, rotate_angle: Optional[int]):
        if rotate_angle is None:
            return rotate_angle
        if rotate_angle not in (90, 180, 270):
            raise ValueError("Invalid rotation angle")
        return rotate_angle

    def get_updates(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v is not None}

