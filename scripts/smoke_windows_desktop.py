"""Launch a built Windows desktop app, capture its WebView2, and verify exit cleanup.

python scripts/smoke_windows_desktop.py frontend/src-tauri/target/release/arynwood.exe screenshot.png
Requires the project's backend dependencies (websockets) and an interactive desktop.
"""
import base64
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from websockets.sync.client import connect


def listening(port):
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(('127.0.0.1', port)) == 0


def main():
    if listening(8010):
        raise RuntimeError('Port 8010 is occupied; stop Arynwood before testing.')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        debug_port = sock.getsockname()[1]
    # Retain logs on failure for diagnosis; no real user state is touched.
    work = tempfile.mkdtemp(prefix='arynwood-desktop-smoke-')
    env = dict(os.environ, LOCALAPPDATA=work, WEBVIEW2_USER_DATA_FOLDER=work + '/webview',
               WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f'--remote-debugging-port={debug_port}',
               ARYNWOOD_BIND_HOST='127.0.0.1', ARYNWOOD_BACKEND_PORT='8010')
    env.pop('ARYNWOOD_API_KEY', None)
    env.pop('ARYNWOOD_DB_PATH', None)
    proc = subprocess.Popen([str(Path(sys.argv[1]).resolve())], env=env)
    try:
        deadline = time.monotonic() + 120
        while True:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{debug_port}/json', timeout=2) as response:
                    targets = json.load(response)
                page = next(target for target in targets if target['type'] == 'page')
                if listening(8010):
                    break
            except (OSError, ValueError, StopIteration):
                pass
            if proc.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError(f'Desktop failed to start; exit={proc.poll()}, logs={work}')
            time.sleep(0.5)
        with connect(page['webSocketDebuggerUrl'], max_size=20_000_000) as ws:
            sequence = 0
            def call(method, params=None):
                nonlocal sequence
                sequence += 1
                ws.send(json.dumps({'id': sequence, 'method': method, 'params': params or {}}))
                while True:
                    result = json.loads(ws.recv(timeout=30))
                    if result.get('id') == sequence:
                        assert 'error' not in result, result
                        return result['result']
            deadline = time.monotonic() + 60
            while True:
                result = call('Runtime.evaluate', {'expression': 'document.body.innerText', 'returnByValue': True})
                body = result['result'].get('value', '')
                if 'Arynwood' in body:
                    break
                assert time.monotonic() < deadline, body
                time.sleep(0.5)
            result = call('Runtime.evaluate', {'expression':
                "fetch('http://localhost:8010/api/chat/personas').then(async r => ({status:r.status, count:(await r.json()).length}))",
                'awaitPromise': True, 'returnByValue': True})
            value = result['result'].get('value', {})
            assert value.get('status') == 200 and value.get('count', 0) > 0, result
            screenshot = call('Page.captureScreenshot', {'format': 'png'})
            Path(sys.argv[2]).write_bytes(base64.b64decode(screenshot['data']))
            print('PASS: native window rendered and WebView2 fetched personas from the packaged backend')
    finally:
        if proc.poll() is None:
            # Kill only the desktop: the Job Object must clean up its descendants.
            proc.kill()
        proc.wait(timeout=15)
        deadline = time.monotonic() + 15
        while listening(8010) and time.monotonic() < deadline:
            time.sleep(0.25)
        assert not listening(8010), 'Desktop exit orphaned its backend on port 8010'
        print('PASS: desktop exit released the backend port')
        print(f'Isolated test data: {work}')


if __name__ == '__main__':
    main()
