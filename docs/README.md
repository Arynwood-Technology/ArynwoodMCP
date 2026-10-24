# Documentation

## Using Arynwood MCP

- [Installation](installation.md): packaged builds, running from source, knowledge base setup, uninstalling
- [Supported platforms](supported-platforms.md): OS and hardware requirements, CPU mode
- [Windows](windows.md): the Windows alpha's install, build and limitations
- [Known limitations](known-limitations.md): what is reliable, what needs a caveat, what is early
- [Troubleshooting](troubleshooting.md): common problems
- [Feature guide](features.md): every page of the app
- [Studio setup](studio.md): the MusicStudio sidecars and the Studio roadmap
- [Endpoints](endpoints.md): run chat and images on another computer
- [Community](community.md): the Community page and choosing your Grove
- [Customizing personas](customizing-personas.md)
- [Gateway](gateway.md): the experimental, owner-only remote control

## Releases and history

Version **0.5.3** ships a Windows x64 desktop alpha (an unsigned per-user installer, first
published in 0.4.5) alongside the Linux AppImage and `.deb`, which keep the Ubuntu 22.04 / glibc 2.35
baseline. Models and supporting services are installed separately on both. Download published packages from [GitHub Releases](https://github.com/Arynwood-Technology/ArynwoodMCP/releases).

- [History](history.md): ArynCore, every public version, and Grove
- [Release overview](release-overview.md): the latest release in more detail
- [`CHANGELOG.md`](../CHANGELOG.md)
- [`releases/0.5.3.md`](releases/0.5.3.md) - packages, checksums, release checks and known issues
- [`releases/0.5.2.md`](releases/0.5.2.md) - Community from Arynwood Grove 0.7.1
- [`releases/0.5.1.md`](releases/0.5.1.md) - managing Community spaces
- [`releases/0.5.0.md`](releases/0.5.0.md) - Community on a server, readable everywhere, security updates
- [`releases/0.4.9.md`](releases/0.4.9.md) - Community inside the app, charcoal look
- [`releases/0.4.8.md`](releases/0.4.8.md) - automatic update notices
- [`releases/0.4.7.md`](releases/0.4.7.md) - CPU mode, endpoints and MCP hardening
- [`releases/0.4.6.md`](releases/0.4.6.md) - the 0.4.6 security update
- [`releases/0.4.5.md`](releases/0.4.5.md) - the 0.4.5 notes
- [`releases/0.4.4.md`](releases/0.4.4.md) - the maintainer upload checklist

## How it is built

- [Architecture](architecture.md): frontend, backend, database, stack and ports
- [Developer guide](guide.md): the chat system, adding routes and pages
- [Structure](structure.md): files, folders and services
- [Scope](scope.md): what Arynwood MCP is and isn't, and the current plan
- [Conversation tuning](conversation-tuning.md): measured prompt and model changes
- [Sycamore integration plan](internal/sycamore-integration-plan.md): how PDF learning works
- [Third-party notices](third-party-notices.md): dependency licenses
- [`SECURITY.md`](../SECURITY.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`LICENSE`](../LICENSE)
- [Internal working notes](internal/README.md): earlier audits, kept for reference
