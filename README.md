# Arynwood MCP

<p align="center"><img src="frontend/src-tauri/icons/128x128@2x.png" width="128" height="128" alt="The Arynwood tree" /></p>

**A personal AI and creative workspace for your desktop.** Work with local models,
your documents, a design canvas, audio and video tools, and supervised Model
Context Protocol (MCP) integrations. Connect your own Arynwood Grove for shared
calendars, files and community spaces.

[Website](https://arynwood.com/mcp/) · [Downloads](https://github.com/Arynwood-Technology/ArynwoodMCP/releases/latest) · [Documentation](docs/README.md) · [Browser demo](https://arynwood-technology.github.io/ArynwoodMCP/)

[![CI](https://github.com/Arynwood-Technology/ArynwoodMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/Arynwood-Technology/ArynwoodMCP/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Arynwood-Technology/ArynwoodMCP)](https://github.com/Arynwood-Technology/ArynwoodMCP/releases/latest)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Arynwood-Technology/ArynwoodMCP/badge)](https://scorecard.dev/viewer/?uri=github.com/Arynwood-Technology/ArynwoodMCP)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/15880/badge)](https://www.bestpractices.dev/projects/15880)

## Current standing

Arynwood MCP is an **open-source desktop alpha**, for one owner on one machine.
Linux x86_64 AppImage and `.deb` packages and a Windows x64 installer are available.
**0.5.3 is the current published release; 0.5.4 is in release preparation.**
Check [Releases](https://github.com/Arynwood-Technology/ArynwoodMCP/releases) for
publication status; a draft or a successful test run is not a published update.

The 0.5.4 candidate brings security fixes, stricter desktop browser policy,
PCM microphone recording, a first-play WebAudio audition fix and updated desktop
dependencies. It also adds hashed Python build dependencies and bounded IRC
property fuzzing. [Release notes](docs/releases/0.5.4.md) · [Verification record](docs/releases/0.5.4-readiness.md).

Main requires pull requests and passing backend, frontend, API-reference and
Windows checks. CodeQL and OpenSSF Scorecard run alongside the test workflows.
The best-practices badge is in progress; some upstream dependency advisories and
maintenance findings remain. These checks describe evidence and work still to do,
not a security certification. [Scorecard follow-up](docs/scorecard-status.md).

## What you can do

| Work | What MCP provides |
|---|---|
| Chat and research | Local or configured remote model endpoints, personas, document retrieval and owner-controlled memory |
| Creative work | Design canvas, recording and audio workflows, captions and video editing integrations |
| Supervised tools | MCP server connections, including Kdenlive editing through Cutroom's tool server |
| Community | Your Grove's calendars, tasks, files, messages and website previews inside the app |
| Models and services | Endpoint configuration, service status and separately installed creative sidecars |

Models, Qdrant and creative sidecars are installed separately. Some workflows need
additional hardware or a source checkout. Read the [feature guide](docs/features.md),
[known limitations](docs/known-limitations.md) and
[packaged-build exclusions](docs/installation.md#features-that-dont-work-in-the-packaged-build)
before choosing a workflow. The gateway is experimental, owner-only and off by default.

The [browser demo](https://arynwood-technology.github.io/ArynwoodMCP/) uses the real
interface with clearly marked fixture data and scripted conversations. It runs no
backend or live model.

![The Chat page in the browser demo](docs/images/arynwood-mcp-demo.png)

## Install

Download the latest **published** packages from
[GitHub Releases](https://github.com/Arynwood-Technology/ArynwoodMCP/releases/latest).

- **Linux AppImage:** make the downloaded file executable and run it.
- **Debian/Ubuntu:** install the downloaded `.deb` with `sudo apt install ./arynwood-mcp_*.deb`.
- **Windows:** run the x64 per-user installer. It is not Windows code-signed; see the [Windows guide](docs/windows.md).

Linux packages target glibc 2.35 or newer. Models and supporting services are separate;
a GPU is optional for basic chat, while generation tools have their own requirements.
[Platform requirements](docs/supported-platforms.md) · [Installation and first run](docs/installation.md).

**Verify downloads before running them.** Published 0.5.3 has build checksums but
no provenance attestations or release-key signature. The 0.5.4 release process adds
per-package GitHub attestations and requires the owner to sign the combined
`SHA256SUMS` before publication. Follow the instructions for the version you download.
[Download verification](docs/release-signing.md#verifying-a-download).

## Run from source

Requires Python 3.11+, Node.js 20.19+ or 22.12+, npm and a separately configured model service.

```bash
git clone https://github.com/Arynwood-Technology/ArynwoodMCP.git
cd ArynwoodMCP
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
npm --prefix frontend ci
cp .env.example .env
./start.sh
```

Configure the copied environment file for your setup. The interface opens at
http://localhost:5180 and the API at http://localhost:8010.
Knowledge search also needs Qdrant and an embedding model.
[Source setup](docs/installation.md#running-from-source-current-always-available) · [API reference](docs/api/README.md).

## Ownership and security

Your default model inference, conversations and memory run on your hardware.
Network features contact outside services when used: web search, URL learning,
downloads, publishing, deployment, social services, IRC and configured remote
endpoints. There is no enforced offline mode or OS sandbox.

Destructive and publishing MCP calls require approval for the exact operation.
Direct owner controls have separate limits, and this is not a hardened multi-user
service. Read [SECURITY.md](SECURITY.md) and [scope](docs/scope.md).
Report vulnerabilities privately through
[GitHub security advisories](https://github.com/Arynwood-Technology/ArynwoodMCP/security/advisories/new).

## Development and license

Arynwood Technology maintains the scope, architecture, review, tests and releases.
[Contributing](CONTRIBUTING.md) · [How we build](https://github.com/Arynwood-Technology/.github/blob/main/HOW-WE-BUILD.md) · [Project history](docs/history.md).

Code is licensed under [GNU AGPL-3.0-only](LICENSE). Releases through 0.5.3 used an
earlier source-available license. The Arynwood tree logo and app icons are separate
artwork, all rights reserved; the code license does not grant rights to that branding.
