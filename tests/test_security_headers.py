"""Every backend response says not to sniff types, not to send a referrer on, and not to be framed
unless its route chose who may frame it; and the backend runs no third-party code on its own origin.

Found 2026-10-23 in the security pass: no X-Content-Type-Options, Referrer-Policy or framing policy on
backend responses, and /docs loaded Swagger UI from cdn.jsdelivr.net (a floating version, no SRI)."""
from backend.services.auth import TRUSTED_BROWSER_ORIGINS


def test_api_and_other_responses_carry_the_headers(client):
    for path in ("/", "/api/projects"):
        r = client.get(path)
        assert r.status_code == 200, path
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["referrer-policy"] == "no-referrer"
        assert r.headers["content-security-policy"] == "frame-ancestors 'none'"


def test_html_tools_keep_their_own_framing_policy_and_real_types(client):
    page = client.get("/html-tools/terminal.html")
    assert page.headers["content-security-policy"] == "frame-ancestors 'self' " + " ".join(TRUSTED_BROWSER_ORIGINS)
    assert page.headers["x-content-type-options"] == "nosniff"
    css = client.get("/html-tools/fonts/fonts.css")
    assert css.headers["content-type"].startswith("text/css")      # nosniff refuses a stylesheet of any other type


def test_no_cdn_docs_pages_but_the_schema_stays(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").json()["info"]["title"] == "Arynwood MCP"
