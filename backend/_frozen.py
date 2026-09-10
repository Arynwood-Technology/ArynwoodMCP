import os
import sys


def app_base_dir() -> str:
    """Directory containing app payload data (static/, mcp/config/, etc.) — the repo
    root in a source checkout, or the PyInstaller bundle root (sys._MEIPASS) in a
    packaged build. `__file__`-relative traversal up from a module under backend/
    doesn't reliably land on the same place once PyInstaller has repacked the module
    tree, so anything that needs to find bundled *app* data (not user data — see
    backend/db.py's DB_PATH for that split) should use this instead of hand-rolled
    os.path.dirname(__file__) chains.
    """
    if getattr(sys, "frozen", False):
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def user_data_dir() -> str:
    """Writable directory for mutable app state (DB, generated media) — the repo's
    config/static dirs in a source checkout (unchanged, existing behavior), or the
    XDG user data dir in a packaged build, since the install location (an AppImage's
    read-only squashfs mount, or a /opt-style .deb install path) isn't writable and
    shouldn't hold mutable state regardless. Callers that need a specific
    subdirectory should os.path.join onto this rather than duplicate the frozen
    check themselves.
    """
    if not getattr(sys, "frozen", False):
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_home = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    data_dir = os.path.join(data_home, "arynwood-mcp")
    os.makedirs(data_dir, exist_ok=True)
    return data_dir
