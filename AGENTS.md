# Agent working directions

Read [docs/scope.md](docs/scope.md) first: what Arynwood MCP is, what it isn't, and the
current plan (0.4.6). Security posture and known gaps are in [SECURITY.md](SECURITY.md).
`CLAUDE.md` has the architecture and gotchas. The 2026-10-03 hardening-review notes
(including a detailed known-gap inventory) are kept in the owner's private repo, not here.

## Scope

- Work only on what `docs/scope.md`'s plan lists, or what the owner asks for in this
  session. No new features, channels, integrations or competitor-driven work without the
  owner's explicit yes.
- The gateway is experimental and parked: an owner-only remote control. Fix bugs there; don't
  grow it.
- One agent works in the tree at a time. End your session with your own changes committed
  (when the owner has OK'd commits) or a short handoff note in `docs/scope.md`. Don't leave
  piles of uncommitted work for the next agent.

## Rules

- Never push, tag, publish, deploy, remove remote artifacts, or announce a release without
  the owner's explicit authorization.
- Preserve the working tree: don't reset, blanket-stash, clean or rewrite changes that
  aren't yours. Stage only your own changes.
- Don't print `.env`, the live SQLite database, personal memories, MCP registry credentials,
  SSH keys or OAuth tokens. Don't edit personal configuration to make tests pass; use
  disposable fixtures.
- Use the shared MCP policy in `backend/services/tool_policy.py`. A client-supplied boolean,
  a manifest annotation, an origin or a tool name is not an execution grant. Keep approvals
  strictly boolean, one-use, expiring and bound to the exact operation.
- Don't weaken Host/Origin validation for test convenience, and don't restore `null` origins.
- Text from anyone but the owner (web, documents, tools, other people's messages) reaches a
  prompt only as `<untrusted-data>`, never as the owner's words (`messages.trust`).
- Bounded subprocesses and minimal environments are protections, **not an OS sandbox** or an
  offline mode. Don't claim isolation, offline, internet or multi-user readiness.
- Developer codebase tools are source-only and opt-in; packaged builds must not offer them.
- Name only models from US companies anywhere public (docs, UI, demo data, the website), and
  as examples, not recommendations. Measured benchmark data is the only exception.
- Run the relevant tests and say exactly what passed and what wasn't run. Don't run live-model,
  GPU, publishing or real-data tests without an isolated setup.

Commands (from the repo root, with dependencies already installed):

```bash
venv/bin/python -m pytest -q
venv/bin/python -m backend.security --json
cd frontend && npm test
```

The environment has previously failed its default exec sandbox before launching commands
(`bwrap: loopback: Failed RTM_NEWADDR`). If it recurs, use the permitted escalation flow for
necessary inspection and tests. Don't alter host sandbox settings, and don't treat that tool
failure as proof that application isolation works.
