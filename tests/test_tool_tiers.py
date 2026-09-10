"""classify_tool_tier (roadmap 2.3) — spot-checked against the real ~180-tool
Kdenlive manifest during development (see the roadmap item and mcp_tool_agent.py's
own comments); this locks in the categories that matter most so a future prefix
change can't silently downgrade something destructive to auto-allowed."""

from backend.services.mcp_tool_agent import (
    classify_tool_tier, TIER_READ_ONLY, TIER_REVERSIBLE, TIER_DESTRUCTIVE,
)


def test_get_and_list_tools_are_read_only():
    for name in ["get_timeline_summary", "get_clip_info", "list_clips", "get_project_info"]:
        assert classify_tool_tier(name) == TIER_READ_ONLY, name


def test_preview_render_tools_are_read_only_not_destructive():
    # These write a JPEG to disk but never touch the project — distinct from
    # render_video, which is the real, expensive, overwrite-risking export.
    for name in ["render_frame", "render_bin_frame", "render_contact_sheet", "render_crop"]:
        assert classify_tool_tier(name) == TIER_READ_ONLY, name


def test_deletions_and_real_exports_are_destructive():
    for name in ["delete_clip", "delete_track", "remove_transition", "ripple_delete", "render_video", "new_project"]:
        assert classify_tool_tier(name) == TIER_DESTRUCTIVE, name


def test_ripple_trim_is_reversible_not_destructive():
    # Distinguish from ripple_delete — trimming (even ripple-aware) is a normal,
    # undo-able edit, not a deletion.
    assert classify_tool_tier("ripple_trim") == TIER_REVERSIBLE


def test_ordinary_edits_are_reversible():
    for name in ["add_marker", "set_clip_volume", "move_clip", "split_clip", "trim_clip", "undo", "redo"]:
        assert classify_tool_tier(name) == TIER_REVERSIBLE, name


def test_composite_and_maintenance_tools_are_reversible():
    assert classify_tool_tier("build_timeline") == TIER_REVERSIBLE
    assert classify_tool_tier("export_subtitles") == TIER_REVERSIBLE
    assert classify_tool_tier("rebuild_clip_proxy") == TIER_REVERSIBLE
    assert classify_tool_tier("relink_clip") == TIER_REVERSIBLE
    assert classify_tool_tier("extract_zone") == TIER_REVERSIBLE
    assert classify_tool_tier("speech_recognition") == TIER_REVERSIBLE


def test_scene_detection_is_read_only():
    assert classify_tool_tier("detect_scenes") == TIER_READ_ONLY


def test_unrecognized_tool_name_defaults_to_destructive():
    """Fail-safe: an unrecognized tool (a future server's tool this classifier has
    never seen) requires approval by default rather than being silently allowed."""
    assert classify_tool_tier("some_completely_new_tool_nobody_has_seen") == TIER_DESTRUCTIVE


def test_classification_is_case_insensitive():
    assert classify_tool_tier("DELETE_CLIP") == TIER_DESTRUCTIVE
    assert classify_tool_tier("Get_Timeline_Summary") == TIER_READ_ONLY
