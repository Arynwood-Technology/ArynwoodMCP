"""The desktop packages describe the app the same way its AppStream file does.

The .deb's control file is built from tauri.conf.json and Cargo.toml: Maintainer from Cargo's
`authors` (then `bundle.publisher`, then the identifier's second part, which gave "arynwood" up to
0.5.5), Homepage from `bundle.homepage`, and the long Description from `bundle.longDescription`
(empty became "(none)"). Ubuntu's App Center shows those fields for a downloaded .deb."""

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAURI = ROOT / "frontend" / "src-tauri"


def _bundle() -> dict:
    return json.loads((TAURI / "tauri.conf.json").read_text())["bundle"]


def _cargo() -> dict:
    return tomllib.loads((TAURI / "Cargo.toml").read_text())["package"]


def _metainfo() -> str:
    return (TAURI / "linux" / "com.arynwood.mcp.metainfo.xml").read_text()


def test_the_deb_has_a_maintainer_homepage_and_description():
    bundle, cargo, meta = _bundle(), _cargo(), _metainfo()
    developer = re.search(r"<developer[^>]*>\s*<name>([^<]+)</name>", meta).group(1)
    assert cargo["authors"] == [developer], "Maintainer comes from Cargo authors; keep it the AppStream developer"
    homepage = re.search(r'<url type="homepage">([^<]+)</url>', meta).group(1)
    assert bundle["homepage"] == cargo["homepage"] == homepage
    assert len(bundle["longDescription"].split()) > 20


def test_the_license_is_the_same_everywhere():
    project_license = re.search(r"<project_license>([^<]+)</project_license>", _metainfo()).group(1)
    assert _bundle()["license"] == _cargo()["license"] == project_license == "AGPL-3.0-only"


def test_the_windows_publisher_is_unchanged():
    # The NSIS installer keeps the install folder under HKCU\Software\<publisher>\<product> and reads it
    # back to uninstall the previous version during an upgrade. 0.5.5 and earlier used the derived
    # publisher "arynwood"; setting bundle.publisher would make the next upgrade look in another key.
    # Set it only together with an installer step that carries the old key over.
    assert "publisher" not in _bundle()


def test_the_copyright_is_arynwood_llc_everywhere():
    # bundle.copyright becomes the Windows installer's LegalCopyright and branding text; the .deb carries a
    # Debian copyright file and the license text, since the bundler writes neither.
    bundle = _bundle()
    assert bundle["copyright"] == "Copyright © 2025-2026 Arynwood LLC"
    deb_files = bundle["linux"]["deb"]["files"]
    assert deb_files["/usr/share/doc/arynwood-mcp/copyright"] == "linux/copyright"
    assert (TAURI / deb_files["/usr/share/doc/arynwood-mcp/LICENSE"]).resolve() == ROOT / "LICENSE"
    copyright_file = (TAURI / "linux" / "copyright").read_text()
    assert copyright_file.startswith("Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/")
    assert copyright_file.count("Copyright: 2025-2026 Arynwood LLC") == 2
    assert "\nLicense: AGPL-3.0-only\n This program is free software" in copyright_file
    assert "Copyright © 2025-2026 Arynwood LLC." in (ROOT / "README.md").read_text()
