import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import io
import zipfile
import pytest
from werkzeug.datastructures import FileStorage
from unittest.mock import MagicMock, patch

from app.enrollment.services import BatchServices


@pytest.fixture
def service():
    return BatchServices()


@pytest.fixture
def zip_file():
    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("passport.jpg", b"fake image")

    buffer.seek(0)

    return FileStorage(
        stream=buffer,
        filename="forms.zip",
        content_type="application/zip",
    )


@patch("app.enrollment.services.batches.db")
@patch("app.enrollment.services.batches.extract_zip_for_processing.delay")
@patch("app.enrollment.services.batches.kv")
@patch("app.enrollment.services.batches.compute_hash")
@patch("app.enrollment.services.batches.get_loader")
def test_create_job_success(
    mock_loader,
    mock_hash,
    mock_kv,
    mock_delay,
    mock_db,
    service,
    zip_file,
    app,
):
    mock_db.session.scalar.return_value = None
    mock_hash.return_value = "abc123"

    mock_loader.return_value.state_code = "01"
    mock_loader.return_value.plan_id = 100

    with app.app_context():
        result = service.create_job(
            1,
            2,
            3,
            zip_file,
        )

    assert result.status == "created"

    mock_delay.assert_called_once()

    mock_kv.hset.assert_called_once()


@patch("app.enrollment.services.batches.get_loader")
@patch("app.enrollment.services.batches.db")
@patch("app.enrollment.services.batches.compute_hash")
def test_duplicate_batch(
    mock_hash,
    mock_db,
    mock_get_loader,
    service,
    zip_file,
):
    existing = MagicMock(name=mock_get_loader)

    mock_hash.return_value = "hash"

    mock_db.session.scalar.return_value = existing

    result = service.create_job(
        1,
        2,
        3,
        zip_file,
    )

    assert result.status == "duplicate"
    assert result.batch == existing


def test_empty_zip(service, app):
    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, "w"):
        pass

    buffer.seek(0)

    file = FileStorage(
        stream=buffer,
        filename="empty.zip",
    )

    with app.app_context():
        result = service.create_job(
            1,
            2,
            3,
            file,
        )

    assert result.status == "empty_zip"


@patch("os.makedirs")
def test_save_failed(
    mock_mkdir,
    service,
    zip_file,
    app,
):
    zip_file.save = MagicMock(side_effect=OSError)

    with app.app_context():
        result = service.create_job(
            1,
            2,
            3,
            zip_file,
        )

    assert result.status == "save_failed"
