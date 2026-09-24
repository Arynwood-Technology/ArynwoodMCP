import os
import tempfile

import pytest

# Must be set before backend.db (and anything importing it) is loaded, so the
# test suite never touches the real config/arynwood.db - that file holds live
# conversations, memories, and deploy_target credentials.
_tmp_db_fd, _tmp_db_path = tempfile.mkstemp(prefix="arynwood_test_", suffix=".db")
os.close(_tmp_db_fd)
os.environ["ARYNWOOD_DB_PATH"] = _tmp_db_path
os.environ["ARYNWOOD_DISABLE_BACKGROUND_INDEX"] = "1"


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from backend.api import app

    with TestClient(app) as c:
        yield c


def pytest_sessionfinish(session, exitstatus):
    try:
        os.remove(_tmp_db_path)
    except OSError:
        pass
