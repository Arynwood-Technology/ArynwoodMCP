from backend.routers.chat import build_system_prompt, _trim_history_to_tokens
from backend.services.ollama_client import estimate_tokens

PERSONA = {"name": "Arynwood", "role": "Coordinator", "personality": "direct", "system": "Persona instructions body."}


def test_build_system_prompt_unbounded_includes_everything():
    memories = [{"type": "fact", "title": "T1", "content": "C1", "pinned": 0, "updated_at": "2026-01-01"}]
    prompt = build_system_prompt(PERSONA, "user notes", memories, "recent convo tail")
    assert "## Project layout" in prompt
    assert "## Your persistent memory" in prompt
    assert "recent convo tail" in prompt
    assert "user notes" in prompt


def test_build_system_prompt_drops_tree_before_memories_under_budget():
    memories = [{"type": "fact", "title": "T1", "content": "C1", "pinned": 0, "updated_at": "2026-01-01"}]
    full = build_system_prompt(PERSONA, "", memories, "recent convo tail")
    full_tokens = estimate_tokens(full)

    # A budget just under the full size should drop the lowest-priority section
    # (project tree) first, but keep the memory section intact.
    tight = build_system_prompt(PERSONA, "", memories, "recent convo tail", budget_tokens=full_tokens - 5)
    assert "## Project layout" not in tight
    assert "## Your persistent memory" in tight


def test_build_system_prompt_never_drops_pinned_memory():
    memories = [{"type": "fact", "title": "Pinned", "content": "x" * 2000, "pinned": 1, "updated_at": "2026-01-01"}]
    prompt = build_system_prompt(PERSONA, "", memories, "", budget_tokens=1)
    assert "Pinned" in prompt


def test_build_system_prompt_never_drops_persona_instructions():
    prompt = build_system_prompt(PERSONA, "", [], "", budget_tokens=1)
    assert "Persona instructions body." in prompt


def test_trim_history_drops_oldest_first():
    history = [
        {"role": "user", "content": "a" * 400},
        {"role": "assistant", "content": "b" * 400},
        {"role": "user", "content": "c" * 40},
    ]
    trimmed = _trim_history_to_tokens(history, budget_tokens=20)
    assert trimmed == [history[-1]]


def test_trim_history_drops_oversized_message_for_summary():
    history = [{"role": "user", "content": "x" * 10_000}]
    trimmed = _trim_history_to_tokens(history, budget_tokens=1)
    assert trimmed == []


def test_trim_history_empty_input():
    assert _trim_history_to_tokens([], budget_tokens=1000) == []
