"""telemetry.py (roadmap 2.5) — Prometheus's registry is process-wide and shared
across the whole test session, so each test uses its own unique model/tool label
value rather than asserting on shared counters (which other tests could also be
incrementing)."""

import uuid

from backend.services import telemetry


def _counter(metric, **labels):
    return metric.labels(**labels)._value.get()


def test_record_llm_call_success_increments_calls_tokens_and_latency():
    model = f"test-model-{uuid.uuid4()}"
    telemetry.record_llm_call(model, "success", latency=1.5, in_tokens=10, out_tokens=20)

    assert _counter(telemetry.llm_calls_total, model=model, outcome="success") == 1.0
    assert _counter(telemetry.llm_tokens_total, model=model, direction="in") == 10.0
    assert _counter(telemetry.llm_tokens_total, model=model, direction="out") == 20.0
    hist = telemetry.llm_call_duration_seconds.labels(model=model)
    assert hist._sum.get() == 1.5


def test_record_llm_call_error_increments_calls_but_not_tokens_or_latency():
    model = f"test-model-{uuid.uuid4()}"
    telemetry.record_llm_call(model, "error")

    assert _counter(telemetry.llm_calls_total, model=model, outcome="error") == 1.0
    assert _counter(telemetry.llm_tokens_total, model=model, direction="in") == 0.0
    hist = telemetry.llm_call_duration_seconds.labels(model=model)
    assert hist._sum.get() == 0.0


def test_record_tool_call_success_increments_calls_and_latency():
    tool = f"test-tool-{uuid.uuid4()}"
    telemetry.record_tool_call("kdenlive", tool, "success", latency=0.3)

    assert _counter(telemetry.tool_calls_total, server="kdenlive", tool=tool, outcome="success") == 1.0
    hist = telemetry.tool_call_duration_seconds.labels(server="kdenlive", tool=tool)
    assert hist._sum.get() == 0.3


def test_record_tool_call_denied_and_invalid_and_error_are_distinct_outcomes():
    tool = f"test-tool-{uuid.uuid4()}"
    telemetry.record_tool_call("kdenlive", tool, "denied")
    telemetry.record_tool_call("kdenlive", tool, "invalid")
    telemetry.record_tool_call("kdenlive", tool, "error")

    assert _counter(telemetry.tool_calls_total, server="kdenlive", tool=tool, outcome="denied") == 1.0
    assert _counter(telemetry.tool_calls_total, server="kdenlive", tool=tool, outcome="invalid") == 1.0
    assert _counter(telemetry.tool_calls_total, server="kdenlive", tool=tool, outcome="error") == 1.0
    assert _counter(telemetry.tool_calls_total, server="kdenlive", tool=tool, outcome="success") == 0.0


async def test_ollama_client_chat_records_success_metrics(monkeypatch):
    from backend.services import ollama_client

    model = f"test-model-{uuid.uuid4()}"

    class FakeResponse(dict):
        pass

    async def fake_chat(**kwargs):
        return FakeResponse({
            "message": {"content": "hi", "tool_calls": None},
            "prompt_eval_count": 7, "eval_count": 3,
        })

    class FakeClient:
        chat = staticmethod(fake_chat)

    monkeypatch.setattr(ollama_client, "get_async_client", lambda *a, **k: FakeClient())

    await ollama_client.chat(model=model, messages=[{"role": "user", "content": "hi"}])

    assert _counter(telemetry.llm_calls_total, model=model, outcome="success") == 1.0
    assert _counter(telemetry.llm_tokens_total, model=model, direction="in") == 7.0
    assert _counter(telemetry.llm_tokens_total, model=model, direction="out") == 3.0


async def test_ollama_client_chat_records_error_on_timeout(monkeypatch):
    import httpx
    from backend.services import ollama_client

    model = f"test-model-{uuid.uuid4()}"

    async def fake_chat(**kwargs):
        raise httpx.TimeoutException("timed out")

    class FakeClient:
        chat = staticmethod(fake_chat)

    monkeypatch.setattr(ollama_client, "get_async_client", lambda *a, **k: FakeClient())

    try:
        await ollama_client.chat(model=model, messages=[{"role": "user", "content": "hi"}])
        assert False, "expected TimeoutError"
    except TimeoutError:
        pass

    assert _counter(telemetry.llm_calls_total, model=model, outcome="error") == 1.0
