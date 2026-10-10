"""Hermetic prompt-budget regressions; also runnable with stdlib unittest."""
import json
from pathlib import Path
import unittest

from backend.services import context_budget, cpu_chat

ROOT = Path(__file__).resolve().parents[1]


class CompactCPUChatTests(unittest.TestCase):
    def setUp(self):
        self.personas = json.loads((ROOT / "mcp/config/models.json").read_text())
        self.calibration = context_budget._calibration
        context_budget._calibration = {}

    def tearDown(self):
        context_budget._calibration = self.calibration

    def test_bundled_personas_fit_2048_without_calibration(self):
        for key in ("central", "doc", "kona", "glyph", "estra"):
            with self.subTest(persona=key):
                persona, compact = cpu_chat.select_persona(self.personas[key], 2048, True)
                self.assertTrue(compact)
                prompt = cpu_chat.build_prompt(persona, "Reply in plain English.",
                                               memory_enabled=key == "central",
                                               memory_save_rule="Only save what the user told you; never guesses.")
                messages = [{"role": "system", "content": prompt}, {"role": "user", "content": "x" * 400}]
                fitted, report = context_budget.fit_request(messages, None, 2048, reserve=512)
                self.assertEqual(fitted[-1], messages[-1])
                self.assertLess(report["estimated_tokens"], report["budget_tokens"])
                self.assertIn("Tools, web browsing and external actions are off", prompt)
                self.assertIn("<untrusted-data>", prompt)

    def test_full_profile_and_original_config_are_preserved(self):
        original = self.personas["central"]
        before = json.dumps(original, sort_keys=True)
        for context, cpu in ((6144, True), (8192, True), (2048, False)):
            selected, compact = cpu_chat.select_persona(original, context, cpu)
            self.assertFalse(compact)
            self.assertIs(selected, original)
        selected, compact = cpu_chat.select_persona(original, 4096, True)
        self.assertTrue(compact)
        self.assertFalse(selected["tools_enabled"])
        self.assertEqual(json.dumps(original, sort_keys=True), before)

    def test_full_central_instructions_reproduce_the_small_context_failure(self):
        messages = [{"role": "system", "content": self.personas["central"]["system"]},
                    {"role": "user", "content": "hello"}]
        with self.assertRaises(context_budget.ContextBudgetError):
            context_budget.fit_request(messages, None, 2048)

    def test_custom_persona_requires_an_explicit_alternative(self):
        for alternative in (None, "", "  ", 42):
            custom = {"system": "Preserve my full character instructions.", "cpu_system": alternative}
            selected, compact = cpu_chat.select_persona(custom, 2048, True)
            self.assertIs(selected, custom)
            self.assertFalse(compact)
        selected, compact = cpu_chat.select_persona({"system": "Full", "cpu_system": "My short instructions"}, 2048, True)
        self.assertTrue(compact)
        self.assertEqual(selected["system"], "My short instructions")

    def test_required_content_and_memory_trust_are_never_trimmed(self):
        persona, _ = cpu_chat.select_persona(self.personas["central"], 2048, True)
        memories = [
            {"title": "Keep this", "content": "PINNED " * 1000, "pinned": 1,
             "updated_at": "2026-01-01", "status": "provisional", "volatility": "transient"},
            {"title": "Optional", "content": "OPTIONAL", "pinned": 0, "updated_at": "2026-01-01"},
        ]
        before = json.dumps(memories)
        prompt = cpu_chat.build_prompt(persona, "OWNER NOTES " * 1000, memories,
                                       "OPTIONAL RECENT", budget_tokens=1, history_summary="KEEP SUMMARY")
        for text in ("PINNED " * 1000, "OWNER NOTES " * 1000, "KEEP SUMMARY", "provisional, transient, pinned"):
            self.assertIn(text, prompt)
        self.assertNotIn("OPTIONAL", prompt)
        self.assertEqual(json.dumps(memories), before)
        with self.assertRaises(context_budget.ContextBudgetError) as error:
            context_budget.fit_request([{"role": "system", "content": prompt},
                                        {"role": "user", "content": "hello"}], None, 2048, model="small-model")
        for text in ("small-model", "1,536", "2,048 context tokens", "512 reserved"):
            self.assertIn(text, str(error.exception))

    def test_history_eviction_preserves_the_current_request(self):
        persona, _ = cpu_chat.select_persona(self.personas["doc"], 2048, True)
        prompt = cpu_chat.build_prompt(persona, "Keep these notes.")
        messages = [{"role": "system", "content": prompt}, {"role": "user", "content": "old " * 3000},
                    {"role": "assistant", "content": "old answer"}, {"role": "user", "content": "current"}]
        fitted, report = context_budget.fit_request(messages, None, 2048)
        self.assertEqual(fitted, [messages[0], messages[-1]])
        self.assertEqual(report["dropped_turns"], 1)

    def test_error_counts_reply_reserve_and_tool_definitions(self):
        with self.assertRaises(context_budget.ContextBudgetError) as error:
            context_budget.fit_request([{"role": "user", "content": "hello"}],
                                       [{"description": "x" * 15000}], 4096, reserve=256)
        self.assertIn("3,840", str(error.exception))
        self.assertIn("256 reserved", str(error.exception))


if __name__ == "__main__":
    unittest.main()
