"""_extract_tool_calls (roadmap 2.1/3.3 fix) — found live, not by inspection: with
central's real (long, conversational) system prompt, qwen2.5-coder:14b sometimes
prefaces a tool call with a full lead-in sentence before the JSON, e.g.
'To find out who won the most recent Super Bowl, I'll need to search for the '
'latest information.\\n\\n```json\\n{"name": "web_search", ...}\\n```'
— which the original "content must start with {" check missed entirely, silently
treating the whole thing as a plain-text answer instead of a tool call."""

from backend.services.mcp_tool_agent import _extract_tool_calls


def test_native_tool_calls_field_takes_priority():
    msg = {"tool_calls": [{"function": {"name": "get_track_list", "arguments": {}}}], "content": "ignored"}
    assert _extract_tool_calls(msg) == [("get_track_list", {})]


def test_plain_json_from_the_first_character():
    msg = {"content": '{"name": "web_search", "arguments": {"query": "x"}}'}
    assert _extract_tool_calls(msg) == [("web_search", {"query": "x"})]


def test_json_wrapped_in_a_code_fence():
    msg = {"content": '```json\n{"name": "web_search", "arguments": {"query": "x"}}\n```'}
    assert _extract_tool_calls(msg) == [("web_search", {"query": "x"})]


def test_json_prefaced_by_a_prose_lead_in_sentence():
    """The actual bug found live against the real system prompt."""
    msg = {"content": (
        "To find out who won the most recent Super Bowl, I'll need to search "
        'for the latest information.\n\n```json\n{"name": "web_search", '
        '"arguments": {"query": "most recent Super Bowl winner"}}\n```'
    )}
    assert _extract_tool_calls(msg) == [("web_search", {"query": "most recent Super Bowl winner"})]


def test_json_prefaced_by_prose_without_a_code_fence():
    msg = {"content": 'Let me check that.\n{"name": "web_search", "arguments": {"query": "x"}}'}
    assert _extract_tool_calls(msg) == [("web_search", {"query": "x"})]


def test_plain_prose_answer_with_no_json_returns_empty():
    msg = {"content": "The answer is 42."}
    assert _extract_tool_calls(msg) == []


def test_prose_containing_an_unrelated_json_object_is_not_mistaken_for_a_tool_call():
    """A stray '{' that isn't shaped like {"name": ..., "arguments": ...} must not
    be misread as a tool call attempt."""
    msg = {"content": 'Here is an example config: {"key": "value"}'}
    assert _extract_tool_calls(msg) == []


def test_multiple_back_to_back_tool_calls():
    msg = {"content": (
        '{"name": "search_memory", "arguments": {"query": "a"}}'
        '{"name": "web_search", "arguments": {"query": "b"}}'
    )}
    assert _extract_tool_calls(msg) == [("search_memory", {"query": "a"}), ("web_search", {"query": "b"})]


def test_empty_content_returns_empty():
    assert _extract_tool_calls({"content": ""}) == []
    assert _extract_tool_calls({}) == []
