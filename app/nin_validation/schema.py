from pydantic import (
    BaseModel,
    field_validator,
    BeforeValidator,
    ConfigDict,
    model_validator,
)
from typing import Annotated, Any
from datetime import date, datetime
from app.nin_validation.utils import read_dataset_header
from dateutil import parser
import os

from werkzeug.datastructures import FileStorage


def parse_date(v: Any):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        return parser.parse(v).date()
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
    aggregate_by_lga_ward: bool = False
    aggregate_by_lga_facility: bool = False
    model_config = ConfigDict(arbitrary_types_allowed=True)

    @model_validator(mode="after")
    def validate_model(self):
        self.batch_file.stream.seek(0)
        file_name = self.batch_file.filename

        if not file_name or os.path.splitext(file_name)[1].lower() not in (
            ".csv",
            ".xlsx",
            ".xls",
        ):
            raise ValueError("Invalid File Type. Please upload an excel or csv file")

        if self.aggregate_by_lga_facility and self.aggregate_by_lga_ward:
            raise ValueError(
                "You cannot breakdown by facility and ward at the same time. Please select one"
            )

        try:
            header_value = read_dataset_header(self.batch_file)
            print("header_value", header_value)
        except Exception:
            raise ValueError("Error reading file.")
        if not header_value:
            raise ValueError("Error reading header from file")
        header_set = set(str(h).strip().lower() for h in header_value)

        compulsory_set = {"dob", "nin"}
        option_set = {"dob", "nin", "lga"}
        missing = compulsory_set - header_set
        if missing:
            raise ValueError(
                f"Columns: {missing} are needed for nin validation submisson"
            )

        if (self.generate_report
            or self.aggregate_by_lga_facility
            or self.aggregate_by_lga_ward): 

            if (missing := option_set - header_set):
                raise ValueError(
                    f"Columns {list(missing)} is missing, and needed for validation and report generation"
                )

            if self.aggregate_by_lga_ward or self.aggregate_by_lga_facility:
                needed = "ward" if self.aggregate_by_lga_ward else "facility"
                if needed not in header_set:
                    raise ValueError(f"Column [{needed}] is missing and is needed for your breakdown")

        self.batch_file.stream.seek(0)
        return self
