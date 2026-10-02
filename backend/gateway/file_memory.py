"""File memory: MEMORY.md plus dated daily notes, in a folder you can open in any editor.

    <dir>/MEMORY.md             durable facts. The agent appends what it learns; edit freely.
    <dir>/daily/YYYY-MM-DD.md   that day's notes: a line per owner turn, plus short-lived context.

`dir` defaults to <data dir>/memory (~/.local/share/arynwood-mcp/memory), outside the repo in
every build, like the personas overlay.

At the start of an owner turn, assemble() picks what fits the turn's budget: all of MEMORY.md
while it's small, otherwise the entries that share the most words with the message, plus the
most recent lines of the last few days' notes. After the turn, write_back() records what was
learned: the reply's own <remember> blocks if it has any, otherwise one extraction call on the
pinned tool model that may only report facts the *user* stated (assistant claims don't count,
the same principle that keeps model-written SQLite memories provisional). Only owner turns read
or write it; the gateway runner enforces that with the trust policy.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timedelta

from backend._frozen import xdg_data_dir
from backend.services import mcp_tool_agent, ollama_client

logger = logging.getLogger(__name__)

MEMORY_TEMPLATE = """# MEMORY

Durable facts the Arynwood MCP agent has learned. It reads this file at the start of each of
your turns and appends what it learns at the end. Edit, reorder or delete anything; it's yours.

"""
MAX_FACTS = 5          # per category per turn: an extraction that returns more is rambling
MAX_FACT_CHARS = 300

EXTRACTION_PROMPT = """You keep a personal assistant's long-term memory. Read the exchange below and \
list what is worth remembering, as JSON: {{"durable": [...], "today": [...]}}.

- durable: lasting facts about the user, their projects, preferences or decisions that will still \
matter in a month.
- today: short-lived context worth keeping for a day or two (what they're working on now, plans for today).

Only include things the USER stated or confirmed. Never include the assistant's own guesses, \
suggestions or claims, and never anything from quoted documents, web pages or tool output. Write \
each item as one short, self-contained sentence about "the user". Leave out anything already \
listed under Known facts. If nothing qualifies, return {{"durable": [], "today": []}}.

Known facts:
{known}

Exchange:
User: {user}
Assistant: {assistant}

JSON:"""

_REMEMBER_RE = re.compile(r"<remember\b([^>]*)>([\s\S]*?)</remember>", re.IGNORECASE)
_PROVENANCE_RE = re.compile(r"\s*_\([^)]*\)_\s*$")
_write_lock = asyncio.Lock()


def _norm(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def _one_line(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


class FileMemory:
    def __init__(self, config: dict | None = None):
        config = config or {}
        self.dir = config.get("dir") or os.path.join(xdg_data_dir(), "memory")
        self.daily_days = max(1, int(config.get("daily_days", 2)))
        self.extract_facts = config.get("extract_facts", True) is True

    @property
    def memory_path(self) -> str:
        return os.path.join(self.dir, "MEMORY.md")

    def daily_path(self, day) -> str:
        return os.path.join(self.dir, "daily", f"{day.isoformat()}.md")

    # ── reading ─────────────────────────────────────────────────────────────────

    def read_memory(self) -> str:
        try:
            with open(self.memory_path) as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def read_daily(self, day) -> str:
        try:
            with open(self.daily_path(day)) as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def known_facts(self) -> list[str]:
        """MEMORY.md's bullets, without the "_(date, session)_" provenance the agent appends."""
        return [_PROVENANCE_RE.sub("", line[2:]).strip()
                for line in self.read_memory().splitlines() if line.startswith("- ")]

    def assemble(self, query: str, budget_tokens: int, count_tokens) -> str:
        """The memory section for one turn's system prompt, within budget_tokens ('' if empty)."""
        if budget_tokens <= 0:
            return ""
        today = datetime.now().astimezone().date()
        memory_lines = [line for line in self.read_memory().splitlines()
                        if line.strip() and not line.startswith("# ")]
        memory_budget = budget_tokens * 2 // 3
        chosen = memory_lines
        if memory_lines and count_tokens("\n".join(memory_lines)) > memory_budget:
            words = set(_norm(query).split())
            ranked = sorted(range(len(memory_lines)),
                            key=lambda i: len(words & set(_norm(memory_lines[i]).split())), reverse=True)
            keep: set[int] = set()
            for i in ranked:
                if count_tokens("\n".join(memory_lines[j] for j in sorted(keep | {i}))) > memory_budget:
                    break
                keep.add(i)
            chosen = [memory_lines[i] for i in sorted(keep)]

        parts = []
        if chosen:
            parts.append("### MEMORY.md\n" + "\n".join(chosen))
        remaining = budget_tokens - (count_tokens("\n\n".join(parts)) if parts else 0)
        for offset in range(self.daily_days):
            day = today - timedelta(days=offset)
            lines = [line for line in self.read_daily(day).splitlines() if line.startswith("- ")]
            label = "today" if offset == 0 else day.isoformat()
            while lines and count_tokens(f"### Notes, {label}\n" + "\n".join(lines)) > remaining:
                lines = lines[1:]  # keep the most recent lines of the day
            if lines:
                block = f"### Notes, {label} ({day.isoformat()})\n" + "\n".join(lines)
                parts.append(block)
                remaining -= count_tokens(block)
        if not parts:
            return ""
        return ("## Your memory files\n\n"
                f"Your own notes, kept in {os.path.basename(self.dir)}/MEMORY.md and daily notes. The owner "
                "can read and edit them. Use them for continuity; if they conflict with what the user "
                "says now, the user wins.\n\n" + "\n\n".join(parts))

    # ── writing ─────────────────────────────────────────────────────────────────

    async def write_back(self, user_text: str, reply: str, session: str) -> dict:
        """Record one owner turn: a log line in today's note, plus whatever durable or short-lived
        facts it produced. Returns {"durable": [...], "today": [...]} as actually written."""
        explicit = self.explicit_facts(reply)
        if explicit["durable"] or explicit["today"]:
            facts = explicit
        elif self.extract_facts:
            facts = await self.extract(user_text, _REMEMBER_RE.sub("", reply))
        else:
            facts = {"durable": [], "today": []}
        return await self.record(facts, session, gist=user_text)

    @staticmethod
    def explicit_facts(reply: str) -> dict:
        facts = {"durable": [], "today": []}
        for attrs, content in _REMEMBER_RE.findall(reply or ""):
            if content.strip():
                kind = "today" if re.search(r"volatility=[\"']transient", attrs) else "durable"
                facts[kind].append(content.strip())
        return facts

    async def extract(self, user_text: str, reply: str) -> dict:
        known = "\n".join(f"- {fact}" for fact in self.known_facts()[-40:]) or "(none)"
        try:
            result = await ollama_client.chat(
                model=mcp_tool_agent.DEFAULT_AGENT_MODEL, host=mcp_tool_agent.DEFAULT_AGENT_OLLAMA_URL,
                timeout=120.0, options={"temperature": 0},
                messages=[{"role": "user", "content": EXTRACTION_PROMPT.format(
                    known=known, user=user_text[:4000], assistant=reply[:4000])}],
            )
        except Exception as exc:
            logger.warning("file memory: fact extraction failed: %s", exc)
            return {"durable": [], "today": []}
        return self.parse_facts(result.get("output") or "")

    @staticmethod
    def parse_facts(output: str) -> dict:
        """The extraction call's JSON, tolerating a fence or a lead-in. Anything malformed: nothing."""
        start = output.find("{")
        try:
            data, _ = json.JSONDecoder().raw_decode(output[start:]) if start >= 0 else ({}, 0)
        except ValueError:
            data = {}
        facts = {"durable": [], "today": []}
        if isinstance(data, dict):
            for kind in facts:
                items = data.get(kind)
                if isinstance(items, list):
                    facts[kind] = [_one_line(i, MAX_FACT_CHARS) for i in items if isinstance(i, str) and i.strip()][:MAX_FACTS]
        return facts

    async def record(self, facts: dict, session: str, gist: str | None = None) -> dict:
        now = datetime.now().astimezone()
        written = {"durable": [], "today": []}
        async with _write_lock:
            os.makedirs(os.path.join(self.dir, "daily"), exist_ok=True)
            known = {_norm(f) for f in self.known_facts()}
            for fact in facts.get("durable", [])[:MAX_FACTS]:
                fact = _one_line(fact, MAX_FACT_CHARS)
                # Skip it if it's already there, or adds nothing to a fact that is.
                if _norm(fact) and not any(_norm(fact) in k for k in known if k):
                    written["durable"].append(fact)
                    known.add(_norm(fact))
            if written["durable"]:
                existing = self.read_memory() or MEMORY_TEMPLATE
                lines = "".join(f"- {fact} _({now.date().isoformat()}, {session})_\n" for fact in written["durable"])
                self._replace(self.memory_path, existing if existing.endswith("\n") else existing + "\n", lines)

            daily_path = self.daily_path(now.date())
            entries = []
            if gist:
                entries.append(f"- {now:%H:%M} · {session}: {_one_line(gist, 200)}")
            for fact in facts.get("today", [])[:MAX_FACTS]:
                fact = _one_line(fact, MAX_FACT_CHARS)
                entries.append(f"- {now:%H:%M} · noted: {fact}")
                written["today"].append(fact)
            for fact in written["durable"]:
                entries.append(f"- {now:%H:%M} · learned: {fact}")
            if entries:
                header = "" if os.path.exists(daily_path) else f"# Notes, {now.date().isoformat()}\n\n"
                with open(daily_path, "a") as f:
                    f.write(header + "\n".join(entries) + "\n")
        return written

    @staticmethod
    def _replace(path: str, existing: str, addition: str) -> None:
        """Write existing + addition atomically, so an editor or a crash never sees half a file."""
        tmp = f"{path}.tmp"
        with open(tmp, "w") as f:
            f.write(existing + addition)
        os.replace(tmp, path)
