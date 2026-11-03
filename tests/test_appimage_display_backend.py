"""The AppImage chooses X11 itself (frontend/src-tauri/src/main.rs).

Up to 0.5.4 the bundler's GTK launch hook exported GDK_BACKEND=x11. The hook that came with the
2026-11 Tauri CLI update no longer does, and on a Wayland desktop the 0.5.5 candidate then ran on
GTK's Wayland backend, which no release had been tested on. main.rs restores the old default for an
AppImage only, and leaves a GDK_BACKEND the user set alone."""

import re
from pathlib import Path

MAIN_RS = Path(__file__).resolve().parent.parent / "frontend" / "src-tauri" / "src" / "main.rs"


def _linux_startup_block() -> str:
    text = MAIN_RS.read_text()
    body = text[text.index("fn main()"):]
    start = body.index('#[cfg(target_os = "linux")]')
    return body[start:body.index("\n    }\n", start)]


def test_an_appimage_defaults_to_x11_unless_the_user_chose_a_backend():
    block = _linux_startup_block()
    assert re.search(
        r'std::env::var_os\("APPIMAGE"\)\.is_some\(\)\s*&&\s*std::env::var_os\("GDK_BACKEND"\)\.is_none\(\)', block
    ), "the X11 default must apply only to an AppImage, and only when GDK_BACKEND is unset"
    assert 'std::env::set_var("GDK_BACKEND", "x11")' in block


def test_it_is_set_before_the_webview_starts():
    text = MAIN_RS.read_text()
    body = text[text.index("fn main()"):]
    assert body.index('set_var("GDK_BACKEND", "x11")') < body.index("tauri::Builder::default()")
