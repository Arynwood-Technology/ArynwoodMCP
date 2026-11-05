"""/html-tools serves the bundled static pages. It sits outside the /api auth gate, so it must
never serve anything else: an encoded `..%2F` or an absolute path used to read any file the
backend could, e.g. the database or files in the user's home directory."""
import pytest


def test_serves_a_page_and_its_fonts(client):
    assert client.get("/html-tools/terminal.html").status_code == 200
    assert client.get("/html-tools/fonts/fonts.css").status_code == 200


@pytest.mark.parametrize("path", [
    "/html-tools/..%2F..%2Fbackend%2Fapi.py",
    "/html-tools/%2e%2e/%2e%2e/backend/api.py",
    "/html-tools/..%2f..%2fREADME.md",
    "/html-tools/%2Fetc%2Fpasswd",
    "/html-tools/fonts/..%2F..%2F..%2Fbackend%2Fapi.py",
])
def test_nothing_outside_the_folder(client, path):
    assert client.get(path).status_code == 404


def test_design_center_downloads_go_through_the_app_window():
    """The desktop web view drops a download started in an html-tool's frame (another origin than the window),
    so Design Center and Client Intake post it to the window, which saves it (frontend/src/lib/frameDownloads.ts).
    Both sides must use the same message type, and neither page may go back to a bare download link."""
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    page = (root / "static" / "html-tools" / "design-center.html").read_text()
    intake = (root / "static" / "html-tools" / "client-intake.html").read_text()
    relay = (root / "frontend" / "src" / "lib" / "frameDownloads.ts").read_text()
    message = re.search(r"DOWNLOAD_MESSAGE = '([^']+)'", relay).group(1)
    assert f"type:'{message}'" in page
    assert f"type: '{message}'" in intake
    assert "a.href=this._saveURL" not in page
