from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Optional, List
from werkzeug.datastructures import FileStorage


class BatchUploader(BaseModel):
    batch_file: FileStorage
    lga_no: Optional[int] = None
    ward_no: Optional[int] = None
    facility_no: Optional[int] = None

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @field_validator("batch_file")
    @classmethod
    def validate_file(cls, file: FileStorage):
        file_name = file.filename
        if not file_name:
            raise ValueError("No file was uploaded")
        if not file_name.lower().endswith(".zip"):
            raise ValueError("Invalid file format. File type must be ZIP")
        file.seek(0)
        if file.stream.read(4) != b"\x50\x4B\x03\x04":
            raise ValueError("Invalid ZIP file!")
        file.seek(0)
        return file
