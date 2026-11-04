"""Release checklist item 1 (docs / Business Plan §17): version numbers must match across
desktop, backend, frontend and package metadata. A mismatch ships a build whose About/API
version disagrees with its filename, and the launcher banners once sat at v0.4.0 while
everything else was 0.4.2 without anyone noticing."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _versions() -> dict[str, str]:
    api_py = (ROOT / "backend" / "api.py").read_text()
    cargo = (ROOT / "frontend" / "src-tauri" / "Cargo.toml").read_text()
    return {
        "frontend/package.json": json.loads((ROOT / "frontend" / "package.json").read_text())["version"],
        "frontend/src-tauri/tauri.conf.json": json.loads(
            (ROOT / "frontend" / "src-tauri" / "tauri.conf.json").read_text())["version"],
        "frontend/src-tauri/Cargo.toml": re.search(r'^version\s*=\s*"([^"]+)"', cargo, re.M).group(1),
        "backend/api.py FastAPI(version=)": re.search(r'FastAPI\([^)]*version="([^"]+)"', api_py).group(1),
    }


def test_all_version_sources_agree():
    versions = _versions()
    assert len(set(versions.values())) == 1, f"version mismatch: {versions}"


def test_launcher_banners_read_the_version_instead_of_hardcoding_it():
    for script in ("start.sh", "arynwood-desktop.sh"):
        text = (ROOT / script).read_text()
        assert not re.search(r"Arynwood MCP\s+v\d+\.\d+\.\d+", text), f"{script} hardcodes a version"
        assert "frontend/package.json" in text, f"{script} should read the version from package.json"


def test_community_screens_name_one_grove_release():
    """The Community page shows which Grove release its screens match, so a stale copy is visible without
    comparing screens (issue #24). The label and NOTICE.md have to name the same release."""
    grove_ts = (ROOT / "frontend" / "src" / "community" / "lib" / "grove.ts").read_text()
    notice = (ROOT / "frontend" / "src" / "community" / "NOTICE.md").read_text()
    label = re.search(r"SCREENS_GROVE_VERSION = '(\d+\.\d+\.\d+)'", grove_ts)
    noticed = re.search(r"match Arynwood Grove (\d+\.\d+\.\d+)", notice)
    assert label and noticed, "grove.ts or NOTICE.md no longer names the Grove release the screens match"
    assert label.group(1) == noticed.group(1), f"grove.ts says {label.group(1)}, NOTICE.md says {noticed.group(1)}"
