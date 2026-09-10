#!/usr/bin/env bash
# Arynwood MCP desktop launcher.
# Runs the built Tauri binary if available, otherwise falls back to tauri dev.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# GNOME/desktop launchers don't source ~/.bashrc — load nvm and rustup
# so that node/npm/cargo are available in the dev-mode fallback path.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

BINARY="$ROOT/frontend/src-tauri/target/release/arynwood"
APPIMAGE=$(find "$ROOT/frontend/src-tauri/target/release/bundle/appimage" -name "*.AppImage" 2>/dev/null | head -1)

# Prefer the raw binary (always up-to-date) over the AppImage bundle.
if [ -f "$BINARY" ]; then
    export ARYNWOOD_ROOT="$ROOT"
    exec "$BINARY"
elif [ -n "$APPIMAGE" ] && [ -f "$APPIMAGE" ]; then
    export ARYNWOOD_ROOT="$ROOT"
    exec "$APPIMAGE"
else
    echo "[arynwood] No built binary found — running in dev mode (first launch may be slow)."
    cd "$ROOT/frontend"
    exec npm run tauri:dev
fi
