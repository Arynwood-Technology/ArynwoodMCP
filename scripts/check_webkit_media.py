#!/usr/bin/env python3
"""Play audio/video and run a MediaRecorder in a REAL WebKitGTK, under whatever GStreamer plugins the environment gives it.

The desktop app's engine is WebKitGTK, and everything media goes through GStreamer. A source checkout, Chrome and the unit
tests can't show that a packaged build plays anything (the AppImage once shipped with no plugins: no audio sink, then a
crashed renderer and a solid grey window). This drives the same engine directly and prints one JSON line per test.

  # the host's own GStreamer (control):
  xvfb-run -a python3 scripts/check_webkit_media.py MEDIA_DIR audio:a.wav video:b.mp4 recorder

  # what an extracted AppImage would see (cwd must be the bundle's usr/ — its libwebkit looks for its helpers relatively):
  R=/path/to/squashfs-root; cd $R/usr && xvfb-run -a env LD_LIBRARY_PATH=$R/usr/lib \\
      GST_PLUGIN_SYSTEM_PATH_1_0=$R/usr/lib/gstreamer-1.0 GST_PLUGIN_PATH_1_0=$R/usr/lib/gstreamer-1.0 \\
      GST_PLUGIN_SCANNER_1_0=$R/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner GST_REGISTRY=/tmp/reg.bin \\
      GST_REGISTRY_REUSE_PLUGIN_SCANNER=no GST_DEBUG=GST_ELEMENT_FACTORY:2 WEBKIT_DISABLE_DMABUF_RENDERER=1 \\
      python3 /path/to/scripts/check_webkit_media.py MEDIA_DIR audio:a.wav video:b.mp4 recorder

Elements are muted (`muted = true`) and the recorder listens to a WebAudio oscillator, so nothing is audible.
`no such element factory "x"` lines on stderr (GST_DEBUG above) name plugins to add to stage_gstreamer_plugins.sh.
Needs system python3-gi + gir1.2-webkit2-4.1 and xvfb. Exit 0 = every test played/recorded.
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import tempfile
import threading

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

PAGE = """<!doctype html><meta charset=utf8><body><script>
async function play(kind, file) {
  const el = document.createElement(kind); el.muted = true; el.preload = 'auto'; el.src = '/' + file; document.body.appendChild(el);
  const out = { test: kind + ':' + file };
  try { await Promise.race([el.play(), new Promise((_, rej) => setTimeout(() => rej(new Error('play() timed out')), 8000))]); }
  catch (e) { out.error = String(e && e.name || e) + ': ' + String(e && e.message || ''); }
  await new Promise(r => setTimeout(r, 700));
  out.currentTime = +el.currentTime.toFixed(2); out.readyState = el.readyState; out.mediaError = el.error ? el.error.code : null;
  out.ok = !out.error && !el.paused && el.currentTime > 0 && !el.error;
  return out;
}
async function recorder() {
  const out = { test: 'recorder' };
  try {
    const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination(), osc = ctx.createOscillator(); osc.connect(dest); osc.start();
    const rec = new MediaRecorder(dest.stream); const sizes = []; rec.ondataavailable = e => sizes.push(e.data.size);
    const stopped = new Promise(r => rec.onstop = r); rec.start(); await new Promise(r => setTimeout(r, 1200)); rec.stop();
    await Promise.race([stopped, new Promise(r => setTimeout(r, 4000))]);
    out.mime = rec.mimeType; out.bytes = sizes.reduce((a, b) => a + b, 0); out.ok = out.bytes > 0;
  } catch (e) { out.error = String(e && e.name || e) + ': ' + String(e && e.message || ''); out.ok = false; }
  return out;
}
window.__go = async tests => {
  const res = [];
  for (const t of tests) res.push(t === 'recorder' ? await recorder() : await play(...t.split(':')));
  document.title = 'RESULT:' + JSON.stringify(res);
};
</script>"""


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    media_dir, tests = os.path.abspath(sys.argv[1]), sys.argv[2:]
    page_dir = tempfile.mkdtemp(prefix='webkit-media-check-')
    open(os.path.join(page_dir, '_check.html'), 'w').write(PAGE)

    class Handler(http.server.SimpleHTTPRequestHandler):      # media dir + the test page, with Range like the backend
        def translate_path(self, path):
            name = path.split('?')[0].lstrip('/')
            return os.path.join(page_dir if name == '_check.html' else media_dir, name)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Accept-Ranges', 'bytes')
            super().end_headers()

    server = socketserver.TCPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    window = Gtk.Window()
    view = WebKit2.WebView.new_with_context(WebKit2.WebContext.new_ephemeral())
    window.add(view)
    window.show_all()
    outcome = {'code': 1}

    def loaded(v, event):
        if event == WebKit2.LoadEvent.FINISHED:
            v.run_javascript(f"window.__go({json.dumps(tests)})", None, None, None)

    def poll():
        title = view.get_title() or ''
        if title.startswith('RESULT:'):
            results = json.loads(title[7:])
            for r in results:
                print(json.dumps(r))
            outcome['code'] = 0 if all(r.get('ok') for r in results) else 1
            Gtk.main_quit()
            return False
        return True

    view.connect('load-changed', loaded)
    GLib.timeout_add(300, poll)
    GLib.timeout_add_seconds(90, lambda: (print('TIMED OUT — the web process probably died (grey window)'), Gtk.main_quit(), False)[2])
    view.load_uri(f'http://127.0.0.1:{server.server_address[1]}/_check.html')
    Gtk.main()
    return outcome['code']


if __name__ == '__main__':
    sys.exit(main())
