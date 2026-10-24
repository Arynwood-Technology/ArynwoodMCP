"""GET /api/video/music/proxy streams a Jamendo track through the backend, so it must reach Jamendo and nothing else.

Found 2026-10-24 (CodeQL py/incomplete-url-substring-sanitization): the host check was endswith("jamendo.com"),
so evil-jamendo.com, or notjamendo.com, passed and the proxy would fetch from it."""
import pytest

from backend.routers import video


@pytest.mark.parametrize("url", [
    "https://jamendo.com/track/1",
    "https://prod-1.storage.jamendo.com/?trackid=1&format=mp31",
    "https://PROD-1.Storage.Jamendo.com/x",
])
def test_jamendo_and_its_subdomains_are_allowed(url):
    assert video._is_jamendo_host(url)


@pytest.mark.parametrize("url", [
    "https://evil-jamendo.com/x",
    "https://notjamendo.com/x",
    "https://jamendo.com.evil.example/x",
    "https://jamendo.com@evil.example/x",
    "http://127.0.0.1:8010/api/fs/read?path=x",
    "ftp://jamendo.com/x",
    "file:///etc/passwd",
    "not a url",
    "",
])
def test_everything_else_is_refused(url):
    assert not video._is_jamendo_host(url)
