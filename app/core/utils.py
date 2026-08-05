import hashlib
from werkzeug.datastructures import FileStorage
from pydantic import ValidationError
from typing import Optional


def compute_hash(file: FileStorage):
    file.seek(0)
    file_hash = hashlib.sha256(file.read()).hexdigest()
    file.seek(0)
    return file_hash


def validate_zip_file(file: FileStorage) -> FileStorage:
    """Validates that an uploaded file is a genuine ZIP archive by checking its magic numbers."""
    file_name = file.filename
    if not file_name:
        raise ValueError("No file was uploaded")

    if not file_name.lower().endswith(".zip"):
        raise ValueError("Invalid file format. File type must be ZIP")

    file.seek(0)
    magic_bytes = file.stream.read(4)
    file.seek(0)

    if magic_bytes != b"\x50\x4B\x03\x04":
        raise ValueError("Invalid ZIP file content structure")

    return file


def serialize_validation_errors(e: ValidationError) -> str:
    return "; ".join(err["msg"] for err in e.errors(include_url=False))

def parse_opt_int(val: Optional[str]) -> Optional[int]:
    """Helper to convert form strings to int or None."""
    if val is None or val.strip() == "":
        return None
    return int(val)