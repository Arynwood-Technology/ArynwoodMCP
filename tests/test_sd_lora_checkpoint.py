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


def _fake_lora(directory, name, metadata):
    import json
    header = json.dumps({"__metadata__": metadata}).encode()
    (directory / f"{name}.safetensors").write_bytes(len(header).to_bytes(8, "little") + header)


def test_an_unrecorded_base_is_read_from_the_lora_file(tmp_path, monkeypatch):
    """The Arynwood LoRA's project record has no base_model_path; its file says Juggernaut XL."""
    from backend import external_paths
    from backend.routers import lora
    monkeypatch.setattr(external_paths, "A1111_LORA_DIR", str(tmp_path))
    _fake_lora(tmp_path, "Realistic_lora", {"ss_sd_model_name": "RealVisXL_V5.0_fp16.safetensors"})
    _fake_lora(tmp_path, "Unknown_lora", {"ss_sd_model_name": "something-else.safetensors"})
    assert lora._base_style(None, "Realistic_lora") == "realistic"
    assert lora._base_style(None, "Unknown_lora") == "general"     # unknown base: an SDXL default
    assert lora._base_style(None, "missing_file") == "general"
    assert lora._base_style("/models/Juggernaut-XL-v9.safetensors", "Realistic_lora") == "general"  # the record wins


def test_trained_loras_default_to_a_moderate_weight():
    from pathlib import Path
    page = (Path(__file__).resolve().parents[1] / "static/html-tools/design-center.html").read_text()
    assert 'id="lora-weight" min="0" max="2" step="0.05" value="0.6"' in page
    assert "weight: 0.6," in page
