"""A packaged (AppImage + PyInstaller) backend inherits PYTHONHOME, PYTHONPATH, LD_LIBRARY_PATH and PATH
entries pointing into the bundle. Every Python child it spawns — the music/voice/stem/whisper sidecars,
the GPU-tool scripts — then dies at interpreter start:

    Fatal Python error: init_fs_encoding ... No module named 'encodings'

and the backend threw stderr away, so "sidecar won't start" was all anyone saw. Reproduced against the
real packaged app's environment on 2026-09-18."""
import subprocess
import sys

import pytest

from backend._frozen import sanitize_environ_for_children

APPDIR = "/tmp/.mount_arynwoXYZ"
MEIPASS = "/tmp/_MEI000abc"


@pytest.fixture()
def packaged(monkeypatch):
    monkeypatch.setattr(sys, "_MEIPASS", MEIPASS, raising=False)


def _dirty():
    return {
        "APPDIR": APPDIR,
        "APPIMAGE": "/opt/apps/app.AppImage",
        "PATH": f"{APPDIR}/usr/bin/:{APPDIR}/usr/sbin/:/usr/local/bin:/usr/bin",
        "LD_LIBRARY_PATH": f"{MEIPASS}:{APPDIR}/usr/lib/:/opt/cuda/lib64",
        "LD_LIBRARY_PATH_ORIG": f"{APPDIR}/usr/lib/:{APPDIR}/usr/lib/x86_64-linux-gnu/",
        "PYTHONHOME": f"{APPDIR}/usr/",
        "PYTHONPATH": f"{APPDIR}/usr/share/pyshared/:",
        "GDK_PIXBUF_MODULE_FILE": f"{APPDIR}//usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders.cache",
        "HOME": "/home/u",
        "LANG": "C.UTF-8",
    }


def test_bundle_entries_are_removed_and_the_users_own_are_kept(packaged):
    env = _dirty()
    changed = sanitize_environ_for_children(env)
    assert env["PATH"] == "/usr/local/bin:/usr/bin"
    assert env["LD_LIBRARY_PATH"] == "/opt/cuda/lib64"          # a user's own CUDA path survives
    for gone in ("PYTHONHOME", "PYTHONPATH", "LD_LIBRARY_PATH_ORIG", "GDK_PIXBUF_MODULE_FILE"):
        assert gone not in env
    assert env["HOME"] == "/home/u" and env["LANG"] == "C.UTF-8"
    assert env["APPIMAGE"] and env["APPDIR"] == APPDIR          # launch descriptors are left alone
    assert "PYTHONHOME" in changed and "PATH" in changed


def test_a_clean_environment_is_untouched(packaged):
    env = {"PATH": "/usr/local/bin:/usr/bin", "HOME": "/home/u", "LD_LIBRARY_PATH": "/opt/cuda/lib64"}
    before = dict(env)
    assert sanitize_environ_for_children(env) == []
    assert env == before


def test_idempotent(packaged):
    env = _dirty()
    sanitize_environ_for_children(env)
    once = dict(env)
    assert sanitize_environ_for_children(env) == []
    assert env == once


def test_not_packaged_means_hands_off(monkeypatch):
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    env = {"PATH": "/some/dir/usr/bin:/usr/bin", "PYTHONHOME": "/opt/py"}      # no APPDIR, not frozen
    before = dict(env)
    assert sanitize_environ_for_children(env) == []
    assert env == before


def test_the_real_failure_and_the_real_fix(tmp_path, packaged):
    """Not a simulation of the symptom: a real Python child under an AppImage-style PYTHONHOME."""
    fake_appdir = tmp_path / "mount"
    (fake_appdir / "usr" / "lib" / "python3.11").mkdir(parents=True)          # a foreign, incomplete stdlib
    dirty = {"PATH": "/usr/bin:/bin", "APPDIR": str(fake_appdir), "PYTHONHOME": f"{fake_appdir}/usr/"}

    broken = subprocess.run([sys.executable, "-c", "print('alive')"], env=dirty, capture_output=True, text=True)
    assert broken.returncode != 0 and "encodings" in broken.stderr             # the bug, reproduced

    sanitize_environ_for_children(dirty)
    fixed = subprocess.run([sys.executable, "-c", "print('alive')"], env=dirty, capture_output=True, text=True)
    assert fixed.returncode == 0 and fixed.stdout.strip() == "alive"


def test_pyinstaller_extraction_dirs_are_recognised_by_shape(monkeypatch):
    """The bootloader's _MEI dir isn't always this process's own sys._MEIPASS (seen live: the
    LD_LIBRARY_PATH the app hands down names one this process doesn't report)."""
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    env = {"APPDIR": APPDIR, "LD_LIBRARY_PATH": "/tmp/_MEI000111c6PPXQZM:/opt/cuda/lib64"}
    sanitize_environ_for_children(env)
    assert env["LD_LIBRARY_PATH"] == "/opt/cuda/lib64"
