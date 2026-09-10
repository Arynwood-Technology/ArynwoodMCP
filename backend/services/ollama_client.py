"""
Shared Ollama client for the Arynwood backend.

Consolidates what used to be hand-rolled httpx/requests calls duplicated across
chat.py, knowledge.py, mcp_tool_agent.py, and persona_runner.py into one wrapper
around the official `ollama` package — mirrors the Client/AsyncClient split and
metadata capture used by Sycamore's sycamore/llms/ollama.py and
sycamore/transforms/embed.py OllamaEmbedder.
"""

import logging
import os
from datetime import datetime
from typing import Any, AsyncIterator, Optional, Sequence

import httpx
from ollama import AsyncClient, Client

from backend.services import telemetry

logger = logging.getLogger(__name__)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 11434
DEFAULT_OPTIONS = {"temperature": 0.7}

# Ollama defaults num_ctx to 2048 for any request that doesn't set it explicitly,
# regardless of what the model itself was trained/supports (qwen2.5-coder:14b supports
# 32768, hermes3:8b supports 131072) — every caller in this codebase used to hit that
# silent 2048 ceiling. context_length() below is how callers find out what a model can
# actually take so they can set num_ctx deliberately instead of leaving it at the default.
_context_length_cache: dict[str, int] = {}
FALLBACK_CONTEXT_LENGTH = 4096

# Note: the ollama package itself raises the builtin ConnectionError (not a
# custom type) when the server is unreachable — it translates httpx.ConnectError
# to that for both Client and AsyncClient. This module additionally translates
# httpx's timeout exceptions to the builtin TimeoutError, so callers never need
# to import httpx just to catch ollama_client's exceptions.


def resolve_host(host: Optional[str] = None, port: Optional[int] = None) -> str:
    """Build an Ollama base URL: explicit host/port, else OLLAMA_HOST, else the package default.

    `host` may also be a full base URL already (e.g. "http://localhost:11434"),
    in which case it's used as-is and `port` is ignored.
    """
    if host:
        return host if "://" in host else f"http://{host}:{port or DEFAULT_PORT}"
    env_host = os.environ.get("OLLAMA_HOST")
    if env_host:
        return env_host if "://" in env_host else f"http://{env_host}"
    return f"http://{DEFAULT_HOST}:{DEFAULT_PORT}"


def get_client(host: Optional[str] = None, port: Optional[int] = None, timeout: Optional[float] = None) -> Client:
    return Client(host=resolve_host(host, port), timeout=timeout)


def get_async_client(
    host: Optional[str] = None, port: Optional[int] = None, timeout: Optional[float] = None
) -> AsyncClient:
    return AsyncClient(host=resolve_host(host, port), timeout=timeout)


def _metadata_from_response(model: str, response: Any, starttime: datetime) -> dict:
    message = response.get("message") or {}
    return {
        "model": model,
        "output": message.get("content", ""),
        "tool_calls": message.get("tool_calls"),
        "wall_latency": (datetime.now() - starttime).total_seconds(),
        "in_tokens": response.get("prompt_eval_count") or 0,
        "out_tokens": response.get("eval_count") or 0,
    }


async def chat(
    *,
    model: str,
    messages: list[dict],
    host: Optional[str] = None,
    port: Optional[int] = None,
    options: Optional[dict] = None,
    tools: Optional[Sequence] = None,
    timeout: Optional[float] = None,
) -> dict:
    """Non-streaming chat completion.

    Returns a metadata dict: {model, output, wall_latency, in_tokens, out_tokens}.
    """
    client = get_async_client(host, port, timeout)
    start = datetime.now()
    try:
        response = await client.chat(
            model=model, messages=messages, tools=tools,
            options={**DEFAULT_OPTIONS, **(options or {})},
        )
    except httpx.TimeoutException as e:
        telemetry.record_llm_call(model, "error")
        raise TimeoutError(str(e)) from e
    except Exception:
        telemetry.record_llm_call(model, "error")
        raise
    ret = _metadata_from_response(model, response, start)
    telemetry.record_llm_call(model, "success", ret["wall_latency"], ret["in_tokens"], ret["out_tokens"])
    logger.debug("Generated response from Ollama model: %s", ret)
    return ret


async def chat_stream(
    *,
    model: str,
    messages: list[dict],
    host: Optional[str] = None,
    port: Optional[int] = None,
    options: Optional[dict] = None,
    timeout: Optional[float] = None,
    tools: Optional[Sequence] = None,
) -> AsyncIterator[dict]:
    """Streaming chat completion. Yields {"token": str, "done": bool} chunks.

    tools streams exactly like a normal call — verified empirically against this
    model/Ollama version: qwen2.5-coder:14b never populates the native tool_calls
    field whether streaming or not, it emits a tool call as a bare {...} JSON text
    blob in content either way (same shape mcp_tool_agent._extract_tool_calls
    already parses on the non-streaming path). Callers that pass tools are
    responsible for peeking at the assembled content to tell a tool call apart from
    a real answer before forwarding tokens to a user — see chat.py's _stream_reply.
    """
    client = get_async_client(host, port, timeout)
    start = datetime.now()
    try:
        stream = await client.chat(
            model=model, messages=messages, stream=True, tools=tools,
            options={**DEFAULT_OPTIONS, **(options or {})},
        )
        async for chunk in stream:
            message = chunk.get("message") or {}
            done = bool(chunk.get("done"))
            if done:
                # Ollama's final streamed chunk carries the same eval-count metadata
                # as the non-streaming response — verified empirically (see roadmap
                # 2.5) — so streaming calls get real token counts too, not just latency.
                telemetry.record_llm_call(
                    model, "success",
                    (datetime.now() - start).total_seconds(),
                    chunk.get("prompt_eval_count") or 0,
                    chunk.get("eval_count") or 0,
                )
            yield {"token": message.get("content", ""), "done": done}
    except httpx.TimeoutException as e:
        telemetry.record_llm_call(model, "error")
        raise TimeoutError(str(e)) from e
    except Exception:
        telemetry.record_llm_call(model, "error")
        raise


def embed_texts(
    texts: list[str],
    *,
    model: str,
    host: Optional[str] = None,
    port: Optional[int] = None,
    timeout: Optional[float] = None,
) -> list[list[float]]:
    """Batched embeddings in a single request via Ollama's /api/embed."""
    client = get_client(host, port, timeout)
    try:
        response = client.embed(model=model, input=texts)
    except httpx.TimeoutException as e:
        raise TimeoutError(str(e)) from e
    return [list(e) for e in response.embeddings]


async def aembed_texts(
    texts: list[str],
    *,
    model: str,
    host: Optional[str] = None,
    port: Optional[int] = None,
    timeout: Optional[float] = None,
) -> list[list[float]]:
    """Async batched embeddings in a single request via Ollama's /api/embed."""
    client = get_async_client(host, port, timeout)
    try:
        response = await client.embed(model=model, input=texts)
    except httpx.TimeoutException as e:
        raise TimeoutError(str(e)) from e
    return [list(e) for e in response.embeddings]


async def list_models(
    host: Optional[str] = None, port: Optional[int] = None, timeout: Optional[float] = None
) -> list[str]:
    client = get_async_client(host, port, timeout)
    response = await client.list()
    return [m.model for m in response.models if m.model]


async def is_reachable(host: Optional[str] = None, port: Optional[int] = None, timeout: float = 3.0) -> bool:
    try:
        await list_models(host, port, timeout)
        return True
    except Exception:
        return False


def estimate_tokens(text: str) -> int:
    """Rough token estimate (~4 chars/token for English) for prompt budgeting.

    Real tokenizers vary per model family and aren't worth the dependency weight
    here — this only needs to be close enough to keep requests under a model's
    context window, not exact enough to bill by.
    """
    return max(1, len(text) // 4)


async def context_length(
    model: str, host: Optional[str] = None, port: Optional[int] = None, timeout: float = 5.0
) -> int:
    """Return a model's native context length via /api/show, cached per (host, model).

    Falls back to FALLBACK_CONTEXT_LENGTH if the model/field isn't found or Ollama
    isn't reachable — callers should treat that as "unknown, be conservative," not
    as a real measurement.
    """
    base = resolve_host(host, port)
    cache_key = f"{base}::{model}"
    if cache_key in _context_length_cache:
        return _context_length_cache[cache_key]
    try:
        client = get_async_client(host, port, timeout)
        info = await client.show(model)
        model_info = info.modelinfo or {}
        length = next(
            (v for k, v in model_info.items() if k.endswith(".context_length") and isinstance(v, int)),
            None,
        )
        if length is None:
            return FALLBACK_CONTEXT_LENGTH
        _context_length_cache[cache_key] = length
        return length
    except Exception:
        return FALLBACK_CONTEXT_LENGTH
