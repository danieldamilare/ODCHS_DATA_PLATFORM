from python_calamine import CalamineWorkbook
from typing import List, Any, Optional, Tuple
from collections.abc import Iterable
from werkzeug.datastructures import FileStorage
import os
import io
import csv


def get_dataset_type(file: FileStorage) -> Optional[str]:
    file_name = file.filename
    if not file_name:
        return None
    ext = os.path.splitext(file_name)[1].lower()
    return ext


def _get_csv_reader(file: FileStorage) -> Iterable[Tuple[int, List[Any]]]:
    text_stream = io.TextIOWrapper(file.stream, encoding="utf-8")
    reader = csv.reader(text_stream)
    return enumerate(reader)


def read_dataset_header(file: FileStorage) -> List[Any]:
    ext = get_dataset_type(file)
    if not ext:
        return []

    file.stream.seek(0)

    if ext == "csv":
        reader = _get_csv_reader(file)
        try:
            return next(reader)
        except StopIteration:
            return []

    elif ext in ("xls", "xlsx"):
        workbook = CalamineWorkbook.from_filelike(file.stream)
        sheet = workbook.get_sheet_by_index(0)
        return next(sheet.iter_rows())
    return []
