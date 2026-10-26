#!/usr/bin/env python3
"""Play audio/video and run a MediaRecorder in a REAL WebKitGTK, under whatever GStreamer plugins the environment gives it.

The desktop app's engine is WebKitGTK, and everything media goes through GStreamer. A source checkout, Chrome and the unit
tests can't show that a packaged build plays anything (the AppImage once shipped with no plugins: no audio sink, then a
crashed renderer and a solid grey window). This drives the same engine directly and prints one JSON line per test.

  # the host's own GStreamer (control):
  xvfb-run -a python3 scripts/check_webkit_media.py MEDIA_DIR audio:a.wav video:b.mp4 webaudio:a.wav recorder

  # what an extracted AppImage would see (cwd must be the bundle's usr/ — its libwebkit looks for its helpers relatively):
  R=/path/to/squashfs-root; cd $R/usr && xvfb-run -a env LD_LIBRARY_PATH=$R/usr/lib \\
      GST_PLUGIN_SYSTEM_PATH_1_0=$R/usr/lib/gstreamer-1.0 GST_PLUGIN_PATH_1_0=$R/usr/lib/gstreamer-1.0 \\
      GST_PLUGIN_SCANNER_1_0=$R/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner GST_REGISTRY=/tmp/reg.bin \\
      GST_REGISTRY_REUSE_PLUGIN_SCANNER=no GST_DEBUG=GST_ELEMENT_FACTORY:2 WEBKIT_DISABLE_DMABUF_RENDERER=1 \\
      python3 /path/to/scripts/check_webkit_media.py MEDIA_DIR audio:a.wav video:b.mp4 recorder

Elements are muted (`muted = true`) and the recorder listens to a WebAudio oscillator, so nothing is audible.
The webaudio case needs a fixture longer than 4 seconds. It checks the same
MediaElementAudioSourceNode path as Music Lab's audition, including delayed errors.

`mic` records the default capture device the way the app does (getUserMedia -> Web Audio -> raw PCM, see
frontend/src/lib/pcmCapture.ts) and passes only if samples with signal arrive. It needs a capture device: for a
throwaway one, run a private PulseAudio with `module-sine-source` and point PULSE_SERVER at it, with
GST_PLUGIN_FEATURE_RANK=alsadeviceprovider:NONE,pipewiredeviceprovider:NONE and a private XDG_RUNTIME_DIR so the
host's real microphones can't be reached. `recorder` is MediaRecorder itself, which the app no longer uses for the
microphone: on WebKitGTK 2.52 / GStreamer 1.24 it writes 0 bytes from a real capture device ("Couldn't find a
compatible stream profile"), with every host plugin installed.

Each test runs in its own fresh web view. In one page, WebKitGTK 2.52's MediaRecorder on a WebAudio stream writes
0 bytes once an earlier AudioContext was closed, so `recorder` failed after `webaudio:` for that reason alone.
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
  const test = kind + ':' + file;
  const webaudio = kind === 'webaudio';
  if (webaudio) kind = 'audio';
  const el = document.createElement(kind); el.muted = true; el.preload = 'auto'; el.src = '/' + file; document.body.appendChild(el);
  const out = { test };
  let ctx;
  try {
    if (webaudio) {
      ctx = new AudioContext();
      ctx.createMediaElementSource(el).connect(ctx.destination);
      await ctx.resume();
    }
    await Promise.race([el.play(), new Promise((_, rej) => setTimeout(() => rej(new Error('play() timed out')), 8000))]);
  }
  catch (e) { out.error = String(e && e.name || e) + ': ' + String(e && e.message || ''); }
  // Allow device startup without treating a single early snapshot as a playback failure.
  const deadline = performance.now() + 8000;
  while (!el.error && el.currentTime === 0 && performance.now() < deadline) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (webaudio) await new Promise(r => setTimeout(r, 4000));
  out.currentTime = +el.currentTime.toFixed(2); out.readyState = el.readyState; out.mediaError = el.error ? el.error.code : null;
  out.ok = !out.error && (!el.paused || el.ended) && el.currentTime > 0 && !el.error;
  el.pause();
  if (ctx) await ctx.close();
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
async function mic() {
  const out = { test: 'mic' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    out.device = stream.getAudioTracks()[0] ? stream.getAudioTracks()[0].label : '';
    const ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, Math.max(1, src.channelCount || 1), 1);
    let frames = 0, peak = 0;
    proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0); frames += d.length;
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      e.outputBuffer.getChannelData(0).fill(0);
    };
    src.connect(proc); proc.connect(ctx.destination); await ctx.resume(); await new Promise(r => setTimeout(r, 1500));
    proc.onaudioprocess = null; proc.disconnect(); stream.getTracks().forEach(t => t.stop()); await ctx.close();
    out.frames = frames; out.peak = +peak.toFixed(3); out.ok = frames > 0 && peak > 0;
  } catch (e) { out.error = String(e && e.name || e) + ': ' + String(e && e.message || ''); out.ok = false; }
  return out;
}
window.__go = async tests => {
  const res = [];
  for (const t of tests) res.push(t === 'recorder' ? await recorder() : t === 'mic' ? await mic() : await play(...t.split(':')));
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
    url = f'http://127.0.0.1:{server.server_address[1]}/_check.html'

    results = [run_one(url, test) for test in tests]
    for r in results:
        print(json.dumps(r))
    return 0 if all(r.get('ok') for r in results) else 1


def run_one(url: str, test: str) -> dict:
    """One test in a fresh web view (see the docstring for why they don't share a page)."""
    window = Gtk.Window()
    view = WebKit2.WebView.new_with_context(WebKit2.WebContext.new_ephemeral())
    view.get_settings().set_enable_media_stream(True)                     # the mic test's getUserMedia
    view.connect('permission-request', lambda _v, request: (request.allow(), True)[1])
    window.add(view)
    window.show_all()
    outcome = {'result': {'test': test, 'ok': False, 'error': 'TIMED OUT — the web process probably died (grey window)'}}

    def loaded(v, event):
        if event == WebKit2.LoadEvent.FINISHED:
            v.run_javascript(f"window.__go({json.dumps([test])})", None, None, None)

    def poll():
        title = view.get_title() or ''
        if title.startswith('RESULT:'):
            outcome['result'] = json.loads(title[7:])[0]
            Gtk.main_quit()
            return False
        return True

    view.connect('load-changed', loaded)
    poll_id = GLib.timeout_add(300, poll)
    timeout_id = GLib.timeout_add_seconds(90, lambda: (Gtk.main_quit(), False)[1])
    view.load_uri(url)
    Gtk.main()
    for source_id in (poll_id, timeout_id):
        if GLib.MainContext.default().find_source_by_id(source_id):
            GLib.source_remove(source_id)
    window.destroy()
    return outcome['result']


if __name__ == '__main__':
    sys.exit(main())
