# Scope

**Decided 2026-10-03 by the owner.** This page sets what Arynwood MCP is, what it isn't,
and the plan for the next release. It is the yardstick for new work and for agents working
in this repository. Security posture and known gaps are in [SECURITY.md](../SECURITY.md).

## What Arynwood MCP is

**One person's local creative workspace, with supervised automation.** One owner and one
machine, with that owner's models, files and GPU. The assistant reads, drafts, generates and
proposes. The owner decides anything that can't be taken back.

- **Creative work, locally:** chat with personas; learned documents; image, voice, music and
  video generation; Kdenlive editing; design tools. Local models through Ollama by default.
- **Supervised tools:** destructive and publishing actions run only after the owner's
  explicit yes for that exact call. With nobody to approve, the action is denied.
- **Memory the owner can read and edit,** written only from the owner's own turns.
- **Remote control, experimental and parked:** the gateway lets the owner reach their own
  workspace over a local API or their own IRC server. It answers the owner's services account
  only, and is off unless started ([docs/gateway.md](gateway.md)).

## What it isn't

- **Not a chat bot for other people.** The gateway doesn't talk with strangers or other
  accounts.
- **Not in a race for more channels or integrations,** and not shaped by other products.
  Adopting an outside agent framework was considered and rejected: it would replace the parts
  of Arynwood MCP that were just hardened.
- **Not shared, hosted or multi-user.** Trust levels are one owner's settings, not tenant
  isolation.
- **Not unattended.** No scheduled publishing, deleting or self-modification.
- **Not a showcase for any model maker.** Models named in docs, the app and the website are
  from US companies, offered as examples, not recommendations. The default is chosen by
  measurement ([tool-calling benchmark](https://github.com/Arynwood-Technology/local-ai-benchmarks/blob/main/TOOL-CALLING.md)).
  Published benchmark data is the only place other models appear.
- **Not "nothing leaves your machine".** It's local by default, and the docs name every way
  data can leave: web search, URL learning, downloads, publishing, deploys, IRC, and remote
  model servers. Enforced offline mode doesn't exist.

## How it stays this size

- **New capabilities need the owner's explicit yes.** The proposal says who can trigger it,
  what it can change, what leaves the machine, and how it fails closed.
- **One agent works in the tree at a time.** A session ends with its own changes committed
  (when the owner has OK'd commits) or a short handoff note. Nothing piles up uncommitted
  for the next agent.
- **Small, frequent releases.** Fixes ship. They don't wait on unrelated future work.

## Plan for 0.4.6

1. **Freeze.** No new features, channels or integrations until 0.4.6 ships. *(done: 0.4.6 published 2026-10-04)*
2. **Park the gateway.** It's off by default and owner-only on IRC; README and docs mark it
   experimental. *(done)*
3. **Two documents:** this page, and [SECURITY.md](../SECURITY.md). The hardening review's
   working notes moved to the owner's private repo, since they inventory known gaps in
   detail. *(done)*
4. **Commit in themed commits:** the earlier creative and tool fixes, the security hardening,
   and the gateway parking. `docs/writer-tuning-status.md` stays uncommitted (private
   personas). *(done, pushed)*
5. **Release checks,** all on a clean committed tree:
   - full backend and frontend test suites, plus the frontend build;
   - the frozen backend smoke test (`scripts/smoke_packaged_backend.py`);
   - the AppImage media check (`scripts/check_webkit_media.py`);
   - the Windows CI build;
   - `python -m backend.security` showing no new warnings;
   - one real approve and one real deny click in a packaged build against a live Kdenlive.

   *(done; still open: an install on a clean Windows machine)*
6. **Release:** version bump, notes (`docs/releases/0.4.6.md`) telling 0.4.5 users to update,
   tag and push. *(done: published 2026-10-04)* The README and the website's MCP page no longer
   compare Arynwood MCP with other products, and mark the gateway experimental. *(done 2026-10-03)*
7. **Then back to the core:** dependable creative workflows. Documents to a sourced outline,
   video to captions and a reviewed export, a creative brief to a media draft.

## Before Arynwood grows

These must be true before the gateway leaves experimental, before developer tools reach the
packaged app, before any network exposure beyond the owner's machine, and before anything
hosted or multi-user. They don't block fixing what has already shipped.

- [ ] Tool execution runs in an OS sandbox that keeps out files, network and credentials. It
      is tested against malicious code, and protected jobs refuse to run without it.
- [ ] Every action route (deploys, social posts, installs, studio jobs) goes through the same
      approval policy as agent tool calls.
- [ ] A desktop login works for the API, WebSocket, media, downloads and OAuth, with
      short-lived WebSocket credentials.
- [ ] An egress policy and offline mode are enforced, verified by observed network traffic,
      background jobs and sidecars included.
- [ ] Credentials are protected: owner-only file permissions, redacted logs and exports, and
      a tested backup and restore.
- [ ] Real packaged-client tests on Linux and Windows show the webview can't be steered to
      untrusted pages and doesn't grant camera or microphone silently.
