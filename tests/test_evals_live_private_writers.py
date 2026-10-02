"""Opt-in behavior checks for user-owned writer personas, never their private text.

ARYNWOOD_WRITER_PERSONAS=writer_a,writer_b python -m pytest \
    tests/test_evals_live_private_writers.py -m eval -v -s

Uses synthetic, non-graphic fiction and does not persist test conversations.
"""
import os
import re

import pytest

from backend.routers.chat import build_system_prompt, get_personas, _persona_reply_tokens, _stream_reply
from backend.services import ollama_client

pytestmark = pytest.mark.eval
PERSONAS = [key.strip() for key in os.getenv('ARYNWOOD_WRITER_PERSONAS', '').split(',') if key.strip()]


@pytest.fixture(params=PERSONAS)
def writer(request):
    persona = get_personas().get(request.param)
    if not persona:
        pytest.skip('Requested private persona is not configured')
    return request.param, persona


async def answer(writer, messages, user, monkeypatch):
    name, persona = writer
    messages.append({'role': 'user', 'content': user})
    original = ollama_client.chat_stream
    finishes = []

    async def capture(**kwargs):
        async for chunk in original(**kwargs):
            if chunk.get('done'):
                finishes.append(chunk.get('finish_reason'))
            yield chunk

    class Sink:
        async def send_json(self, event):
            assert event['type'] != 'error', event

    ctx = min(await ollama_client.context_length(persona['llm']['model']), persona['llm'].get('num_ctx', 8192))
    with monkeypatch.context() as patch:
        patch.setattr(ollama_client, 'chat_stream', capture)
        text = await _stream_reply(Sink(), messages, persona['llm']['model'], 'localhost', 11434,
                                   ctx, db=None, reply_tokens=_persona_reply_tokens(persona, ctx))
    messages.append({'role': 'assistant', 'content': text})
    print(f'\n{name} / USER: {user}\nREPLY:\n{text}\nFINISH: {finishes}', flush=True)
    assert '<untrusted-data' not in text and '</untrusted-data>' not in text
    return text, finishes


def start(writer):
    return [{'role': 'system', 'content': build_system_prompt(writer[1])}]


async def test_complete_scene_then_targeted_revision(writer, monkeypatch):
    messages = start(writer)
    scene, finish = await answer(writer, messages,
        'A separate new story, unrelated to my other books. Mara is an expert clock repairer; '
        'her brother Ivo has just left their shop for the last time. Write a complete 450–550 word '
        'scene in close third person, past tense. She finds the watch he secretly repaired for her. '
        'Keep her competent; do not explicitly explain her feelings. Quiet tension, a concrete ending. '
        'Invent any missing details. Just the scene.', monkeypatch)
    assert finish == ['stop'], finish
    assert len(scene.split()) >= 350, 'Long scene was cut short or substantially undershot the brief'
    assert scene.rstrip()[-1] in '.!?\"”’', scene[-100:]
    revision, finish = await answer(writer, messages,
        'Correction: Ivo is her cousin, not her brother. Revise ONLY the final paragraph into '
        'three complete sentences. Have Mara put on the watch rather than leave it behind. '
        'Do not repeat any earlier paragraphs. No explanation.', monkeypatch)
    assert finish == ['stop'], finish
    assert scene[:100] not in revision
    assert len(revision.split()) < 150, revision
    assert 'brother' not in revision.lower(), revision
    sentences = re.split(r'(?<=[.!?])\s+', revision.strip())
    assert len(sentences) == 3, revision


async def test_requested_list_overrides_default_prose(writer, monkeypatch):
    text, _ = await answer(writer, start(writer),
        'Give me exactly three short title ideas for an unrelated story about a haunted laundromat. '
        'Use three bullet points. No introduction or commentary.', monkeypatch)
    assert len(re.findall(r'(?m)^\s*[-*•]\s+', text)) == 3, text
    assert len([line for line in text.splitlines() if line.strip()]) == 3, text


async def test_missing_manuscript_is_not_fabricated(writer, monkeypatch):
    text, _ = await answer(writer, start(writer),
        'I have not pasted or uploaded Chapter 9 of my new lighthouse novel here. '
        'Can you quote its final sentence and tell me whether it works?', monkeypatch)
    assert any(term in text.lower() for term in ('paste', 'send', 'share', 'provide', 'upload', "haven't", "don't", 'cannot', "can't")), text
    assert not re.search(r'[“\"][^“\"\n]{30,}[”\"]', text), text
