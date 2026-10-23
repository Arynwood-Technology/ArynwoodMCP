"""A picture uploaded for a social post is served from the backend's own address, so only real
pictures are kept (decoded and saved again, under a name chosen here) and they go out as pictures
only: an uploaded web page must never run from Arynwood's origin."""
import io
import re

import pytest
from PIL import Image

from backend.routers import social

SCRIPT = b"<script>document.body.dataset.probe='executed'</script>"


@pytest.fixture()
def media(tmp_path, monkeypatch):
    monkeypatch.setattr(social, "user_data_dir", lambda: str(tmp_path))
    return tmp_path / "static" / "social-media"


def picture(fmt="PNG", **options):
    out = io.BytesIO()
    Image.new("RGB", (8, 8), "teal").save(out, fmt, **options)
    return out.getvalue()


def post(client, name, data, kind="image/png"):
    return client.post("/api/social/post", data={"platforms": "[]"}, files={"image": (name, data, kind)})


def saved(media):
    return sorted(p.name for p in media.iterdir()) if media.exists() else []


def test_a_web_page_is_refused(client, media):
    r = post(client, "probe.html", SCRIPT, "text/html")
    assert r.status_code == 415
    assert saved(media) == []


def test_a_page_dressed_as_a_picture_is_refused(client, media):
    assert post(client, "probe.png", b"\x89PNG\r\n\x1a\n" + SCRIPT).status_code == 415
    assert saved(media) == []


def test_a_picture_is_saved_again_under_a_name_chosen_here(client, media, tmp_path):
    r = post(client, "../../probe.html", picture())
    assert r.status_code == 200, r.text
    [name] = saved(media)
    assert re.fullmatch(r"[0-9a-f]{32}\.png", name)
    assert Image.open(media / name).format == "PNG"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["static"]


def test_exif_does_not_survive(client, media):
    exif = Image.Exif()
    exif[0x010F] = "Camera maker"
    assert post(client, "photo.jpg", picture("JPEG", exif=exif), "image/jpeg").status_code == 200
    [name] = saved(media)
    assert name.endswith(".jpg")
    assert dict(Image.open(media / name).getexif()) == {}


@pytest.mark.parametrize("prefix", ["/api/social/media/", "/social-media/"])
def test_served_as_a_picture_only(client, media, prefix):
    post(client, "p.png", picture()).raise_for_status()
    [name] = saved(media)
    r = client.get(prefix + name)
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]


@pytest.mark.parametrize("prefix", ["/api/social/media/", "/social-media/"])
def test_an_older_upload_that_is_not_a_picture_is_not_served(client, media, prefix):
    media.mkdir(parents=True)
    (media / ("a" * 32 + ".html")).write_bytes(SCRIPT)
    (media / "notes.png").write_bytes(picture())
    assert client.get(prefix + "a" * 32 + ".html").status_code == 404
    assert client.get(prefix + "notes.png").status_code == 404
