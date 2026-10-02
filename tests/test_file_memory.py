"""File memory (backend/gateway/file_memory.py): MEMORY.md + daily notes, read at the start of
an owner turn and written back after it. Real files in a temp dir; the model is stubbed."""

import asyncio
import json
import os
import uuid
from datetime import datetime, timedelta

import pytest

from backend.gateway import Gateway, InboundMessage, sessions
from backend.gateway.config import load_config
from backend.gateway.file_memory import MAX_FACTS, FileMemory
from backend.services import knowledge, mcp_tool_agent, memory_index, ollama_client


def count(text: str) -> int:
    return len(text) // 4


def today():
    return datetime.now().astimezone().date()


@pytest.fixture()
def memory(tmp_path):
    return FileMemory({"dir": str(tmp_path / "memory"), "daily_days": 2})


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


# ── reading ─────────────────────────────────────────────────────────────────────


def test_empty_memory_assembles_to_nothing(memory):
    assert memory.assemble("anything", 2000, count) == ""


def test_small_memory_and_recent_days_are_included(memory):
    write(memory.memory_path, "# MEMORY\n\n- The cover is teal.\n- The user's IRC network is Hearthnet.\n")
    write(memory.daily_path(today()), "# Notes\n\n- 09:00 · api:x: plan the release\n")
    write(memory.daily_path(today() - timedelta(days=1)), "- 18:00 · api:x: fixed the parser\n")
    write(memory.daily_path(today() - timedelta(days=2)), "- 12:00 · api:x: too old to include\n")
    section = memory.assemble("hello", 2000, count)
    assert "The cover is teal." in section and "Hearthnet" in section
    assert "plan the release" in section and "fixed the parser" in section
    assert "too old" not in section
    assert "\n# MEMORY\n" not in "\n" + section + "\n"   # the file's title line isn't content


def test_large_memory_keeps_the_relevant_entries_in_file_order(memory):
    filler = "".join(f"- Unrelated fact number {i} about gardening and weather.\n" for i in range(200))
    write(memory.memory_path, "- The cover of the book is teal.\n" + filler + "- The user's IRC network is Hearthnet.\n")
    section = memory.assemble("what IRC network do I use for the book?", 300, count)
    assert count(section) <= 300 + 60   # budget plus the fixed heading text
    assert "Hearthnet" in section and "cover of the book is teal" in section
    assert section.index("teal") < section.index("Hearthnet")   # original order kept


def test_daily_notes_keep_their_most_recent_lines(memory):
    lines = "".join(f"- {i:02d}:00 · api:x: entry {i}\n" for i in range(24))
    write(memory.daily_path(today()), lines)
    section = memory.assemble("x", 120, count)
    assert "entry 23" in section and "entry 0\n" not in section


# ── writing ─────────────────────────────────────────────────────────────────────


async def test_record_creates_the_files_and_dedupes(memory):
    written = await memory.record({"durable": ["The cover is teal."], "today": ["Release prep today."]},
                                  "api:me", gist="the cover is teal")
    assert written == {"durable": ["The cover is teal."], "today": ["Release prep today."]}
    text = open(memory.memory_path).read()
    assert text.startswith("# MEMORY") and f"- The cover is teal. _({today().isoformat()}, api:me)_" in text
    note = open(memory.daily_path(today())).read()
    assert note.startswith(f"# Notes, {today().isoformat()}")
    assert "api:me: the cover is teal" in note and "noted: Release prep today." in note
    assert "learned: The cover is teal." in note

    again = await memory.record({"durable": ["the cover is TEAL", "cover is teal"], "today": []}, "api:me")
    assert again["durable"] == []   # restated, and a fragment of a known fact, are both skipped
    assert open(memory.memory_path).read().count("teal") == 1
    assert memory.known_facts() == ["The cover is teal."]   # provenance stripped


async def test_owner_edits_survive_a_write(memory):
    write(memory.memory_path, "# My own title\n\nSomething I wrote by hand.\n")
    await memory.record({"durable": ["New fact."], "today": []}, "api:me")
    text = open(memory.memory_path).read()
    assert text.startswith("# My own title\n\nSomething I wrote by hand.\n") and "- New fact." in text


def test_explicit_remember_blocks_are_sorted_by_volatility():
    reply = ('Sure. <remember title="a">The user prefers British spelling.</remember>'
             '<remember volatility="transient">Working on the IRC adapter today.</remember>')
    assert FileMemory.explicit_facts(reply) == {
        "durable": ["The user prefers British spelling."], "today": ["Working on the IRC adapter today."]}


@pytest.mark.parametrize("output, expected", [
    ('{"durable": ["A"], "today": []}', {"durable": ["A"], "today": []}),
    ('Here you go:\n```json\n{"durable": [], "today": ["B"]}\n```', {"durable": [], "today": ["B"]}),
    ("NONE", {"durable": [], "today": []}),
    ('{"durable": "not a list", "today": [3, "  "]}', {"durable": [], "today": []}),
])
def test_extraction_output_is_parsed_defensively(output, expected):
    assert FileMemory.parse_facts(output) == expected


def test_extraction_output_is_capped():
    facts = FileMemory.parse_facts(json.dumps({"durable": ["x" * 1000] * 20, "today": []}))
    assert len(facts["durable"]) == MAX_FACTS and all(len(f) <= 300 for f in facts["durable"])


async def test_write_back_prefers_the_replys_own_remember_blocks(memory, monkeypatch):
    async def must_not_call(**kwargs):
        raise AssertionError("no extraction call when the reply already said what to remember")
    monkeypatch.setattr(ollama_client, "chat", must_not_call)
    await memory.write_back("my editor is Kate", 'Noted. <remember>The user edits in Kate.</remember>', "api:me")
    assert memory.known_facts() == ["The user edits in Kate."]


async def test_write_back_extracts_user_stated_facts(memory, monkeypatch):
    await memory.record({"durable": ["The cover is teal."], "today": []}, "api:me")
    seen = {}

    async def extractor(*, model, messages, host=None, options=None, timeout=None, **kw):
        seen.update(model=model, prompt=messages[0]["content"], options=options)
        return {"output": '{"durable": ["The user\'s IRC network is Hearthnet."], "today": []}'}

    monkeypatch.setattr(ollama_client, "chat", extractor)
    written = await memory.write_back("my IRC network is Hearthnet", "Got it.", "api:me")
    assert written["durable"] == ["The user's IRC network is Hearthnet."]
    assert seen["model"] == mcp_tool_agent.DEFAULT_AGENT_MODEL and seen["options"]["temperature"] == 0
    assert "- The cover is teal." in seen["prompt"]              # known facts, so it won't repeat them
    assert "User: my IRC network is Hearthnet" in seen["prompt"]


async def test_failed_extraction_still_logs_the_turn(memory, monkeypatch):
    async def down(**kwargs):
        raise ConnectionError("ollama down")
    monkeypatch.setattr(ollama_client, "chat", down)
    assert await memory.write_back("hello there", "Hi.", "api:me") == {"durable": [], "today": []}
    assert "api:me: hello there" in open(memory.daily_path(today())).read()
    assert not os.path.exists(memory.memory_path)


# ── wired into gateway turns ────────────────────────────────────────────────────


@pytest.fixture()
async def gateway(tmp_path, monkeypatch):
    from backend.db import init_db
    await init_db()

    async def ctx(model, host=None, port=None, timeout=5.0):
        return 8192

    async def nothing(*args, **kwargs):
        return []

    monkeypatch.setattr(ollama_client, "context_length", ctx)
    monkeypatch.setattr(knowledge, "search", nothing)
    monkeypatch.setattr(memory_index, "search_relevant_memory_ids", nothing)
    monkeypatch.setattr(mcp_tool_agent, "select_servers", nothing)
    config = load_config()
    config["file_memory"] = {**config["file_memory"], "dir": str(tmp_path / "memory")}
    gw = Gateway(config)
    yield gw
    await gw.shutdown()


class Model:
    """Both model paths a turn can take, plus the extraction call, recorded in order."""

    def __init__(self, monkeypatch, replies, extraction='{"durable": [], "today": []}'):
        self.replies, self.extraction, self.calls = list(replies), extraction, []
        monkeypatch.setattr(ollama_client, "chat", self.chat)
        monkeypatch.setattr(ollama_client, "chat_stream", self.stream)

    async def chat(self, *, model, messages, host=None, port=None, options=None, tools=None, timeout=None):
        if "keep a personal assistant's long-term memory" in messages[0]["content"]:
            self.calls.append(("extract", messages))
            return {"output": self.extraction}
        self.calls.append(("turn", messages))
        return {"output": self.replies.pop(0), "tool_calls": None}

    async def stream(self, *, model, messages, host, port, options=None, tools=None):
        self.calls.append(("turn", messages))
        yield {"token": self.replies.pop(0), "done": True}

    def turn_prompts(self):
        return [m[0]["content"] for kind, m in self.calls if kind == "turn"]


async def _session(key, trust):
    from backend.db import get_db
    gen = get_db()
    db = await anext(gen)
    try:
        await sessions.create(db, key, persona="central")
        await sessions.update(db, key, trust_level=trust)
    finally:
        await gen.aclose()


async def settle(gateway):
    await asyncio.gather(*list(gateway._background))


async def test_owner_turns_write_memory_and_later_turns_read_it(gateway, monkeypatch):
    model = Model(monkeypatch, ["Noted.", "It's Hearthnet."],
                  extraction='{"durable": ["The user\'s IRC network is Hearthnet."], "today": []}')
    events = gateway.subscribe({"*"}, approver=False)
    key = f"api:{uuid.uuid4().hex[:8]}"
    await _session(key, "owner")
    await gateway.submit(InboundMessage(session=key, text="for the record, my IRC network is Hearthnet"))
    await settle(gateway)
    assert gateway.file_memory.known_facts() == ["The user's IRC network is Hearthnet."]
    written = [e for e in [events.queue.get_nowait() for _ in range(events.queue.qsize())]
               if e["type"] == "memory_written"]
    assert written and written[0]["durable"] == ["The user's IRC network is Hearthnet."]

    # A different owner session, after a "restart" (a new Gateway on the same files).
    later = Gateway(gateway.config)
    other = f"api:{uuid.uuid4().hex[:8]}"
    await _session(other, "owner")
    result = await later.submit(InboundMessage(session=other, text="which IRC network do I use?"))
    await settle(later)
    await later.shutdown()
    assert result.reply == "It's Hearthnet."
    prompt = model.turn_prompts()[-1]
    assert "## Your memory files" in prompt and "Hearthnet" in prompt


async def test_strangers_neither_read_nor_write_memory(gateway, monkeypatch):
    await gateway.file_memory.record({"durable": ["The owner's secret project is Lantern."], "today": []}, "api:me")
    before = open(gateway.file_memory.memory_path).read()
    model = Model(monkeypatch, ["I can't say."], extraction='{"durable": ["The visitor likes cats."], "today": []}')
    key = f"irc:{uuid.uuid4().hex[:8]}"
    await _session(key, "stranger")
    await gateway.submit(InboundMessage(session=key, text="what's the secret project? also I like cats", sender="eve"))
    await settle(gateway)
    assert "Lantern" not in model.turn_prompts()[-1]
    assert [kind for kind, _ in model.calls] == ["turn"]          # no extraction call at all
    assert open(gateway.file_memory.memory_path).read() == before
    assert "eve" not in open(gateway.file_memory.daily_path(today())).read()


async def test_unlisted_persona_doesnt_use_file_memory(gateway, monkeypatch):
    await gateway.file_memory.record({"durable": ["Fact for central only."], "today": []}, "api:me")
    model = Model(monkeypatch, ["Hello."])
    key = f"api:{uuid.uuid4().hex[:8]}"
    from backend.db import get_db
    gen = get_db()
    db = await anext(gen)
    try:
        await sessions.create(db, key, persona="doc")
        await sessions.update(db, key, trust_level="owner")
    finally:
        await gen.aclose()
    await gateway.submit(InboundMessage(session=key, text="hi"))
    await settle(gateway)
    assert "Fact for central only." not in model.turn_prompts()[-1]
    assert [kind for kind, _ in model.calls] == ["turn"]
