import re
import hashlib
from werkzeug.datastructures import FileStorage
import os

from deepface import DeepFace


def compute_hash(file: FileStorage):
    file.seek(0)
    file_hash = hashlib.sha256(file.read()).hexdigest()
    file.seek(0)
    return file_hash


def is_image_extension(file_path):
    image_extensions = {
        ".jpg",
        ".jpeg",
        ".png",
        ".bmp",
        ".webp",
        ".tiff",
        ".tif",
    }
    _, ext = os.path.splitext(file_path)
    return ext.lower() in image_extensions
