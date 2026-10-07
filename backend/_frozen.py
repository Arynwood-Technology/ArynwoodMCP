import ctypes
import os
import re
import signal
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


def xdg_data_dir() -> str:
    """Per-user data dir: LOCALAPPDATA on Windows, XDG_DATA_HOME elsewhere.

    The same place in a source checkout and a packaged build, and never inside the repo —
    unlike user_data_dir(), which is the repo root when running from source. Use it for
    things that must live OUTSIDE the checkout (e.g. the private persona overlay), so they
    can't be committed by accident. Creates nothing.
    """
    if sys.platform == "win32":
        data_home = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    else:
        data_home = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(data_home, "arynwood-mcp")


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
    data_dir = xdg_data_dir()
    os.makedirs(data_dir, exist_ok=True)
    return data_dir


# Launch descriptors set by AppRun — they describe how the app was started, they don't steer child
# processes, and APPDIR's own value is the prefix we match against.
_KEEP_VARS = {"APPDIR", "APPIMAGE", "ARGV0", "OWD"}


# PyInstaller onefile extracts to <tmp>/_MEIxxxxxx; the bootloader's dir isn't always this process's own
# sys._MEIPASS, so recognise those directories by shape too.
_MEI_DIR = re.compile(r"(^|/)_MEI[A-Za-z0-9_]+(/|$)")


def _bundle_prefixes(environ) -> list[str]:
    prefixes = []
    for candidate in (environ.get("APPDIR"), getattr(sys, "_MEIPASS", None)):
        if candidate:
            prefixes.append(os.path.normpath(candidate))
    return prefixes


def sanitize_environ_for_children(environ=None) -> list[str]:
    """Remove entries that point into the AppImage/PyInstaller bundle from `environ` (default:
    os.environ, so every child process inherits the result). Returns the variable names changed.

    A packaged backend is launched with PYTHONHOME, PYTHONPATH, LD_LIBRARY_PATH, PATH and friends
    pointing into its own read-only bundle. That is right for the backend and fatal for any *other*
    program it starts: a sidecar's own venv Python given the bundle's PYTHONHOME dies at startup with
    "No module named 'encodings'" (seen with every music/voice/stem/whisper sidecar), and bundled
    libraries shadow the system's for tools like ffmpeg. Only bundle-rooted components are dropped —
    a user's own entries (e.g. a CUDA lib dir) survive — and a variable left empty is removed.

    On Windows also clear PyInstaller's process-wide SetDllDirectory setting so child Python
    interpreters do not load DLLs from this bundle. On POSIX the running process is unaffected:
    the loader read LD_LIBRARY_PATH at exec time. No-op when the process is not bundled.
    """
    environ = os.environ if environ is None else environ
    prefixes = _bundle_prefixes(environ)
    if not prefixes:
        return []

    if sys.platform == "win32":
        # Environment cleanup cannot undo the process-wide DLL search path set by
        # the PyInstaller bootloader; sidecars can use a different Python version.
        ctypes.windll.kernel32.SetDllDirectoryW(None)

    def in_bundle(component: str) -> bool:
        norm = os.path.normpath(component) if component else ""
        return bool(_MEI_DIR.search(norm)) or any(norm == p or norm.startswith(p + os.sep) for p in prefixes)

    changed = []
    for name in list(environ):
        if name in _KEEP_VARS:
            continue
        components = environ[name].split(os.pathsep)
        if not any(in_bundle(c) for c in components):
            continue
        # An empty entry means "current directory" in PYTHONPATH/PATH — not something to leave behind.
        kept = [c for c in components if c and not in_bundle(c)]
        if kept:
            environ[name] = os.pathsep.join(kept)
        else:
            del environ[name]
        changed.append(name)
    return changed


def die_with_parent(sig: int = signal.SIGTERM) -> bool:
    """Ask the kernel to send `sig` to this process when its parent dies (Linux PR_SET_PDEATHSIG).

    The desktop shell stops the backend with a hard kill, which runs no cleanup — so anything that only
    exits "when told to" outlives it, holding its port and (for the sidecars) GPU memory. This is enforced
    by the kernel, so it also works after SIGKILL. Use it as `preexec_fn` for a child, and call it at
    startup in the packaged backend so *it* dies with the shell (a PyInstaller onefile backend is a
    bootloader parent plus a Python child; killing the bootloader used to orphan the child on :8010).

    Caveat: "parent" is the *thread* that forked. Spawn from the event-loop (main) thread, not a worker.
    Returns False where unsupported; never raises.
    """
    if not sys.platform.startswith("linux"):
        return False
    try:
        if ctypes.CDLL(None, use_errno=True).prctl(1, int(sig), 0, 0, 0) != 0:   # 1 = PR_SET_PDEATHSIG
            return False
    except Exception:
        return False
    if os.getppid() == 1:            # the parent already died before we could ask: we'd never be signalled
        os.kill(os.getpid(), sig)
    return True


def _process_stat(pid: int) -> tuple[str, str] | None:
    """(state, start time) from /proc/<pid>/stat: the start time (field 22) tells a reused pid
    apart, and state "Z" is a zombie, dead for our purposes. None without /proc."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            fields = f.read().rsplit(")", 1)[1].split()
        return fields[0], fields[19]
    except (OSError, IndexError):
        return None


def exit_with_process(pid: int, interval: float = 1.0, grace: float = 10.0) -> bool:
    """Shut this process down when process `pid` (the desktop app) is gone.

    die_with_parent covers the PyInstaller bootloader, but the bootloader's own parent is the
    desktop app. When the app crashes or is killed, nothing ends the bootloader, so the backend
    lived on holding :8010 and the next launch failed. This watches the app itself: a SIGTERM to
    ourselves runs the normal shutdown (sidecars stopped), then a hard exit after `grace` seconds
    in case that hangs. A daemon thread; Linux and macOS (Windows uses a job object, see main.rs).
    Returns False where unsupported or when the pid isn't running.
    """
    import threading
    import time

    if os.name == "nt" or pid <= 1:
        return False
    first = _process_stat(pid)

    def alive() -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            pass
        if first is None:        # no /proc (macOS): the signal check is all there is
            return True
        now = _process_stat(pid)
        return now is not None and now[0] != "Z" and now[1] == first[1]

    if not alive():
        return False

    def watch():
        while alive():
            time.sleep(interval)
        os.kill(os.getpid(), signal.SIGTERM)
        time.sleep(grace)
        os._exit(0)

    threading.Thread(target=watch, name="exit-with-app", daemon=True).start()
    return True
