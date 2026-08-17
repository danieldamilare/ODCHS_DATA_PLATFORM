from pydantic import BaseModel, ConfigDict, field_validator
from werkzeug.datastructures import FileStorage
from app.core.utils import validate_zip_file
from typing import Literal
import os


class EncounterValidator(BaseModel):
    encounter_file: FileStorage
    encounter_type: Literal["oranghis", "bhcpf"]
    chai_only: bool
    model_config = ConfigDict(arbitrary_types_allowed=True)

    @field_validator("encounter_file")
    @classmethod
    def validate_encounter_file(cls, encounter_file: FileStorage):
        file_name = str(encounter_file.filename or "")
        if file_name.endswith(".zip"):
            return validate_zip_file(encounter_file)
        elif os.path.splitext(file_name)[1].lower() not in [
            ".xlsx",
            ".xls",
            ".csv",
            ".ods",
        ]:
            raise ValueError(
                "Invalid File type. Please upload a spreadsheet or a zip file"
            )
        return encounter_file
