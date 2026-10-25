# Arynwood MCP X.Y.Z — <title>

<!-- Template for docs/releases/X.Y.Z.md and for the GitHub draft's notes (release.yml fills the draft from
     CHANGELOG.md; add the "Verify your download" section to it before publishing). Replace X.Y.Z; check the
     fingerprint against ../release-signing.md. For a release that isn't signed, drop SHA256SUMS and SHA256SUMS.asc and the signature step,
     and say so. See ../release-signing.md. -->

## Packages

- `arynwood-mcp_X.Y.Z_amd64.AppImage`: Linux x86_64, any distribution with glibc 2.35 or newer
- `arynwood-mcp_X.Y.Z_amd64.deb`: Debian, Ubuntu and derivatives
- `arynwood-mcp_X.Y.Z_x64-setup.exe`: Windows x64 (alpha), per-user installer
- `SHA256SUMS`: the SHA-256 checksum of every package above
- `SHA256SUMS.asc`: the release key's signature of `SHA256SUMS`
- `SHA256SUMS.txt`, `SHA256SUMS-windows.txt`: the build's own checksum lists

## Changes

<from CHANGELOG.md>

## Verify your download

Release key fingerprint: `C536 F3C4 689A 1734 920A  0E5B F1F8 0C83 C593 8FF0`
Public key: <https://github.com/Arynwood-Technology/ArynwoodMCP/blob/main/docs/release-signing-key.asc>

Put `SHA256SUMS`, `SHA256SUMS.asc` and the package in one folder, import the public key, then:

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --ignore-missing -c SHA256SUMS
```

The first must report `Good signature` from the fingerprint above; the second `OK` for your package. Or run
[`scripts/verify-release.sh`](https://github.com/Arynwood-Technology/ArynwoodMCP/blob/main/scripts/verify-release.sh),
which does both. Windows steps and what to do if a check fails:
[release signing](https://github.com/Arynwood-Technology/ArynwoodMCP/blob/main/docs/release-signing.md#verifying-a-download).

Each package also has a build attestation:
`gh attestation verify <package> -R Arynwood-Technology/ArynwoodMCP`.

## Known issues

<or "None known.">
