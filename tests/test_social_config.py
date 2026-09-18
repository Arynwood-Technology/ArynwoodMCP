"""GET /api/social/config tells the UI which OAuth credentials are missing and where
the .env lives. It must report presence only — never echo a client id or secret."""
import pytest

_SECRETS = {
    "FACEBOOK_APP_ID": "fb-id-SENTINEL-111",
    "FACEBOOK_APP_SECRET": "fb-secret-SENTINEL-222",
    "GOOGLE_CLIENT_ID": "g-id-SENTINEL-333",
    "GOOGLE_CLIENT_SECRET": "g-secret-SENTINEL-444",
}


@pytest.fixture()
def no_creds(monkeypatch):
    for name in ("FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "GOOGLE_CLIENT_ID",
                 "GOOGLE_CLIENT_SECRET", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_nothing_configured_by_default(client, no_creds):
    body = client.get("/api/social/config").json()
    assert body["configured"] == {"facebook": False, "instagram": False, "youtube": False, "linkedin": False}
    assert body["env_file"].endswith(".env")
    assert body["env_vars"]["youtube"] == ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]


def test_platform_needs_both_id_and_secret(client, no_creds):
    no_creds.setenv("GOOGLE_CLIENT_ID", "only-the-id")
    assert client.get("/api/social/config").json()["configured"]["youtube"] is False
    no_creds.setenv("GOOGLE_CLIENT_SECRET", "and-now-the-secret")
    assert client.get("/api/social/config").json()["configured"]["youtube"] is True


def test_facebook_credentials_also_configure_instagram(client, no_creds):
    # Instagram publishing goes through the Facebook OAuth app (see PLATFORM_CFG).
    no_creds.setenv("FACEBOOK_APP_ID", "x")
    no_creds.setenv("FACEBOOK_APP_SECRET", "y")
    cfg = client.get("/api/social/config").json()["configured"]
    assert cfg["facebook"] is True and cfg["instagram"] is True


def test_never_leaks_credential_values(client, no_creds):
    for k, v in _SECRETS.items():
        no_creds.setenv(k, v)
    raw = client.get("/api/social/config").text
    for v in _SECRETS.values():
        assert v not in raw


# ── OAuth popup page: no reflected script injection ─────────────────────────────


def test_oauth_error_param_is_html_escaped(client):
    r = client.get("/api/social/callback/facebook", params={"error": "<script>alert(1)</script>"})
    assert "<script>alert(1)</script>" not in r.text
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in r.text


def test_oauth_unknown_platform_never_reaches_the_script_block(client):
    r = client.get("/api/social/callback/x%27);alert(1);//", params={"error": "denied"})
    assert "alert(1)" not in r.text
    assert "platform:'unknown'" in r.text


def test_oauth_popup_still_reports_the_real_platform(client):
    r = client.get("/api/social/callback/youtube", params={"error": "access_denied"})
    assert "platform:'youtube'" in r.text
    assert "ok:false" in r.text
