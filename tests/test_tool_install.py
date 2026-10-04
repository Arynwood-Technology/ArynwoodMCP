"""Tool Library's Install / Start Container button. A1111's `docker compose up -d` used to run in
the app dir, which in a packaged build is the read-only bundle with no compose file ("no
configuration file provided"). Runs real child processes; `docker` is a stub on PATH."""
import os
import re
import stat
import sys

import pytest

from backend import external_paths
from backend.routers import tools

HOME = os.path.expanduser("~")


@pytest.fixture()
def fake_tool(monkeypatch):
    def register(**entry):
        monkeypatch.setitem(tools.TOOLS, "fake_tool", {
            "name": "Fake", "description": "", "type": "x", "category": "x", **entry})
    return register


@pytest.fixture()
def fake_docker(tmp_path, monkeypatch):
    """A `docker` on PATH that logs its arguments; `container inspect` succeeds for `existing`."""
    bin_dir, log = tmp_path / "bin", tmp_path / "docker.log"
    bin_dir.mkdir()
    script = bin_dir / "docker"
    script.write_text(f'#!/bin/sh\necho "$@" >> {log}\n'
                      '[ "$1 $2" = "container inspect" ] && [ "$3" != existing ] && exit 1\nexit 0\n')
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    return log


def test_install_runs_in_the_tools_own_folder(client, fake_tool, tmp_path):
    fake_tool(install="pwd", install_cwd=str(tmp_path))
    r = client.post("/api/tools/fake_tool/install/stream")
    assert r.status_code == 200
    assert str(tmp_path) in r.text
    assert "✓ Done" in r.text


def test_missing_folder_fails_clearly_without_running_anything(client, fake_tool, tmp_path):
    marker = tmp_path / "ran"
    fake_tool(install=f"touch {marker}", install_cwd=os.path.join(HOME, "no-such-arynwood-folder"),
              install_cwd_setting="ARYNWOOD_SOMETHING_DIR")
    r = client.post("/api/tools/fake_tool/install/stream")
    assert r.status_code == 404
    assert r.json()["detail"] == ("Folder not found: ~/no-such-arynwood-folder. "
                                  "Set ARYNWOOD_SOMETHING_DIR in your .env to where it is.")
    assert not marker.exists()


def test_guidance_is_never_run(client, fake_tool, tmp_path):
    fake_tool(install=f"# touch {tmp_path / 'ran'}")
    assert client.post("/api/tools/fake_tool/install/stream").status_code == 400
    assert not (tmp_path / "ran").exists()


def test_bare_pip_goes_to_the_app_venv_but_a_venvs_own_pip_stays_put():
    rewrite = lambda cmd: tools._BARE_PIP.sub("APP_PIP install", cmd)  # noqa: E731
    assert rewrite("pip install kokoro") == "APP_PIP install kokoro"
    assert rewrite("pip3 install x && pip install y") == "APP_PIP install x && APP_PIP install y"
    for own in ("~/tools/whisper-venv/bin/pip install -U openai-whisper",
                "venv/bin/pip install -r requirements.txt",
                "/opt/env/bin/pip3 install z"):
        assert rewrite(own) == own


def test_packaged_build_refuses_pip_installs(client, fake_tool, monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    fake_tool(install=f"pip install nothing && touch {tmp_path / 'ran'}")
    r = client.post("/api/tools/fake_tool/install/stream")
    assert r.status_code == 501
    assert "source checkout" in r.json()["detail"]
    assert not (tmp_path / "ran").exists()


def test_docker_run_reuses_an_existing_container(client, fake_tool, fake_docker):
    fake_tool(install="docker run -d --name existing -p 127.0.0.1:1:1 some/image")
    r = client.post("/api/tools/fake_tool/install/stream")
    assert "Container existing already exists, starting it." in r.text
    assert "✓ Done" in r.text
    assert fake_docker.read_text().splitlines() == ["container inspect existing", "start existing"]


def test_docker_run_creates_a_missing_container(client, fake_tool, fake_docker):
    fake_tool(install="docker run -d --name fresh -p 127.0.0.1:1:1 some/image")
    client.post("/api/tools/fake_tool/install/stream")
    assert fake_docker.read_text().splitlines() == [
        "container inspect fresh", "run -d --name fresh -p 127.0.0.1:1:1 some/image"]


def test_stable_diffusion_starts_in_the_a1111_compose_project():
    sd = tools.TOOLS["stable_diffusion"]
    assert sd["install"] == "docker compose up -d"  # starts with docker: keeps "Start Container"
    assert sd["install_cwd"] == external_paths.A1111_DIR
    assert sd["install_cwd_setting"] == "ARYNWOOD_A1111_DIR"


REMOVED = {"aider", "comfyui", "triposr", "depth_anything", "shap_e", "realesrgan",
           "musetalk", "instantmesh", "cogvideox", "f5_tts", "musicgen"}


def test_registry_is_safe_to_ship():
    assert not REMOVED & tools.TOOLS.keys()
    for key, info in tools.TOOLS.items():
        shown = " ".join(str(info.get(k, "")) for k in ("name", "description", "install"))
        assert HOME + os.sep not in shown, f"{key} shows an absolute home path"
        cmd = info.get("install", "")
        if cmd.startswith("docker run"):
            # Named so Start can reuse it; never published beyond this machine.
            assert re.search(r"--name \S+", cmd), key
            assert all(p.startswith("127.0.0.1:") for p in re.findall(r"-p (\S+)", cmd)), key
            assert "-d " in cmd, f"{key}: a foreground container would hold the install stream open"


def test_get_cannot_start_an_install(client, fake_tool, tmp_path):
    marker = tmp_path / "ran"
    fake_tool(install=f"touch {marker}", install_cwd=str(tmp_path))
    assert client.get("/api/tools/fake_tool/install/stream").status_code == 405
    assert not marker.exists()
