"""Some Ollama chat templates drop the system prompt whenever tools are attached (hermes3's does).
With tools, the system content must still reach the model, as a leading user message.
See backend/services/ollama_client.py, _TOOLS_ELSE_SYSTEM."""
import httpx
import pytest

from backend.services import ollama_client

# Excerpts of the real templates (ollama show <model> --template), 2026-10-06.
HERMES3 = """{{- if .Messages }}
{{- if or .System .Tools }}<|im_start|>system
{{- if .Tools }}
You are a function calling AI model. ... <tools>
{{- range .Tools }}
{"type": "function", "function": {{ .Function }}}
{{- end }}  </tools> ...
{{- else if .System }}
{{ .System }}
{{- end }}<|im_end|>
{{ end }}"""
LLAMA32 = """<|start_header_id|>system<|end_header_id|>
{{ if .System }}{{ .System }}
{{- end }}
{{- if .Tools }}When you receive a tool call response, use the output to format an answer
{{- end }}"""
PHI4_MINI = """{{- if or .System .Tools }}<|system|>{{ if .System }}{{ .System }}{{ end }}
{{- if .Tools }}{{ if not .System }}You are a helpful assistant with some tools.{{ end }}<|tool|>{{ .Tools }}<|/tool|><|end|>"""


@pytest.mark.parametrize("template,drops", [(HERMES3, True), (LLAMA32, False), (PHI4_MINI, False), ("", False)])
def test_detects_templates_that_drop_the_system_prompt(template, drops):
    assert ollama_client.template_drops_system_with_tools(template) is drops


def test_system_content_becomes_the_leading_user_message():
    messages = [{"role": "system", "content": "You are Arynwood."},
                {"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"},
                {"role": "user", "content": "and now?"}]
    sent = ollama_client.system_as_leading_user_message(messages)
    assert [m["role"] for m in sent] == ["user", "user", "assistant", "user"]
    assert sent[0]["content"].startswith(ollama_client.SYSTEM_AS_USER_LEAD)
    assert "You are Arynwood." in sent[0]["content"] and sent[0]["content"].endswith("</instructions>")
    assert sent[1:] == messages[1:]
    assert ollama_client.system_as_leading_user_message(messages[1:]) == messages[1:]   # nothing to move


@pytest.fixture
def ollama(monkeypatch):
    """A fake Ollama: /api/show answers with `template`, chat records what it was sent."""
    state = {"template": HERMES3, "shows": 0, "sent": []}

    def show(request):
        state["shows"] += 1
        return httpx.Response(200, json={"template": state["template"]})
    factory = httpx.AsyncClient
    monkeypatch.setattr(ollama_client.httpx, "AsyncClient",
                        lambda **kw: factory(transport=httpx.MockTransport(show), **kw))

    class Client:
        async def chat(self, *, model, messages, tools=None, options=None, keep_alive=None, stream=False):
            state["sent"].append(messages)
            return {"message": {"content": "ok"}, "prompt_eval_count": 1, "eval_count": 1}
    monkeypatch.setattr(ollama_client, "get_async_client", lambda *a, **k: Client())
    monkeypatch.setattr(ollama_client, "_ollama_options", lambda *a: _noop_options())
    monkeypatch.setattr(ollama_client, "_drops_system", {})
    return state


async def _noop_options():
    return {}


TOOLS = [{"type": "function", "function": {"name": "web_search", "parameters": {"type": "object"}}}]
MESSAGES = [{"role": "system", "content": "Answer in French."}, {"role": "user", "content": "hi"}]


async def test_hermes_with_tools_gets_its_instructions_as_a_user_message(ollama):
    await ollama_client.chat(model="hermes3:8b", messages=MESSAGES, tools=TOOLS, host="localhost", port=11434)
    sent = ollama["sent"][-1]
    assert sent[0]["role"] == "user" and "Answer in French." in sent[0]["content"]
    assert not any(m["role"] == "system" for m in sent)
    await ollama_client.chat(model="hermes3:8b", messages=MESSAGES, tools=TOOLS, host="localhost", port=11434)
    assert ollama["shows"] == 1          # the template is looked up once per model and server


async def test_without_tools_or_with_a_good_template_nothing_changes(ollama):
    await ollama_client.chat(model="hermes3:8b", messages=MESSAGES, host="localhost", port=11434)
    assert ollama["sent"][-1] == MESSAGES                    # no tools: the template keeps .System
    ollama["template"] = LLAMA32
    await ollama_client.chat(model="llama3.2:3b", messages=MESSAGES, tools=TOOLS, host="localhost", port=11434)
    assert ollama["sent"][-1] == MESSAGES
