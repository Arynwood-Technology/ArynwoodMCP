"""Release signing (scripts/sign-release.sh, scripts/verify-release.sh, docs/release-signing.md).

Each test makes throwaway OpenPGP keys in its own temporary gpg home: no passphrase, one day's expiry,
deleted with the test. Nothing here touches the owner's keyring or the published release key."""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SIGN = ROOT / "scripts" / "sign-release.sh"
VERIFY = ROOT / "scripts" / "verify-release.sh"
KEY = ROOT / "docs" / "release-signing-key.asc"
RUNBOOK = ROOT / "docs" / "release-signing.md"

needs_tools = pytest.mark.skipif(
    os.name == "nt" or not all(shutil.which(t) for t in ("bash", "gpg", "gpgconf", "sha256sum")),
    reason="needs bash, gpg and sha256sum",
)

PACKAGES = {
    "arynwood-mcp_9.9.9_amd64.AppImage": b"appimage bytes",
    "arynwood-mcp_9.9.9_amd64.deb": b"deb bytes",
    "arynwood-mcp_9.9.9_x64-setup.exe": b"exe bytes",
}


def run(*args, env=None, cwd=None):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, env=env, cwd=cwd, timeout=120)


@pytest.fixture
def gpg_home(tmp_path):
    home = tmp_path / "gnupg"
    home.mkdir(mode=0o700)
    env = {**os.environ, "GNUPGHOME": str(home)}
    yield env
    subprocess.run(["gpgconf", "--homedir", str(home), "--kill", "all"], capture_output=True)


def make_key(env, tmp_path, name):
    uid = f"{name} TEST ONLY <{name.lower()}@example.invalid>"
    r = run("gpg", "--batch", "--passphrase", "", "--quick-gen-key", uid, "ed25519", "sign", "1d", env=env)
    assert r.returncode == 0, r.stderr
    listing = run("gpg", "--batch", "--with-colons", "--list-secret-keys", uid, env=env).stdout
    fpr = next(line.split(":")[9] for line in listing.splitlines() if line.startswith("fpr:"))
    public = tmp_path / f"{name}.asc"
    public.write_text(run("gpg", "--batch", "--armor", "--export", fpr, env=env).stdout)
    return fpr, public


def make_release(tmp_path, crlf_windows_list=True):
    d = tmp_path / "release"
    d.mkdir()
    for name, data in PACKAGES.items():
        (d / name).write_bytes(data)
    linux = run("sha256sum", "arynwood-mcp_9.9.9_amd64.AppImage", "arynwood-mcp_9.9.9_amd64.deb", cwd=d).stdout
    (d / "SHA256SUMS.txt").write_text(linux)
    windows = run("sha256sum", "arynwood-mcp_9.9.9_x64-setup.exe", cwd=d).stdout
    (d / "SHA256SUMS-windows.txt").write_bytes(windows.replace("\n", "\r\n" if crlf_windows_list else "\n").encode())
    return d


@pytest.fixture
def signed(tmp_path, gpg_home):
    fpr, public = make_key(gpg_home, tmp_path, "Release")
    d = make_release(tmp_path)
    r = run(SIGN, "--from-dir", d, "--key", public, "--fingerprint", fpr, env=gpg_home)
    assert r.returncode == 0, r.stdout + r.stderr
    return {"dir": d, "fpr": fpr, "key": public, "env": gpg_home, "sign_output": r.stdout}


def verify(s, d=None, *extra):
    # A user's environment: no GNUPGHOME pointing at the signer's keyring.
    env = {k: v for k, v in os.environ.items() if k != "GNUPGHOME"}
    return run(VERIFY, "--key", s["key"], "--fingerprint", s["fpr"], *extra, d or s["dir"], env=env)


@needs_tools
def test_sign_then_verify_round_trip(signed):
    d = signed["dir"]
    assert (d / "SHA256SUMS.asc").read_text().startswith("-----BEGIN PGP SIGNATURE-----")
    listed = [line.split()[1] for line in (d / "SHA256SUMS").read_text().splitlines()]
    assert listed == sorted(PACKAGES)
    assert "RESULT: PASS" in signed["sign_output"]  # sign-release.sh checks its own result
    r = verify(signed, None, "--require-all")
    assert r.returncode == 0, r.stdout
    assert r.stdout.count("matches SHA256SUMS") == 3
    assert "RESULT: PASS. 3 package(s)" in r.stdout


@needs_tools
def test_one_downloaded_package_passes_and_the_rest_are_skipped(signed, tmp_path):
    user = tmp_path / "user"
    user.mkdir()
    for name in ("SHA256SUMS", "SHA256SUMS.asc", "arynwood-mcp_9.9.9_amd64.AppImage"):
        shutil.copy(signed["dir"] / name, user / name)
    r = verify(signed, user)
    assert r.returncode == 0, r.stdout
    assert "SKIP  arynwood-mcp_9.9.9_amd64.deb (not downloaded)" in r.stdout
    strict = verify(signed, user, "--require-all")
    assert strict.returncode == 1
    assert "FAIL  arynwood-mcp_9.9.9_amd64.deb is listed but not in" in strict.stdout


@needs_tools
def test_a_changed_package_fails(signed):
    (signed["dir"] / "arynwood-mcp_9.9.9_amd64.deb").write_bytes(b"deb bytes, changed")
    r = verify(signed)
    assert r.returncode == 1
    assert "FAIL  arynwood-mcp_9.9.9_amd64.deb does NOT match SHA256SUMS" in r.stdout
    assert "RESULT: FAIL" in r.stdout


@needs_tools
def test_an_edited_checksum_file_fails_the_signature(signed):
    sums = signed["dir"] / "SHA256SUMS"
    sums.write_text(re.sub(r"^[0-9a-f]{64}", "0" * 64, sums.read_text(), count=1))
    r = verify(signed)
    assert r.returncode == 1
    assert "the file was changed after it was signed" in r.stdout


@needs_tools
def test_a_signature_by_another_key_fails(signed, tmp_path):
    d, env = signed["dir"], signed["env"]
    other_fpr, other_public = make_key(env, tmp_path, "Intruder")
    (d / "SHA256SUMS.asc").unlink()
    r = run("gpg", "--batch", "--local-user", other_fpr, "--armor", "--detach-sign", "--output",
            d / "SHA256SUMS.asc", d / "SHA256SUMS", env=env)
    assert r.returncode == 0, r.stderr
    # The intruder's own key file is refused outright...
    r = run(VERIFY, "--key", other_public, "--fingerprint", signed["fpr"], d)
    assert r.returncode == 1 and "is not the release key" in r.stdout
    # ...and a key file carrying both keys still needs the signature to be the release key's.
    both = tmp_path / "both.asc"
    both.write_text(signed["key"].read_text() + other_public.read_text())
    r = run(VERIFY, "--key", both, "--fingerprint", signed["fpr"], d)
    assert r.returncode == 1 and f"not by the release key {signed['fpr']}" in r.stdout


@needs_tools
def test_missing_signature_and_malformed_lines_fail(signed):
    d = signed["dir"]
    sig = (d / "SHA256SUMS.asc").read_bytes()
    (d / "SHA256SUMS.asc").unlink()
    r = verify(signed)
    assert r.returncode == 1 and "SHA256SUMS.asc is missing" in r.stdout
    (d / "SHA256SUMS.asc").write_bytes(sig)
    assert verify(signed).returncode == 0
    # A correctly signed file whose lines aren't plain "<sha256>  <name>" is still refused.
    (d / "SHA256SUMS").write_text((d / "SHA256SUMS").read_text() + "0" * 64 + "  ../outside\n")
    (d / "SHA256SUMS.asc").unlink()
    r = run("gpg", "--batch", "--local-user", signed["fpr"], "--armor", "--detach-sign", "--output",
            d / "SHA256SUMS.asc", d / "SHA256SUMS", env=signed["env"])
    assert r.returncode == 0, r.stderr
    r = verify(signed)
    assert r.returncode == 1 and "line 4 is not" in r.stdout


@needs_tools
def test_unpublished_key_fails_closed(tmp_path):
    # The repository's state until the owner publishes a key: verification refuses, never passes.
    if KEY.exists():
        pytest.skip("a release key is published")
    d = tmp_path / "empty"
    d.mkdir()
    r = run(VERIFY, d)
    assert r.returncode == 1
    assert "no release key has been published yet" in r.stdout


@needs_tools
def test_sign_refuses_without_a_key_or_with_unexpected_files(signed, tmp_path, gpg_home):
    second = tmp_path / "second"
    second.mkdir()
    d = make_release(second)
    args = ("--key", signed["key"], "--fingerprint", signed["fpr"])
    if not KEY.exists():
        r = run(SIGN, "--from-dir", d, env=gpg_home)
        assert r.returncode == 1 and "no release key yet" in r.stderr
    (d / "notes.pdf").write_bytes(b"stray")
    r = run(SIGN, "--from-dir", d, *args, env=gpg_home)
    assert r.returncode == 1 and "unexpected file notes.pdf" in r.stderr
    (d / "notes.pdf").unlink()
    (d / "arynwood-mcp_9.9.9_x64-setup.exe").write_bytes(b"not what CI built")
    r = run(SIGN, "--from-dir", d, *args, env=gpg_home)
    assert r.returncode == 1 and "does not match the downloaded files" in r.stderr
    assert not (d / "SHA256SUMS.asc").exists()
    r = run(SIGN, "--from-dir", signed["dir"], *args, env=gpg_home)
    assert r.returncode == 1 and "already has SHA256SUMS" in r.stderr


def test_published_key_fingerprint_and_docs_agree():
    script = VERIFY.read_text()
    pinned = re.search(r'^RELEASE_KEY_FINGERPRINT="([0-9A-F]*)"$', script, re.M).group(1)
    if not KEY.exists():
        assert pinned == "", "a fingerprint is pinned but docs/release-signing-key.asc is missing"
        return
    assert re.fullmatch(r"[0-9A-F]{40}", pinned)
    assert "PRIVATE KEY" not in KEY.read_text()
    assert pinned in RUNBOOK.read_text().replace(" ", "")
    if shutil.which("gpg"):
        shown = run("gpg", "--batch", "--with-colons", "--show-keys", KEY).stdout
        primaries = re.findall(r"^pub:.*\nfpr:+([0-9A-F]{40}):", shown, re.M)
        assert pinned in primaries
