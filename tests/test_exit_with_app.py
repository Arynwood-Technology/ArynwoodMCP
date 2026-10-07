"""The packaged backend leaves with the desktop app, even when the app crashes or is killed
without cleanup (backend/_frozen.py exit_with_process, ARYNWOOD_APP_PID from main.rs).
Real processes: a mock can't show when a process is really gone."""
import os
import signal
import subprocess
import sys
import textwrap
import time

import pytest

from backend._frozen import exit_with_process


@pytest.mark.skipif(os.name == "nt", reason="Windows ties the backend to the app with a job object")
def test_backend_exits_when_the_app_process_is_gone(tmp_path):
    """Real processes: a stand-in app, and a child running exit_with_process on its pid."""
    app = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    script = tmp_path / "backend.py"
    script.write_text(textwrap.dedent(f"""
        import sys, time
        sys.path.insert(0, {os.getcwd()!r})
        from backend._frozen import exit_with_process
        assert exit_with_process({app.pid}, interval=0.1, grace=2.0)
        print("watching", flush=True)
        time.sleep(60)
    """))
    backend = subprocess.Popen([sys.executable, str(script)], stdout=subprocess.PIPE, text=True)
    try:
        assert backend.stdout.readline().strip() == "watching"
        time.sleep(0.3)
        assert backend.poll() is None                 # still running while the app is
        app.kill()
        app.wait()
        backend.wait(timeout=5)                       # gone within a second or two of the app
        assert backend.returncode == -signal.SIGTERM
    finally:
        for p in (app, backend):
            if p.poll() is None:
                p.kill()


def test_watching_a_process_that_is_already_gone_is_refused():
    gone = subprocess.Popen([sys.executable, "-c", "pass"])
    gone.wait()
    assert exit_with_process(gone.pid) is False
