import json
import os
import shutil
import tempfile

import pytest

# Must be set before backend.db (and anything importing it) is loaded, so the
# test suite never touches the real config/arynwood.db - that file holds live
# conversations, memories, and deploy_target credentials.
_tmp_db_fd, _tmp_db_path = tempfile.mkstemp(prefix="arynwood_test_", suffix=".db")
os.close(_tmp_db_fd)
os.environ["ARYNWOOD_DB_PATH"] = _tmp_db_path
os.environ["ARYNWOOD_DISABLE_BACKGROUND_INDEX"] = "1"

# Same for the gateway: its file memory defaults to ~/.local/share/arynwood-mcp/memory, the
# user's real MEMORY.md, and its overlay to their real gateway.json. Point both somewhere
# throwaway (a test that wants its own overlay still sets ARYNWOOD_GATEWAY_CONFIG itself).
_tmp_gateway_dir = tempfile.mkdtemp(prefix="arynwood_test_gateway_")
_tmp_gateway_overlay = os.path.join(_tmp_gateway_dir, "gateway.json")
with open(_tmp_gateway_overlay, "w") as _f:
    json.dump({"file_memory": {"dir": os.path.join(_tmp_gateway_dir, "memory")}}, _f)
os.environ["ARYNWOOD_GATEWAY_CONFIG"] = _tmp_gateway_overlay


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from backend.api import app

    class LocalTestClient(TestClient):
        def websocket_connect(self, url, *args, **kwargs):
            # Starlette hardcodes ws://testserver for relative WebSocket URLs,
            # independently of base_url. Exercise the real loopback Host policy.
            if url.startswith("/"):
                url = "ws://localhost" + url
            return super().websocket_connect(url, *args, **kwargs)

    with LocalTestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000)) as c:
        yield c


def pytest_sessionfinish(session, exitstatus):
    try:
        os.remove(_tmp_db_path)
    except OSError:
        pass
    shutil.rmtree(_tmp_gateway_dir, ignore_errors=True)
