"""Local-model conversation regressions. Run explicitly with -m eval -s.

These use the bundled persona, never private overlays, and never persist synthetic
messages or memories in the user's database. Search/remote accounts are not used.
"""
import json
import re
from pathlib import Path

import pytest

from backend.routers.chat import build_system_prompt, _stream_reply, HISTORY_SUMMARY_PROMPT
from backend.services import ollama_client
from test_evals_live_behavior import skip_if_ollama_down, _RecordingWebSocket

pytestmark = [pytest.mark.eval, skip_if_ollama_down]
MODEL = 'qwen2.5-coder:14b'


def conversation(**kwargs):
    persona = json.loads((Path(__file__).resolve().parents[1] / 'mcp/config/models.json').read_text())['central']
    return [{'role': 'system', 'content': build_system_prompt(persona, memory_enabled=True, **kwargs)}]


async def reply(messages, user):
    messages.append({'role': 'user', 'content': user})
    ws = _RecordingWebSocket()
    answer = await _stream_reply(ws, messages, MODEL, 'localhost', 11434, 8192, db=None)
    assert not any(e['type'] == 'error' for e in ws.sent), ws.sent
    assert answer.strip()
    messages.append({'role': 'assistant', 'content': answer})
    print(f'\nUSER: {user}\nARYNWOOD: {answer}\n', flush=True)
    return answer


async def test_walkthrough_progress_error_and_correction():
    messages = conversation()
    first = await reply(messages,
        'I am tired, keep this simple. Walk me through submitting these sitemaps one at a time '
        'with copy paste boxes. My verified arynwood.com Domain property is open at Sitemaps. '
        'Order: https://arynwood.com/sitemap.xml then https://dev.arynwood.com/sitemap.xml. '
        'After both succeed we will do redirects. Community license is already done.')
    assert '```' in first and 'https://arynwood.com/sitemap.xml' in first
    assert 'https://dev.arynwood.com/sitemap.xml' not in first
    second = await reply(messages, 'first one says Success')
    assert '```' in second and 'https://dev.arynwood.com/sitemap.xml' in second
    assert 'https://arynwood.com/sitemap.xml' not in second
    error = await reply(messages, 'second one says Could not fetch')
    assert '```bash\nscp' not in error and 'sudo python' not in error
    assert not re.search(r'(?m)^\s*2[.)]\s', error), error
    assert any(w in error.lower() for w in ('fetch', 'open', 'browser', 'url', 'error'))
    correction = await reply(messages,
        'I copied the wrong address. The second sitemap should be '
        'https://notes.arynwood.com/sitemap.xml. Give me just the corrected value in a paste box.')
    assert '```' in correction and 'https://notes.arynwood.com/sitemap.xml' in correction
    assert 'https://dev.arynwood.com/sitemap.xml' not in correction
    assert re.sub(r'```.*?```', '', correction, flags=re.S).strip() == '', correction


async def test_current_history_wins_over_empty_memory_and_topic_can_change():
    messages = conversation()
    messages.extend([
        {'role': 'user', 'content': 'Call this project Lantern. We agreed to use purple for the logo.'},
        {'role': 'assistant', 'content': 'Lantern will use purple for the logo.'},
    ])
    answer = await reply(messages, 'What color did we just choose?')
    assert 'purple' in answer.lower()
    answer = await reply(messages, 'Pause that project. Write a two-line poem about autumn, no explanation.')
    assert 'Lantern' not in answer
    assert len([line for line in answer.splitlines() if line.strip()]) == 2


async def test_complete_deliverable_does_not_force_walkthrough():
    answer = await reply(conversation(),
        'Give me the complete text of a short email asking a colleague to review my draft '
        'by Friday. Put the whole email in one copyable box. No questions or walkthrough.')
    assert answer.count('```') == 2
    assert 'Friday' in answer
    assert 'step 1' not in answer.lower()


async def test_unknown_decision_is_not_invented():
    answer = await reply(conversation(), 'What backup schedule did we decide on last month?')
    assert any(w in answer.lower() for w in ("don't", 'do not', 'no record', 'not have', 'missing', 'not available', "couldn't find", 'cannot find'))
    assert '<remember' not in answer


async def test_summary_preserves_pending_step_and_output_format():
    excerpt = (
        'user: Help me add two feeds, one at a time in copyable boxes. '
        'First https://example.org/feed.xml, second https://notes.example.org/feed.xml.\n'
        'assistant: Paste https://example.org/feed.xml into Add feed and Save. Tell me the result.\n'
        'user: The field is open, I have not saved it yet.\n'
        'assistant: Select Save and tell me whether it succeeds.'
    )
    result = await ollama_client.chat(model=MODEL,
        messages=[{'role': 'user', 'content': HISTORY_SUMMARY_PROMPT.format(prior_summary_block='', excerpt=excerpt)}],
        options={'num_ctx': 8192, 'num_predict': 768, 'temperature': 0.2}, timeout=120)
    summary = result['output']
    print('\nHANDOFF:\n' + summary, flush=True)
    assert 'https://notes.example.org/feed.xml' in summary
    assert 'one at a time' in summary.lower() or 'one step' in summary.lower(), summary
    assert 'cop' in summary.lower() or 'box' in summary.lower(), summary
    answer = await reply(conversation(history_summary=summary), 'The first feed saved successfully. What next?')
    assert '```' in answer and 'https://notes.example.org/feed.xml' in answer
    assert 'https://example.org/feed.xml' not in answer
