# local_agent

Config and instructions for the local Ollama model Arynwood delegates tool-calling
to (`backend/services/mcp_tool_agent.py`) — separate from the 5 chat
personas in `../models.json`, which are conversational, not tool-executing.

This exists because a 14B local model navigating 100+ auto-generated tool
schemas from scratch reliably guesses plausible-but-wrong names and doesn't
self-correct (e.g. `get_project_settings` instead of `get_project_info`).
Spelling out the real tool/schema names up front fixes it; these files are
that — plain text, editable without touching Python.

- `config.json` — which model runs the tool-calling loop, and how many
  rounds it gets before being forced to answer.
- `AGENT.md` — behavior rules shared by every tool server (call tools, don't
  narrate; stop once you have the answer; never emit tool-call JSON as a
  final answer).
- `gates.json` — one entry per registered server (must match a key in
  `mcp_servers.json`): a display `label` and a `hints` keyword list. A
  message only triggers that server's tool-calling loop if the server is
  both registered AND a hint matches — see
  `mcp_tool_agent.gather_context_for_message`, which dispatches across every
  gated server (not just one) on every message from the `central` persona.
- `<server>.md` — one per registered MCP server, with the tool names /
  schema / gotchas specific to that server. Loaded via
  `mcp_tool_agent.load_system_prompt("<server>")`, which prepends `AGENT.md`
  automatically.

To wire up a new server: register it in `../mcp_servers.json`, add
`<server>.md` here, and add a `hints` entry for it in `gates.json`. No new
Python module needed — this used to require a `<server>_agent.py` per
server; `gates.json` replaced that pattern.
