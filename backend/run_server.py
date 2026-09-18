"""Entrypoint for the packaged (PyInstaller) backend sidecar.

Not used in dev — start.sh/arynwood-desktop.sh/arynwood-app.sh all invoke
`uvicorn backend.api:app` directly against the live venv, which supports --reload
and is simpler for iterating. This script exists only so PyInstaller has a single
concrete script to analyze; it binds to the same 127.0.0.1:8010 default as every
dev launcher (see CLAUDE.md's port-unification note) so the frontend's
`import.meta.env.PROD` fetch/WebSocket base URLs (frontend/src/main.tsx,
frontend/src/lib/ws.ts) work unmodified against a packaged build.
"""
import os
import uvicorn

# Import the app object directly rather than passing the "backend.api:app" string
# to uvicorn.run() — uvicorn resolves a string target via its own importlib call at
# runtime, which doesn't reliably find a PyInstaller-frozen package (confirmed:
# ModuleNotFoundError: No module named 'backend' from inside the built binary). A
# plain `import` statement goes through PyInstaller's own frozen import machinery
# instead and works fine.
from backend._frozen import die_with_parent, sanitize_environ_for_children
from backend.api import app

if __name__ == "__main__":
    # Before anything can spawn a child: the AppImage/PyInstaller environment is meant for this process
    # only, and breaks every sidecar and GPU-tool subprocess (see sanitize_environ_for_children).
    sanitize_environ_for_children()
    die_with_parent()      # the shell hard-kills its bootloader on quit; don't be left squatting :8010
    host = os.environ.get("ARYNWOOD_BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("ARYNWOOD_BACKEND_PORT", "8010"))
    uvicorn.run(app, host=host, port=port, reload=False)
