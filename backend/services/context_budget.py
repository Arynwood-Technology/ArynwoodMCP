"""Bound complete provider requests, preserving tool-call/result groups.

The estimator is conservative for ordinary text; providers with tokenizers can
supply a more precise count later. Oversized instructions/current requests fail
explicitly rather than silently changing the user's objective.
"""
from copy import deepcopy
import json


class ContextBudgetError(ValueError):
    pass


def estimate(text: str) -> int:
    # Unicode/code can use substantially more tokens than English prose.
    return max(1, (len(text.encode('utf-8')) + 2) // 3)


def _raw_request_tokens(messages: list[dict], tools=None) -> int:
    return 32 + sum(estimate(json.dumps(m, ensure_ascii=False)) + 8 for m in messages) + (
        estimate(json.dumps(tools, ensure_ascii=False)) + 16 if tools else 0
    )


# The bytes/3 estimate is deliberately conservative, but for ordinary English prompts it
# overcounts by ~50% (measured: central's full prompt estimated 6881, Ollama counted
# 4636). At an 8192 context that overcount alone was enough to push relevant memories
# out of the system prompt. Once a provider reports a real prompt token count for a
# model, scale later estimates for that model by the observed ratio (plus a 10% safety
# margin, never below 0.55 and never above 1.0 — calibration can only relax the
# conservative default, not make it riskier than a measured request).
_SAFETY = 1.10
_calibration: dict[str, float] = {}


def observe(model: str | None, messages: list[dict], tools, actual_tokens: int | None) -> None:
    if not model or not actual_tokens or actual_tokens <= 0:
        return
    raw = _raw_request_tokens(messages, tools)
    if raw < 256:
        return  # tiny requests are dominated by fixed framing overhead
    ratio = actual_tokens / raw
    prev = _calibration.get(model)
    blended = ratio if prev is None else 0.7 * (prev / _SAFETY) + 0.3 * ratio
    _calibration[model] = min(1.0, max(0.55, blended * _SAFETY))


def snapshot() -> dict[str, float]:
    return {k: round(v, 4) for k, v in _calibration.items()}


def load(saved: dict) -> None:
    """Seed from persisted ratios (only for models not yet observed this process)."""
    for model, value in (saved or {}).items():
        if isinstance(value, (int, float)) and model not in _calibration:
            _calibration[model] = min(1.0, max(0.55, float(value)))


def scale(model: str | None) -> float:
    return _calibration.get(model, 1.0) if model else 1.0


def request_tokens(messages: list[dict], tools=None, model: str | None = None) -> int:
    return int(_raw_request_tokens(messages, tools) * scale(model))


def fit_request(messages: list[dict], tools, num_ctx: int, reserve: int = 1024,
                model: str | None = None) -> tuple[list[dict], dict]:
    """Drop oldest whole turns, then shorten tool/evidence text; never split calls.

    User uploads remain in the persisted source transcript. Automatic evidence is
    separated using the runtime's untrusted-data delimiter, so it may be reduced
    without clipping the user's actual request. Required content must fit or the
    caller gets an actionable error instead of a silently truncated instruction.
    """
    limit = num_ctx - min(reserve, max(128, num_ctx // 4))
    out = deepcopy(messages)
    removed = 0
    shortened = 0
    while request_tokens(out, tools, model) > limit:
        starts = [i for i, m in enumerate(out) if m.get('role') == 'user']
        # Keep the current user turn and any subsequent tool exchanges together.
        if len(starts) > 1:
            del out[starts[0]:starts[1]]
            removed += 1
            continue
        candidates = []
        for i, m in enumerate(out):
            content = m.get('content', '')
            if not isinstance(content, str):
                continue
            if m.get('role') == 'tool' and len(content) > 256:
                candidates.append((len(content), i, 0))
            elif m.get('role') == 'user' and '\n\n<untrusted-data' in content:
                boundary = content.index('\n\n<untrusted-data')
                if len(content) - boundary > 256:
                    candidates.append((len(content) - boundary, i, boundary))
        if not candidates:
            raise ContextBudgetError(
                'The required instructions, current message, and tool definitions exceed this model’s '
                'context budget. Shorten the attachment/Agent Config or choose a larger context profile.'
            )
        _, index, boundary = max(candidates)
        content = out[index]['content']
        keep = max(128, (len(content) - boundary) // 2)
        out[index]['content'] = content[:boundary + keep] + '\n[Evidence shortened to fit context; retrieve a narrower excerpt.]'
        shortened += 1
    return out, {'estimated_tokens': request_tokens(out, tools, model), 'budget_tokens': limit,
                 'dropped_turns': removed, 'shortened_blocks': shortened}
