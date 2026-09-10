"""
Prometheus metrics for the parts of this system most likely to degrade quietly
(roadmap 2.5). The app already ships prometheus-fastapi-instrumentator for
HTTP-level metrics (exposed at /metrics), but nothing tracked which model/persona
is slow or erroring, or which MCP tools fail, time out, or get denied. Both
ollama_client (every LLM call in the app funnels through it) and mcp_tool_agent
(every MCP tool execution) report through the functions here.
"""

from prometheus_client import Counter, Histogram

llm_calls_total = Counter(
    "arynwood_llm_calls_total", "LLM calls made via ollama_client", ["model", "outcome"]
)
llm_call_duration_seconds = Histogram(
    "arynwood_llm_call_duration_seconds", "LLM call wall-clock latency in seconds", ["model"]
)
llm_tokens_total = Counter(
    "arynwood_llm_tokens_total", "Tokens processed by LLM calls", ["model", "direction"]
)

tool_calls_total = Counter(
    "arynwood_tool_calls_total", "MCP tool calls attempted", ["server", "tool", "outcome"]
)
tool_call_duration_seconds = Histogram(
    "arynwood_tool_call_duration_seconds", "MCP tool call latency in seconds", ["server", "tool"]
)


def record_llm_call(model: str, outcome: str, latency: float = 0.0, in_tokens: int = 0, out_tokens: int = 0) -> None:
    """outcome: 'success' | 'error'."""
    llm_calls_total.labels(model=model, outcome=outcome).inc()
    if outcome == "success":
        llm_call_duration_seconds.labels(model=model).observe(latency)
        llm_tokens_total.labels(model=model, direction="in").inc(in_tokens)
        llm_tokens_total.labels(model=model, direction="out").inc(out_tokens)


def record_tool_call(server: str, tool: str, outcome: str, latency: float = 0.0) -> None:
    """outcome: 'success' | 'error' | 'denied' | 'invalid'."""
    tool_calls_total.labels(server=server, tool=tool, outcome=outcome).inc()
    if outcome == "success":
        tool_call_duration_seconds.labels(server=server, tool=tool).observe(latency)
