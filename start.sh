#!/usr/bin/env bash
# Arynwood MCP — start backend + frontend + services
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Load local env vars (API keys, etc.) — never committed
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Version comes from the one file the release process bumps, so this banner can't drift.
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/frontend/package.json" | head -1)"
echo "╔══════════════════════════════════════╗"
printf "║  %-35s ║\n" "Arynwood MCP  v${VERSION:-?}"
echo "╚══════════════════════════════════════╝"

# --- Ollama ---
# Binds loopback-only by default — set OLLAMA_HOST in .env to expose it (e.g. to
# a LAN) deliberately.
if ! curl -s http://localhost:11434/ > /dev/null 2>&1; then
  echo "[svc] Starting Ollama..."
  OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1}" ollama serve > /tmp/ollama.log 2>&1 &
  echo "      Ollama PID: $!"
else
  echo "[svc] Ollama already running."
fi

# --- Monitoring stack ---
if ! curl -s http://localhost:9090/-/healthy > /dev/null 2>&1; then
  echo "[svc] Starting Prometheus monitoring stack..."
  docker compose -f "$ROOT/docker/monitoring/docker-compose.yml" up -d
else
  echo "[svc] Prometheus already running."
fi

# --- Backend ---
# Binds loopback-only by default — set ARYNWOOD_BIND_HOST=0.0.0.0 in .env to
# expose it to a LAN deliberately (pair with ARYNWOOD_API_KEY when you do).
BIND_HOST="${ARYNWOOD_BIND_HOST:-127.0.0.1}"
echo "[1/2] Starting FastAPI backend on port 8010..."
cd "$ROOT"
source venv/bin/activate
python3 -m uvicorn backend.api:app --host "$BIND_HOST" --port 8010 --reload &
BACKEND_PID=$!
echo "      Backend PID: $BACKEND_PID"

# Wait for backend to be ready
for i in $(seq 1 20); do
  if curl -s http://localhost:8010/ > /dev/null 2>&1; then
    echo "      Backend ready."
    break
  fi
  sleep 0.5
done

# --- YouTube auto-publish watcher ---
echo "[svc] Starting YouTube publish watcher..."
cd "$ROOT"
python3 -m triggers.youtube_watch > /tmp/youtube_watch.log 2>&1 &
YOUTUBE_WATCH_PID=$!
echo "      Watcher PID: $YOUTUBE_WATCH_PID (drop a video in ~/Desktop/arynwood_videos/incoming to publish it)"

# --- Frontend ---
echo "[2/2] Starting React dev server on port 5180..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!
echo "      Frontend PID: $FRONTEND_PID"

echo ""
echo "  App:      http://localhost:5180"
echo "  API:      http://localhost:8010"
echo "  Ollama:   http://localhost:11434"
echo ""
echo "  Press Ctrl+C to stop all services."
echo "  For the desktop app run: ./arynwood-desktop.sh"

trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID $YOUTUBE_WATCH_PID 2>/dev/null; exit 0" INT TERM

wait $BACKEND_PID $FRONTEND_PID $YOUTUBE_WATCH_PID
