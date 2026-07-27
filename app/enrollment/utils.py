import os
import hashlib
from werkzeug.datastructures import FileStorage
import io
from typing import Union
import base64


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
