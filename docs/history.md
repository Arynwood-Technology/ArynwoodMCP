# History

The public repo was opened on 2026-09-10 with a single import commit, after development in a private repo.

## ArynCore and private development

Arynwood MCP grew out of ArynCore, which started in June 2025. The earliest ArynCore commits are
from 2025-06-09, and the aryncore-mcp repository began on 2025-06-23; both are private. Work
continued there and in a private Arynwood MCP repository until the public import on 2026-09-10,
so the import commit is where the public history starts, not where development started. The
changelog's undated "0.1.0 — initial release" entry is from that private period.

## Arynwood MCP

The first public commit is `c789b1a`, 2026-09-10, "Initial public release".

Dates are when the GitHub release was published (UTC). 0.4.0 and 0.4.1 have no GitHub
release, so their dates come from [CHANGELOG.md](../CHANGELOG.md).

| Version | Date | What changed |
|---|---|---|
| 0.4.0 | 2026-09-10 | First Linux desktop alpha: AppImage and `.deb`, backend bundled as a sidecar, test suites |
| 0.4.1 | 2026-09-11 | The packaged Linux app can reach its own backend (CORS origin fix) |
| 0.4.2 | 2026-09-11 | Story-specific co-writer personas removed from the public build |
| 0.4.3 | 2026-09-22 | Packaged-app fixes: audio, video, downloads and recording; sidecars start; your own personas |
| 0.4.4 | 2026-09-27 | Release packaging fixes: launcher permissions, Ubuntu 22.04 / glibc 2.35 baseline ([notes](releases/0.4.4.md)) |
| 0.4.5 | 2026-09-30 | Windows x64 desktop alpha alongside Linux ([notes](releases/0.4.5.md)) |
| 0.4.6 | 2026-10-04 | Security fixes; Hermes 3 as the default model ([notes](releases/0.4.6.md)) |
| 0.4.7 | 2026-10-09 | CPU mode, chat and image endpoints, MCP hardening ([notes](releases/0.4.7.md)) |
| 0.4.8 | 2026-10-09 | Update notices ([notes](releases/0.4.8.md)) |
| 0.4.9 | 2026-10-10 | The Community page shows your Grove's spaces inside the app ([notes](releases/0.4.9.md)) |
| 0.5.0 | 2026-10-10 | Community with a Grove on a server; contrast pass; security updates ([notes](releases/0.5.0.md)) |
| 0.5.1 | 2026-10-10 | Managing Community spaces ([notes](releases/0.5.1.md)) |
| 0.5.2 | 2026-10-23 | Community screens from Arynwood Grove 0.7.1 ([notes](releases/0.5.2.md)) |
| 0.5.3 | 2026-10-23 | Security release: Pillow 13, checked social uploads, Python 3.11+ ([notes](releases/0.5.3.md)) |
| 0.5.4 | 2026-10-26 | Signed checksums, verified artifacts, recording/audition fixes and security updates ([notes](releases/0.5.4.md)) |

The Community page in Arynwood MCP is a client for Arynwood Grove, which is a separate service.
Build provenance attestations were added after 0.5.3; 0.5.4 is the first release to carry them and owner-signed checksums.

## From Community to Grove

Arynwood Grove is a separate community service with no AI features. Its repository's first
commit, `8aa6fbd` on 2026-09-23, is "Initial Arynwood Community release" (Community 0.3).
Grove 0.4.0 renamed it and added the one-command server install; a Community 0.3 server
upgrades in place. v0.4.0 was tagged on 2026-10-08, and the latest release is v0.7.4
(2026-10-26). Each version is described in
[Grove's release notes](https://github.com/Arynwood-Technology/arynwood-community/blob/main/docs/PRERELEASE.md).
