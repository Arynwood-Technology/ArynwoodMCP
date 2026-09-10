from backend.services.mcp_tool_agent import _filter_relevant_tools, MAX_TOOLS_PER_CALL

# A representative slice of Kdenlive's real tool names/descriptions (it exposes ~180
# total) — enough to exercise filtering on realistic naming, without depending on a
# live MCP server being registered.
_KDENLIVE_TOOLS = [
    ("get_timeline_summary", "Text table of all clips on the timeline"),
    ("add_marker", "Add a marker at a position on the timeline"),
    ("delete_marker", "Delete a marker from the timeline"),
    ("get_markers", "List all markers on the timeline"),
    ("add_clip_marker", "Add a marker to a bin clip"),
    ("delete_clip_marker", "Delete a marker from a bin clip"),
    ("get_clip_markers", "List markers on a bin clip"),
    ("set_clip_volume", "Set the audio volume of a clip"),
    ("get_clip_volume", "Get the audio volume of a clip"),
    ("set_clip_pan", "Set the audio pan of a clip"),
    ("render_video", "Export the timeline to a video file"),
    ("add_transition", "Add a transition between two clips"),
    ("remove_transition", "Remove a transition"),
    ("split_clip", "Split a clip at a position"),
    ("delete_clip", "Delete a clip from the timeline"),
    ("import_media", "Import a media file into the project bin"),
]
# Pad out to a realistic catalog size (Kdenlive exposes ~180 tools total) with
# generic filler so the "small catalog, skip filtering" short-circuit doesn't apply.
_FILLER_TOOLS = [(f"filler_tool_{i}", "An unrelated project-management tool") for i in range(200)]


def _as_schema(name: str, desc: str) -> dict:
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {}}}


def test_small_catalog_is_not_filtered():
    tools = [_as_schema(n, d) for n, d in _KDENLIVE_TOOLS[:10]]
    assert _filter_relevant_tools(tools, "delete this marker") == tools


def test_large_catalog_is_capped():
    tools = [_as_schema(n, d) for n, d in _KDENLIVE_TOOLS + _FILLER_TOOLS]
    result = _filter_relevant_tools(tools, "delete a marker on my clip")
    assert len(result) == MAX_TOOLS_PER_CALL


def test_relevant_tools_rank_above_unrelated_filler():
    tools = [_as_schema(n, d) for n, d in _KDENLIVE_TOOLS + _FILLER_TOOLS]
    result = _filter_relevant_tools(tools, "delete a marker on my clip")
    result_names = [t["function"]["name"] for t in result]
    assert "delete_marker" in result_names
    assert "delete_clip_marker" in result_names
    assert "get_clip_markers" in result_names
    # Filler tools score 0 (no keyword overlap) and may still fill leftover slots up
    # to the cap, but they must never outrank an actually-relevant tool.
    first_filler_rank = next((i for i, n in enumerate(result_names) if n.startswith("filler_tool_")), len(result_names))
    assert result_names.index("delete_marker") < first_filler_rank
    assert result_names.index("delete_clip_marker") < first_filler_rank


def test_render_query_surfaces_render_tool():
    tools = [_as_schema(n, d) for n, d in _KDENLIVE_TOOLS + _FILLER_TOOLS]
    result_names = {t["function"]["name"] for t in _filter_relevant_tools(tools, "render the video to a file")}
    assert "render_video" in result_names
