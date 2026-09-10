"""Hermetic unit tests for the pure retrieval-quality helpers (roadmap 1.6/1.7).
knowledge.search() itself talks to live Ollama/Qdrant and was verified by hand
against real data during development rather than mocked here, matching this
codebase's existing convention of not standing up network mocks for the knowledge
base (there was no pre-existing test_knowledge.py before this)."""

from backend.services.knowledge import _lexical_overlap
from backend.routers.chat import _retrieval_query


def test_lexical_overlap_full_match():
    words = {"nvidia", "smi", "vram"}
    assert _lexical_overlap(words, "Run nvidia-smi to check VRAM usage") == 1.0


def test_lexical_overlap_partial_match():
    words = {"nvidia", "smi", "vram", "unrelated"}
    score = _lexical_overlap(words, "Run nvidia-smi to check VRAM usage")
    assert 0 < score < 1.0


def test_lexical_overlap_no_match():
    words = {"completely", "different", "topic"}
    assert _lexical_overlap(words, "Run nvidia-smi to check VRAM usage") == 0.0


def test_lexical_overlap_empty_inputs():
    assert _lexical_overlap(set(), "some text") == 0.0
    assert _lexical_overlap({"word"}, "") == 0.0


def test_retrieval_query_folds_in_last_turn():
    history = [
        {"role": "user", "content": "tell me about the LoRA training pipeline"},
        {"role": "assistant", "content": "It uses kohya_ss for fine-tuning checkpoints."},
    ]
    q = _retrieval_query("how long does that take", history)
    assert "LoRA training pipeline" in q
    assert "how long does that take" in q


def test_retrieval_query_with_no_history_is_just_the_message():
    assert _retrieval_query("plain question", []) == "plain question"


def test_retrieval_query_only_folds_in_requested_number_of_turns():
    history = [
        {"role": "user", "content": "message-A"},
        {"role": "assistant", "content": "message-B"},
        {"role": "user", "content": "message-C"},
        {"role": "assistant", "content": "message-D"},
    ]
    q = _retrieval_query("current", history, turns=1)
    assert "message-C" in q and "message-D" in q
    assert "message-A" not in q and "message-B" not in q
