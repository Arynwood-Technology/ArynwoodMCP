#!/usr/bin/env bash
# Arynwood MCP Desktop Launcher — starts backend then opens Tauri dev window (live HMR)

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Load env vars
if [ -f "$ROOT/.env" ]; then
  set -a; source "$ROOT/.env"; set +a
fi

# Version comes from the one file the release process bumps, so this banner can't drift.
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/frontend/package.json" | head -1)"
echo "╔══════════════════════════════════════╗"
printf "║  %-35s ║\n" "Arynwood MCP  v${VERSION:-?}"
echo "╚══════════════════════════════════════╝"

cleanup() {
  echo "Stopping..."
  kill -TERM $BACKEND_PID 2>/dev/null
  sleep 2
  kill -KILL $BACKEND_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# --- Ollama ---
# Binds loopback-only by default — set OLLAMA_HOST in .env to expose it (e.g. to
# a LAN) deliberately.
if ! curl -s http://localhost:11434/ > /dev/null 2>&1; then
  echo "[svc] Starting Ollama..."
  OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1}" ollama serve > /tmp/ollama.log 2>&1 &
fi

# --- Backend ---
# Binds loopback-only by default — set ARYNWOOD_BIND_HOST=0.0.0.0 in .env to
# expose it to a LAN deliberately (pair with ARYNWOOD_API_KEY when you do).
BIND_HOST="${ARYNWOOD_BIND_HOST:-127.0.0.1}"
echo "[1/2] Starting FastAPI backend..."
cd "$ROOT"
source venv/bin/activate
python3 -m uvicorn backend.api:app --host "$BIND_HOST" --port 8010 > /tmp/arynwood-backend.log 2>&1 &
BACKEND_PID=$!

echo "[1/2] Waiting for backend..."
for i in $(seq 1 30); do
  curl -s http://localhost:8010/ > /dev/null 2>&1 && echo "      Backend ready." && break
  sleep 0.5
done

# --- Launch Tauri dev window (Vite HMR + live reload) ---
echo "[2/2] Opening dev window..."
cd "$ROOT/frontend"
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri:dev
