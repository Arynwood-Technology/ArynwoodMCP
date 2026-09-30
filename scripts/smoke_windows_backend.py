"""Run the frozen Windows backend with isolated user data and no external services."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import venv


def main():
    binary = Path(sys.argv[1]).resolve()
    assert binary.is_file(), binary
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix='arynwood-windows-smoke-') as directory:
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', 8001)) == 0:
                raise RuntimeError('Stop the service on port 8001 before this isolated sidecar test.')
        studio = Path(directory) / 'MusicStudio'
        sidecar = studio / 'sidecars' / 'voice'
        sidecar.mkdir(parents=True)
        venv.EnvBuilder(with_pip=False).create(sidecar / 'venv')
        (sidecar / 'main.py').write_text(
            "import http.server, os\n"
            "class H(http.server.BaseHTTPRequestHandler):\n"
            "    def do_GET(self):\n"
            "        self.send_response(200); self.end_headers(); self.wfile.write(b'{}')\n"
            "http.server.HTTPServer(('127.0.0.1', int(os.environ['PORT'])), H).serve_forever()\n",
            encoding='utf-8')
        env = dict(os.environ, LOCALAPPDATA=directory, ARYNWOOD_BACKEND_PORT=str(port),
                   ARYNWOOD_BIND_HOST='127.0.0.1', ARYNWOOD_MUSICSTUDIO_DIR=str(studio))
        env.pop('ARYNWOOD_API_KEY', None)
        env.pop('ARYNWOOD_DB_PATH', None)
        log_path = Path(directory) / 'backend.log'
        with log_path.open('w', encoding='utf-8') as log:
            proc = subprocess.Popen([str(binary)], env=env, stdout=log, stderr=log,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                def request(path, method='GET', headers=None, timeout=60):
                    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', method=method, headers=headers or {})
                    return urllib.request.urlopen(req, timeout=timeout)
                deadline = time.monotonic() + 120
                while True:
                    try:
                        with request('/api/chat/personas') as response:
                            assert len(json.load(response)) > 0
                        break
                    except (OSError, ValueError):
                        if proc.poll() is not None or time.monotonic() > deadline:
                            raise RuntimeError(log_path.read_text(encoding='utf-8', errors='replace'))
                        time.sleep(0.5)
                with request('/api/system/status') as response:
                    status = json.load(response)
                    assert status['platform'] == 'Windows'
                    assert status['can_restart'] is False
                with request('/api/chat/personas', 'OPTIONS', {
                    'Origin': 'http://tauri.localhost', 'Access-Control-Request-Method': 'GET'
                }) as response:
                    assert response.headers['Access-Control-Allow-Origin'] == 'http://tauri.localhost'
                try:
                    request('/api/system/restart', 'POST')
                    raise AssertionError('Frozen backend incorrectly offers restart')
                except urllib.error.HTTPError as error:
                    assert error.code == 501
                assert (Path(directory) / 'arynwood-mcp' / 'arynwood.db').is_file()
                with request('/api/studio/sidecars/voice/start', 'POST') as response:
                    assert json.load(response)['status'] == 'starting'
                deadline = time.monotonic() + 20
                while True:
                    with request('/api/studio/sidecars') as response:
                        state = json.load(response)['voice']['status']
                    if state == 'running':
                        break
                    assert time.monotonic() < deadline, f'Sidecar failed to start: {state}'
                    time.sleep(0.5)
                with request('/api/studio/sidecars/voice/stop', 'POST') as response:
                    assert json.load(response)['status'] == 'stopped'
                print('PASS: packaged startup, personas, system status, Windows CORS, restart contract, user database and native sidecar lifecycle')
            finally:
                if proc.poll() is None:
                    subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                proc.wait(timeout=15)
                # The bootloader cleans up its extraction directory asynchronously.
                time.sleep(1)


if __name__ == '__main__':
    main()
