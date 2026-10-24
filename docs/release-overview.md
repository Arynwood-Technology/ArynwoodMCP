# Release overview

## Latest release (0.5.3)

0.5.3 is a security release. Pillow, which opens every picture, moves to 13.0.0 (12.3.0 had
35 published advisories); a picture uploaded for a social post is checked and saved again as a
real picture, so a web page can no longer pass as one; and releases build on Node.js 22.23.4.
A source checkout now needs Python 3.11 or newer. 0.5.2 brought the Community page up to Arynwood Grove 0.7.1: a side menu, Messages between
members with photos and files, Public chat, Lists, a space's Files, Webmaster tools with the
site editor and live previews, Look & feel and Grove admin, which need a Grove on 0.7.1 or
later. It also made the desktop app's html-tools (Client Intake, Flowchart, Terminal Hub, Design
Center) and media playback load again, which packaged builds had refused since 0.4.6.
0.5.1 let space owners rename a space, give it a topic, make other members owners and delete
it. 0.5.0 fixed Community with a Grove on a server (such as community.arynwood.com), passed a
contrast check of the whole app, and updated dependencies for security. Since 0.4.9 the Community page shows your Grove's planner, calendar,
tasks, lists, notes, board, discussion and members, from the Grove on this computer or one on
a server. Anyone on 0.4.8 or later sees an update notice; earlier versions need one manual
install. This remains a single-owner desktop alpha with documented
[security limits](../SECURITY.md). See [docs/releases/0.5.3.md](releases/0.5.3.md) and
[docs/community.md](community.md).

**Experimental: headless gateway.** A remote control for your own workspace: reach Arynwood
from your phone over your own IRC server, or over a local API. It answers only your services
account, asks before anything destructive, and keeps a plain-text memory you can edit. It is
off unless you start it, runs from a source checkout, and isn't part of the desktop packages.
See [docs/gateway.md](gateway.md).

## Community and Grove

**Community is shipped since 0.4.9.** Invite-only private spaces for families, friends, teams and small
communities, with no ads and no sales, kept on a Grove: the standalone
[Arynwood Grove](https://github.com/Arynwood-Technology/arynwood-community) service, which
has no AI features, and since 0.4.9 the Community page inside Arynwood MCP. Arynwood MCP is
how you talk to your own AI; Community is how people talk to each other. Messages between
members are kept on the Grove's server and shown only to the two people in the conversation;
they are not end-to-end encrypted.

## Download and demo context

**The packaged alpha** (v0.5.3: AppImage and `.deb` for Linux x86_64, and a Windows x64 installer) covers the core workspace. LoRA training, script-based
GPU tools and the project file browser need a source checkout. Models and supporting services are installed
separately. Requirements and limits: [arynwood.com/mcp](https://arynwood.com/mcp/).

**[Try the live demo →](https://arynwood-technology.github.io/ArynwoodMCP/)** - the real UI, running
entirely in your browser with no install and no backend. Chat streams real scripted
conversations (including a full destructive-tool approval walkthrough), image generation
returns a real placeholder we made, and a banner makes clear throughout that it's demo
data, not a live AI. Features that need a real backend or GPU on your own machine - video
rendering, music generation, publishing, social OAuth - say so plainly and link back here
instead of faking it.

**Website:** [arynwood.com/mcp](https://arynwood.com/mcp/) (requirements, setup steps and FAQ) · **Help getting it running:** [Arynwood setup services](https://arynwood.com/#services)
