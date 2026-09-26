.PHONY: setup setup-backend setup-frontend test test-backend test-frontend lint build package package-backend smoke clean help

help:
	@echo "Arynwood MCP — developer commands"
	@echo ""
	@echo "  make setup          Create venv, install backend + frontend deps"
	@echo "  make test           Run backend + frontend test suites"
	@echo "  make test-backend   pytest tests/ (excludes slow live-eval tests)"
	@echo "  make test-frontend  vitest run"
	@echo "  make lint           eslint (frontend)"
	@echo "  make build          TypeScript build + vite build (frontend/dist)"
	@echo "  make package        Full Tauri desktop build (AppImage + .deb, Linux only)"
	@echo "  make smoke          Start backend + hit health/docs endpoints, then stop it"
	@echo "  make clean          Remove build artifacts (not venv, not node_modules)"

setup: setup-backend setup-frontend

setup-backend:
	python3 -m venv venv
	. venv/bin/activate && pip install -r requirements-dev.txt

setup-frontend:
	cd frontend && npm ci

test: test-backend test-frontend

test-backend:
	# python -m pytest, not the pytest entrypoint directly: -m puts the repo root
	# (cwd) on sys.path so `from backend...` imports resolve; the bare `pytest`
	# script doesn't do that and fails every test module's import at collection.
	. venv/bin/activate && python -m pytest tests/ -v

test-frontend:
	cd frontend && npm test

lint:
	cd frontend && npm run lint

build:
	cd frontend && npm run build

package: package-backend
	venv/bin/python scripts/smoke_packaged_backend.py dist/arynwood-backend
	gst_stage=$$(mktemp -d /tmp/arynwood-gst.XXXXXX); trap 'rm -rf "$$gst_stage"' EXIT; \
	  gst_env=$$(scripts/stage_gstreamer_plugins.sh "$$gst_stage") && eval "$$gst_env" && cd frontend && APPIMAGE_EXTRACT_AND_RUN=1 npm run tauri:build
	python3 scripts/finalize_appimage.py frontend/src-tauri/target/release/bundle/appimage/*.AppImage

# Builds the PyInstaller backend sidecar and places it where tauri.conf.json's
# externalBin expects it. Not folded into `package`'s own recipe as a `run:` step
# because the target-triple suffix in the destination filename needs `uname -m`
# resolved at make-time, not hardcoded — see arynwood-backend.spec for what this
# bundles and why (onefile, not onedir: Tauri's externalBin copies one file).
package-backend:
	. venv/bin/activate && pip show pyinstaller > /dev/null 2>&1 || pip install pyinstaller
	. venv/bin/activate && pyinstaller arynwood-backend.spec --noconfirm
	mkdir -p frontend/src-tauri/binaries
	cp dist/arynwood-backend frontend/src-tauri/binaries/arynwood-backend-x86_64-unknown-linux-gnu
	chmod +x frontend/src-tauri/binaries/arynwood-backend-x86_64-unknown-linux-gnu

smoke:
	@. venv/bin/activate && \
	python3 -m uvicorn backend.api:app --host 127.0.0.1 --port 8010 & \
	BACKEND_PID=$$!; \
	echo "Waiting for backend (PID $$BACKEND_PID)..."; \
	for i in $$(seq 1 30); do \
		curl -sf http://127.0.0.1:8010/ > /dev/null 2>&1 && break; \
		sleep 0.5; \
	done; \
	echo "--- GET / ---"; curl -sf http://127.0.0.1:8010/ || (echo "FAILED"; kill $$BACKEND_PID; exit 1); \
	echo ""; echo "--- GET /docs ---"; curl -sf -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8010/docs || (echo "FAILED"; kill $$BACKEND_PID; exit 1); \
	echo "--- GET /api/system/status ---"; curl -sf http://127.0.0.1:8010/api/system/status || echo "(non-fatal: status check may report degraded services this smoke test doesn't start, e.g. Ollama)"; \
	kill $$BACKEND_PID; \
	echo "Smoke test OK — backend started, served requests, stopped cleanly."

clean:
	rm -rf frontend/dist frontend/src-tauri/target
	find . -name "__pycache__" -not -path "./venv/*" -exec rm -rf {} + 2>/dev/null || true
