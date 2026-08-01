import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest
from app import create_app


@pytest.fixture
def app():
    app = create_app()

    app.config.update(
        TESTING=True,
    )

    yield app
