import pytest

from backend.services import spreadsheet_gen as sg


@pytest.fixture(autouse=True)
def _isolated_output_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(sg, "_OUTPUT_DIR", str(tmp_path))


def test_download_generated_spreadsheet(client):
    filename, _ = sg.build_spreadsheet(title="X", headers=["A"], rows=[[1]])
    r = client.get(f"/api/tools/spreadsheets/{filename}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert len(r.content) > 0


def test_download_missing_file_404s(client):
    r = client.get("/api/tools/spreadsheets/does_not_exist.xlsx")
    assert r.status_code == 404


def test_download_rejects_path_traversal(client):
    r = client.get("/api/tools/spreadsheets/..%2F..%2Fetc%2Fpasswd")
    assert r.status_code in (404, 400)
