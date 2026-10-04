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
