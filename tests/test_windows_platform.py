"""Native Windows path and launcher contracts; safe to run on other hosts too."""
import os
import sys
from types import SimpleNamespace

from backend import _frozen, external_paths


def test_windows_data_uses_local_appdata(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, 'platform', 'win32')
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path))
    monkeypatch.setenv('XDG_DATA_HOME', str(tmp_path / 'linux'))
    assert _frozen.xdg_data_dir() == str(tmp_path / 'arynwood-mcp')


def test_windows_data_fallback(monkeypatch):
    monkeypatch.setattr(sys, 'platform', 'win32')
    monkeypatch.delenv('LOCALAPPDATA', raising=False)
    assert _frozen.xdg_data_dir() == os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'arynwood-mcp')


def test_native_venv_interpreter(tmp_path):
    suffix = ('Scripts', 'python.exe') if os.name == 'nt' else ('bin', 'python')
    assert external_paths.venv_python(str(tmp_path)) == os.path.join(str(tmp_path), *suffix)


def test_frozen_state_is_outside_bundle(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, 'platform', 'win32')
    monkeypatch.setattr(sys, 'frozen', True, raising=False)
    monkeypatch.setattr(sys, '_MEIPASS', str(tmp_path / 'bundle'), raising=False)
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path / 'user'))
    assert _frozen.user_data_dir() == str(tmp_path / 'user' / 'arynwood-mcp')
    assert os.path.isdir(_frozen.user_data_dir())


def test_frozen_windows_children_use_system_dll_search(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(sys, 'platform', 'win32')
    monkeypatch.setattr(_frozen.ctypes, 'windll',
                        SimpleNamespace(kernel32=SimpleNamespace(SetDllDirectoryW=calls.append)),
                        raising=False)
    _frozen.sanitize_environ_for_children({'APPDIR': str(tmp_path / 'bundle')})
    assert calls == [None]
