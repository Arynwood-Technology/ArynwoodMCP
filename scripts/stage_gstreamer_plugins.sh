#!/usr/bin/env bash
# Stage the GStreamer plugins the desktop app's web view needs, for the AppImage build.
#
#   eval "$(scripts/stage_gstreamer_plugins.sh /tmp/gst-plugins)"     # prints an `export GSTREAMER_PLUGINS_DIR=...`
#   cd frontend && npx tauri build --bundles appimage                 # bundleMediaFramework picks that dir up
#
# Why this exists: WebKitGTK plays audio/video, records with MediaRecorder and captures the microphone through
# GStreamer. An AppImage that ships GStreamer's core libraries but no plugins has no audio sink at all — the
# first <audio> element crashed the web process (the window goes grey; found 2026-09-18) — and the AppImage's
# environment points GStreamer ONLY at the bundle, so the host's plugins are not used as a fallback.
# `bundle.linux.appimage.bundleMediaFramework` (tauri.conf.json) makes Tauri bundle plugins; left alone it would
# copy every plugin on the build machine (273 of them, with the whole dependency tree of VA-API, CUDA, WebRTC,
# SRT…). This stages only what a web view uses, so the bundle stays small and doesn't drag in GPU-driver libs.
set -euo pipefail

OUT="${1:?usage: $0 <staging-dir>}"
SRC="${GSTREAMER_PLUGINS_DIR:-/usr/lib/$(uname -m)-linux-gnu/gstreamer-1.0}"

# Playback, decode, capture and MediaRecorder. Missing any of these = a feature silently missing in the app.
# (debugutilsbad = fakeaudiosink/fakevideosink, which WebKit builds into every media pipeline: without it
#  `gst_bin_add_many`/`g_object_set` assertions fire on each <audio> element and Subtitles/effects degrade;
#  transcode + voaacenc + encoding = what WebKitGTK's MediaRecorder needs — found by delta-debugging all 240 host
#  plugins: without the first two `new MediaRecorder(stream)` throws "unsupported on this platform", without
#  `encoding` (encodebin2) it records 0 bytes; Music Lab's Record tab depends on it)
REQUIRED="coreelements typefindfunctions playback app audioconvert audioresample audioparsers volume
  videoconvertscale autodetect pulseaudio isomp4 matroska ogg vorbis opus wavparse libav vpx debugutilsbad
  videofilter transcode voaacenc encoding"
# Nice to have; the app still plays audio and video without them.
OPTIONAL="alsa pipewire flac mpg123 id3demux apetag icydemux opusparse videoparsersbad videorate audiorate
  rawparse opengl audiofx deinterlace subenc gio autoconvert"

[ -d "$SRC" ] || { echo "no GStreamer plugin directory at $SRC (install gstreamer1.0-plugins-{base,good,bad,ugly}, -libav, -pulseaudio)" >&2; exit 1; }
rm -rf "$OUT" && mkdir -p "$OUT"

missing=()
for name in $REQUIRED; do
  if [ -f "$SRC/libgst$name.so" ]; then ln -s "$SRC/libgst$name.so" "$OUT/"; else missing+=("$name"); fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "missing required GStreamer plugins: ${missing[*]}" >&2
  echo "on Debian/Ubuntu: sudo apt install gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav gstreamer1.0-pulseaudio" >&2
  exit 1
fi
for name in $OPTIONAL; do
  if [ -f "$SRC/libgst$name.so" ]; then ln -s "$SRC/libgst$name.so" "$OUT/"; else echo "note: optional plugin not found: $name" >&2; fi
done

echo "staged $(ls "$OUT" | wc -l) GStreamer plugins from $SRC into $OUT" >&2
echo "export GSTREAMER_PLUGINS_DIR='$OUT'"
