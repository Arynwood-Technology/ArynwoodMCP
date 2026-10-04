"""Trained LoRAs are SDXL. On the SD 1.5 checkpoint A1111 still records the LoRA in the image
info but its style never shows up (checked against the real Arynwood LoRA), so the Design
Center has to know each LoRA's base and img2img has to honour the chosen checkpoint."""
import http.server
import json
import threading

import pytest

from backend.routers import lora, tools


@pytest.mark.parametrize("path, style", [
    ("/models/Juggernaut-XL-v9.safetensors", "general"),
    ("/models/RealVisXL_V5.0_fp16.safetensors", "realistic"),
    ("/models/DreamShaperXL_Turbo_v2.safetensors", "stylized"),
    (None, "general"),
    ("", "general"),
    ("/models/v1-5-pruned-emaonly.safetensors", "general"),  # never SD 1.5
    ("/models/some-other-sdxl.safetensors", "general"),
])
def test_lora_base_style(path, style):
    assert lora._base_style(path) == style


class FakeA1111(http.server.BaseHTTPRequestHandler):
    bodies: list = []

    def do_POST(self):
        self.bodies.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        data = json.dumps({"images": ["x"], "info": "{}"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


@pytest.fixture()
def a1111(monkeypatch):
    FakeA1111.bodies = []
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeA1111)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(tools, "SD_BASE", f"http://127.0.0.1:{server.server_port}")
    yield FakeA1111
    server.shutdown()


def test_img2img_with_style_uses_that_checkpoint(client, a1111):
    r = client.post("/api/tools/sd/img2img", json={
        "prompt": "p", "init_images": ["b64"], "steps": 8, "denoising_strength": 0.6, "style": "general"})
    assert r.status_code == 200
    sent = a1111.bodies[-1]
    assert "style" not in sent
    assert sent["override_settings"]["sd_model_checkpoint"] == tools.SD_CHECKPOINTS["general"]["checkpoint"]
    assert (sent["sampler_name"], sent["scheduler"]) == ("DPM++ 2M", "karras")
    assert (sent["steps"], sent["denoising_strength"]) == (8, 0.6)  # the caller's values win
    assert "enable_hr" not in sent  # txt2img-only


def test_img2img_without_style_is_passed_through_unchanged(client, a1111):
    body = {"prompt": "p", "init_images": ["b64"], "denoising_strength": 0.5}
    assert client.post("/api/tools/sd/img2img", json=body).status_code == 200
    assert a1111.bodies[-1] == body
