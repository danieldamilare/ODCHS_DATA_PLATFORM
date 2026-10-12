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

    if ext == ".csv":
        # Read the first line as text without letting TextIOWrapper close the underlying buffer
        line = file.stream.readline()
        if not line:
            return []
        if isinstance(line, bytes):
            line = line.decode("utf-8-sig", errors="replace")

        # Parse that single line with csv.reader
        row = next(csv.reader([line]), [])
        return row

    elif ext in (".xls", ".xlsx"):
        workbook = CalamineWorkbook.from_filelike(file.stream)
        sheet = workbook.get_sheet_by_index(0)
        try:
            return next(sheet.iter_rows())
        except StopIteration:
            return []

    return []


#
# def read_dataset_header(file: FileStorage) -> List[Any]:
#     ext = get_dataset_type(file)
#     if not ext:
#         return []
#
#     file.stream.seek(0)
#
#     if ext == ".csv":
#         reader = _get_csv_reader(file)
#         try:
#             return next(reader)
#         except StopIteration:
#             return []
#
#     elif ext in (".xls", ".xlsx"):
#         workbook = CalamineWorkbook.from_filelike(file.stream)
#         sheet = workbook.get_sheet_by_index(0)
#         return next(sheet.iter_rows())
#     return []
