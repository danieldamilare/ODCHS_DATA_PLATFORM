import os
import hashlib
from werkzeug.datastructures import FileStorage
from pydantic import ValidationError
from flask import current_app


def compute_hash(file: FileStorage):
    file.seek(0)
    file_hash = hashlib.sha256(file.read()).hexdigest()
    file.seek(0)
    return file_hash


def is_image_extension(file_path):
    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff", ".tif"}
    _, ext = os.path.splitext(file_path)
    return ext.lower() in image_extensions


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


def generate_id_card_path(uuid: str, first_name: str, other_name: str, surname: str):
    filename = first_name
    if other_name:
        filename += "_" if filename else ""
        filename += other_name
    if surname:
        filename += "_" if filename else ""
        filename += surname
    filename += "_" if filename else ""
    filename += uuid
    filename += ".png"

    path = os.path.join(current_app.config["FORM_PATH"], "id_card", uuid, filename)
    return path
