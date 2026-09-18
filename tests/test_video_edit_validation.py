"""POST /api/video/edit/jobs must reject nonsense numbers at the door.

Found 2026-09-18 while rendering a test matrix: a clip with speed <= 0 (or inf/NaN) sent _atempo_chain into
`while remaining < 0.5: stages.append(0.5); remaining /= 0.5` — which never ends for 0, negatives or NaN.
It runs synchronously on the event loop, so ONE request froze the whole backend (chat, everything) while the
list grew to ~19 GB. The timeline UI only offers fixed speed presets, so normal editing can't reach it — but a
corrupted project, a script or a tool call can."""
import json
import math
import signal

import pytest

from backend.routers import video


@pytest.fixture()
def fail_fast():
    """A regression here is an infinite loop: turn it into a failure instead of a frozen test run."""
    def boom(*_):
        raise AssertionError("hung: infinite loop")
    old = signal.signal(signal.SIGALRM, boom)
    signal.alarm(5)
    yield
    signal.alarm(0)
    signal.signal(signal.SIGALRM, old)


@pytest.mark.parametrize("speed", [0, -1, -0.0001, math.inf, -math.inf, math.nan])
def test_atempo_chain_refuses_speeds_that_would_loop_forever(fail_fast, speed):
    with pytest.raises(ValueError):
        video._atempo_chain(speed)


@pytest.mark.parametrize("speed,product", [(0.25, 0.25), (0.5, 0.5), (1.5, 1.5), (2, 2), (4, 4), (16, 16), (0.1, 0.1)])
def test_atempo_chain_still_decomposes_valid_speeds(fail_fast, speed, product):
    chain = video._atempo_chain(speed).split(",")
    stages = [float(s.split("=")[1]) for s in chain]
    assert all(0.5 <= s <= 2.0 for s in stages)             # ffmpeg's per-instance limit
    prod = 1.0
    for s in stages:
        prod *= s
    assert prod == pytest.approx(product)


def _post(client, clip, **form):
    return client.post("/api/video/edit/jobs", data={
        "timeline": json.dumps([clip]), "canvas": "landscape", "transitions": "[]", "audio_tracks": "[]",
        "mute_clip_audio": "false", "captions_srt": "", **form,
    }, files=[("files", ("a.mp4", b"not really a video", "video/mp4"))])


CLIP = {"source_type": "upload", "source_id": "0"}


@pytest.mark.parametrize("bad", [
    {"speed": 0}, {"speed": -1}, {"speed": 1000}, {"speed": 0.01},
    {"trim_start": -2, "trim_end": 2}, {"trim_start": 3, "trim_end": 1}, {"trim_start": 2, "trim_end": 2},
    {"trim_end": 0}, {"trim_end": 1e12},
])
def test_endpoint_rejects_out_of_range_clip_values(client, fail_fast, bad):
    r = _post(client, {**CLIP, **bad})
    assert r.status_code == 400, r.text
    assert "Invalid timeline" in r.json()["detail"]


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_endpoint_rejects_non_finite_numbers(client, fail_fast, literal):
    # json.dumps can't be coaxed into these without allow_nan, and Python's json.loads accepts them.
    raw = '[{"source_type": "upload", "source_id": "0", "speed": %s}]' % literal
    r = client.post("/api/video/edit/jobs", data={"timeline": raw, "canvas": "landscape", "transitions": "[]",
                    "audio_tracks": "[]", "mute_clip_audio": "false", "captions_srt": ""},
                    files=[("files", ("a.mp4", b"x", "video/mp4"))])
    assert r.status_code == 400


def test_endpoint_rejects_bad_transitions_and_audio_tracks(client):
    two = json.dumps([CLIP, {**CLIP, "source_id": "1"}])
    files = [("files", ("a.mp4", b"x", "video/mp4")), ("files", ("b.mp4", b"x", "video/mp4"))]
    base = {"timeline": two, "canvas": "landscape", "mute_clip_audio": "false", "captions_srt": "", "audio_tracks": "[]"}
    assert client.post("/api/video/edit/jobs", data={**base, "transitions": json.dumps([{"type": "fade", "duration": 0}])}, files=files).status_code == 400
    assert client.post("/api/video/edit/jobs", data={**base, "transitions": json.dumps([{"type": "fade", "duration": -1}])}, files=files).status_code == 400
    assert client.post("/api/video/edit/jobs", data={**base, "transitions": "[]", "audio_tracks": json.dumps([{"source_id": "0", "offset": -5}])}, files=files).status_code == 400
    assert client.post("/api/video/edit/jobs", data={**base, "transitions": "[]", "audio_tracks": json.dumps([{"source_id": "0", "volume": -1}])}, files=files).status_code == 400


def test_every_preset_the_ui_offers_is_accepted():
    # frontend/src/components/video/TimelineEditor.tsx SPEED_PRESETS
    for speed in (0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4):
        video.EditClip(source_type="upload", source_id="0", speed=speed)
