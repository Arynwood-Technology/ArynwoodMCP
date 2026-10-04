"""A1111 can fail partway through /unload-checkpoint with some weights already on the CPU, and
every generate after that fails with "Input type (torch.cuda.HalfTensor) and weight type
(torch.HalfTensor) should be the same". GPU jobs used to raise before reaching their
restore step, leaving A1111 in that state. Uses a real HTTP server standing in for A1111."""
import asyncio
import http.server
import json
import threading

import pytest

from backend.services import gpu_jobs


class FakeA1111(http.server.BaseHTTPRequestHandler):
    calls: list = []
    unload_status = 500
    active_bytes = 50_000_000

    def _reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self.calls.append(self.path)
        if self.path.endswith("/unload-checkpoint"):
            self._reply(self.unload_status, {"error": "RuntimeError", "errors": "CUDA error: invalid argument"})
        else:
            self._reply(200, {})

    def do_GET(self):
        self.calls.append(self.path)
        self._reply(200, {"cuda": {"active": {"current": self.active_bytes}}})

    def log_message(self, *args):
        pass


@pytest.fixture()
def a1111(monkeypatch):
    FakeA1111.calls = []
    FakeA1111.unload_status = 500
    FakeA1111.active_bytes = 50_000_000
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeA1111)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(gpu_jobs, "SD_BASE", f"http://127.0.0.1:{server.server_port}")
    real_sleep = asyncio.sleep
    monkeypatch.setattr(gpu_jobs.asyncio, "sleep", lambda _s: real_sleep(0))
    yield FakeA1111
    server.shutdown()


def test_failed_unload_puts_the_model_back(a1111):
    with pytest.raises(RuntimeError, match="Could not unload Stable Diffusion"):
        asyncio.run(gpu_jobs._free_sd_vram_for_job())
    assert a1111.calls == ["/sdapi/v1/unload-checkpoint", "/sdapi/v1/reload-checkpoint"]


def test_unload_that_keeps_vram_puts_the_model_back(a1111):
    a1111.unload_status = 200
    a1111.active_bytes = 7_000_000_000
    with pytest.raises(RuntimeError, match="still holding"):
        asyncio.run(gpu_jobs._free_sd_vram_for_job())
    assert a1111.calls[-1] == "/sdapi/v1/reload-checkpoint"


def test_successful_unload_leaves_the_restore_to_the_caller(a1111):
    a1111.unload_status = 200
    asyncio.run(gpu_jobs._free_sd_vram_for_job())
    assert "/sdapi/v1/reload-checkpoint" not in a1111.calls
