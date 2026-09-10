"""backend/routers/fs.py's project-root browsing (/tree, /read, /ls) is a "browse
this app's own source tree" feature that's meaningless in a packaged (PyInstaller
frozen) build — there's no project to browse, just the bundle's temp extraction
dir. It should refuse clearly (501) rather than silently browse that temp dir.
browse-home (a separate, unrelated feature — Design Center's save-to-folder
dialog, sandboxed to the user's home directory) must keep working regardless."""
import sys

import pytest


@pytest.fixture()
def frozen(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", "/tmp/fake-meipass", raising=False)


def test_project_browsing_refused_when_frozen(client, frozen):
    for endpoint, params in [
        ("/api/fs/tree", {"path": "."}),
        ("/api/fs/read", {"path": "README.md"}),
        ("/api/fs/ls", {"path": "."}),
    ]:
        r = client.get(endpoint, params=params)
        assert r.status_code == 501, f"{endpoint} should refuse when frozen, got {r.status_code}"
        assert "packaged build" in r.json()["detail"]


def test_project_browsing_works_when_not_frozen(client):
    r = client.get("/api/fs/ls", params={"path": "."})
    assert r.status_code == 200


def test_browse_home_unaffected_by_frozen(client, frozen):
    r = client.get("/api/fs/browse-home", params={"path": "~"})
    assert r.status_code == 200
