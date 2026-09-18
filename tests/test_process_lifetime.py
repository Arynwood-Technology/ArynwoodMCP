"""Sidecars (and the packaged backend itself) must not outlive the process that owns them.

The desktop shell stops the backend with a hard kill, which runs no cleanup — so a child that only dies
"when told to" would keep its port and its GPU memory forever. PR_SET_PDEATHSIG makes the kernel do it,
even after SIGKILL. Real processes, real signals: a mock can't show what the kernel does."""
import os
import signal
import subprocess
import sys
import textwrap
import time

import pytest

from backend._frozen import die_with_parent

linux_only = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="PR_SET_PDEATHSIG is Linux-only")


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    with open(f"/proc/{pid}/stat") as f:                   # a zombie is dead for our purposes
        return f.read().rsplit(")", 1)[1].split()[0] != "Z"


def _wait_gone(pid: int, seconds: float = 4.0) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if not _alive(pid):
            return True
        time.sleep(0.05)
    return False


def _spawn_parent(tmp_path, child_uses_guard: bool):
    """A parent that starts a long-sleeping child and prints its pid; returns (parent, child_pid)."""
    script = tmp_path / "parent.py"
    preexec = "preexec_fn=die_with_parent" if child_uses_guard else ""
    script.write_text(textwrap.dedent(f"""
        import subprocess, sys, time
        sys.path.insert(0, {os.getcwd()!r})
        from backend._frozen import die_with_parent
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], {preexec})
        print(child.pid, flush=True)
        time.sleep(60)
    """))
    parent = subprocess.Popen([sys.executable, str(script)], stdout=subprocess.PIPE, text=True)
    return parent, int(parent.stdout.readline())


@linux_only
def test_a_child_with_the_guard_dies_when_its_parent_is_hard_killed(tmp_path):
    parent, child = _spawn_parent(tmp_path, child_uses_guard=True)
    try:
        assert _alive(child)
        os.kill(parent.pid, signal.SIGKILL)                # what the desktop shell does: no cleanup can run
        parent.wait()
        assert _wait_gone(child), "child outlived its SIGKILLed parent"
    finally:
        for pid in (parent.pid, child):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


@linux_only
def test_without_the_guard_the_child_is_orphaned_which_is_the_bug(tmp_path):
    parent, child = _spawn_parent(tmp_path, child_uses_guard=False)
    try:
        os.kill(parent.pid, signal.SIGKILL)
        parent.wait()
        assert not _wait_gone(child, seconds=1.0), "control failed: a plain child should survive its parent"
    finally:
        for pid in (parent.pid, child):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def test_die_with_parent_never_raises_and_reports_support():
    assert die_with_parent.__name__ == "die_with_parent"
    if not sys.platform.startswith("linux"):
        assert die_with_parent() is False
