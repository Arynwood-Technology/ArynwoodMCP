#!/usr/bin/env bash
# Arynwood MCP — desktop app launcher (interim, pre-Tauri-packaging)
#
# Runs the backend + Vite dev server on dedicated ports (8010 / 5180) so this
# doesn't collide with another local checkout on the same machine, then opens
# the app in a chrome-less "app mode" window.
#
# Backend/frontend are left running in the background after launch (same as
# start.sh) so re-opening the icon is fast and dev state / HMR isn't lost.

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT=8010
FRONTEND_PORT=5180
BACKEND_LOG=/tmp/arynwood-app-backend.log
FRONTEND_LOG=/tmp/arynwood-app-frontend.log

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

notify() {
  command -v notify-send >/dev/null 2>&1 && notify-send -a "Arynwood" "$1" "$2"
}

# --- Ollama ---
# Binds loopback-only by default — set OLLAMA_HOST in .env to expose it (e.g. to
# a LAN) deliberately.
if ! curl -s http://localhost:11434/ > /dev/null 2>&1; then
  OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1}" ollama serve > /tmp/ollama.log 2>&1 &
  disown
fi

# --- Backend (only start if nothing is already answering on our port) ---
# Binds loopback-only by default — set ARYNWOOD_BIND_HOST=0.0.0.0 in .env to
# expose it to a LAN deliberately (pair with ARYNWOOD_API_KEY when you do).
BIND_HOST="${ARYNWOOD_BIND_HOST:-127.0.0.1}"
if ! curl -s "http://localhost:$BACKEND_PORT/" > /dev/null 2>&1; then
  cd "$ROOT"
  source venv/bin/activate
  python3 -m uvicorn backend.api:app --host "$BIND_HOST" --port "$BACKEND_PORT" --reload > "$BACKEND_LOG" 2>&1 &
  disown
fi

for i in $(seq 1 40); do
  curl -s "http://localhost:$BACKEND_PORT/" > /dev/null 2>&1 && break
  sleep 0.5
done

if ! curl -s "http://localhost:$BACKEND_PORT/" > /dev/null 2>&1; then
  notify "Arynwood failed to start" "Backend didn't come up — see $BACKEND_LOG"
  exit 1
fi

# --- Frontend (Vite dev server, only start if not already running) ---
if ! curl -s "http://localhost:$FRONTEND_PORT/" > /dev/null 2>&1; then
  cd "$ROOT/frontend"
  npm run dev > "$FRONTEND_LOG" 2>&1 &
  disown
fi

for i in $(seq 1 60); do
  curl -s "http://localhost:$FRONTEND_PORT/" > /dev/null 2>&1 && break
  sleep 0.5
done

if ! curl -s "http://localhost:$FRONTEND_PORT/" > /dev/null 2>&1; then
  notify "Arynwood failed to start" "Frontend didn't come up — see $FRONTEND_LOG"
  exit 1
fi

# --- Open as a standalone app window (no tabs/toolbar) ---
google-chrome \
  --app="http://localhost:$FRONTEND_PORT" \
  --class=Arynwood \
  --window-name=Arynwood \
  --user-data-dir="$HOME/.config/arynwood-app-chrome" \
  > /tmp/arynwood-app-chrome.log 2>&1 &
disown
