from pydantic import BaseModel, field_validator, BeforeValidator, ConfigDict, model_validator
from typing import Annotated, Any
from datetime import date, datetime
from app.nin_validation.utils import read_dataset_header
import os

from werkzeug.datastructures import FileStorage

def parse_date(v: Any):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        return datetime.strptime(v, "%d/%m/%Y").date()
    raise TypeError("Invalid date")

def load_file_header(file: FileStorage):
    file.stream.seek(0)


class NINValidator(BaseModel):
    dob: Annotated[date, BeforeValidator(parse_date)]
    nin: str

    @field_validator("nin")
    @classmethod
    def validate_nin(cls, nin: str):
        nin = nin.strip()

        if not nin.isdigit() or len(nin) != 11:
            raise ValueError("NIN must contain exactly 11 digits")

        return nin

    @field_validator("dob")
    @classmethod
    def validate_dob(cls, dob: date):
        if dob > date.today():
            raise ValueError("Date of birth cannot be in the future")
        return dob


class NINBatchValidator(BaseModel):
    batch_file: FileStorage
    generate_report: bool = False
    aggregrate_by_lga: bool = False
    model_config = ConfigDict(arbitrary_types_allowed=True)

    @field_validator('batch_file')
    @classmethod
    def validate_batch_file(cls, batch_file: FileStorage):
            file_name = str(batch_file.name)
            ext = os.path.splitext(file_name)[1]
            if ext not in ('xls', 'xlsx', 'csv'):
                raise ValueError("Invalid File")
            return file_name

    @model_validator(mode='after')
    def validate_model(self):
        self.batch_file.stream.seek(0)
        file_name = self.batch_file.file_name
        if not file_name or os.path.splitext(file_name)[1].lower() not in ("csv", "xlsx", "xls"):
            raise ValueError("Invalid File Type")
        try:
            header_value = read_dataset_header(self.batch_file)
        except Exception:
            raise ValueError("Error reading file.")
        if not header_value:
            raise ValueError("Error reading header from file")
        header_set = set(header_value)

        compulsory_set = {'dob', 'nin'}
        option_set = {'dob', 'nin', 'lga', 'ward', 'facility'}
        missing = compulsory_set - header_set
        if missing:
            raise ValueError(f"Columns: {missing} are needed for nin validation submisson")
        if (self.generate_report or self.aggregrate_by_lga) and (missing := option_set - header_set):
            raise ValueError(f"Columns {missing} is missing, and needed for validation and report generation")
        self.batch_file.stream.seek(0)
        return self