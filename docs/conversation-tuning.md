# Arynwood conversation tuning

September 27, 2026. Model: `qwen2.5-coder:14b`, 8192-token context.

The trigger was a concrete failure: a request to walk through a project checklist
in copyable boxes received a generic explanation of redirects instead.

## What the dialogue showed

A local four-turn interview used Arynwood's real system prompt and the local Qwen
model. It did not write the synthetic conversation into the user's chat history.
Her initial self-assessment largely repeated her instructions, so implementation
choices came from observed replies and source inspection, not her claims about
her own internals.

- Asked for one step at a time, she initially gave both sitemap submissions.
- After explicit feedback, she continued from the successful first submission.
- When a submission failed without details, she recognized that the exact error
  was missing, but suggested retrying before obtaining it.
- Subsequent conversation tests found that error handling could revert to a list
  of possible causes, and a history summary could lose pacing preferences.

## Changes

The central persona now emphasizes the user's requested action, output format,
priority, and current step. A short worked example demonstrates waiting between
steps. Troubleshooting follows that same pace. Explicit corrections replace old
values; requests for only a code block get only a code block. Full-deliverable
requests and topic changes are supported without forcing a walkthrough.

The persona remains warm and direct, but no longer claims automatic knowledge of
all project history or requires persona referrals before helping. Its instruction
text is 5,737 characters versus the former 11,148. The generic repository tree is
omitted for central; actual code tools still provide relevant source evidence.

The backend now:

- Preserves the real user request and format at the native tool round limit,
  and budgets the final request before sending it.
- Distinguishes an empty persistent-memory lookup from missing current history.
- Summarizes the goal, formatting/pacing preferences, confirmed progress, pending
  step, corrections, and unverified suggestions. A suggested action is not a
  completed action.

## Validation

- 344 backend tests and 110 frontend tests passed.
- 31 existing live tool-routing/search tests passed, including the checklist
  response after search results.
- Five new live conversation scenarios passed: sequential progress/error/correction,
  current-history recall and topic change, complete deliverable, unknown past
  decision, and continuation from a compressed history summary.
- A real three-turn packaged HTTP conversation preserved sequential progress,
  copyable output, and a corrected address using an isolated database.
- The packaged backend passed its isolated startup, persona loading, sidecar,
  data-directory, and shutdown checks.

The live conversation tests run with normal chat generation settings, rather than
substituting canned model responses. These are sampled behavioral checks, not a
guarantee that every future reply will comply. The model can still add unnecessary
introductory wording or repeat navigation already completed. Long input remains
bounded by the context profile; this change does not raise VRAM requirements or
change the model.

Run the conversation regressions with Ollama available:

```bash
venv/bin/python -m pytest tests/test_evals_live_conversation.py -m eval -v -s
```

Run routing and search decisions:

```bash
venv/bin/python -m pytest tests/test_evals_live_behavior.py -m eval -v
```

Normal backend checks:

```bash
venv/bin/python -m pytest tests/ -q
```

The installed personal `central` override is hot-loaded on the next request and
was backed up before editing. Other private personas were preserved. Backend
changes require the updated desktop app to be relaunched.

The rebuilt local AppImage was installed at
`~/Applications/arynwood-mcp.AppImage`. The previous executable is retained as
`~/Applications/arynwood-mcp.before-conversation-tuning-20260927.AppImage`.
A consistent SQLite snapshot was saved to
`~/.local/share/arynwood-mcp/arynwood.before-conversation-tuning-20260927.db`.
The running app was left open; quit and relaunch to load the updated backend.
