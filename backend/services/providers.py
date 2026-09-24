"""Provider adapters selected per turn, with backend-only credential resolution."""
from contextvars import ContextVar
import json
import uuid
import httpx

active_provider: ContextVar[dict | None] = ContextVar('active_provider', default=None)


def base_url(config):
    host = config['host'].rstrip('/')
    return host if '://' in host else f"http://{host}:{config.get('port', 11434)}"


def headers(config):
    return {'Authorization': f"Bearer {config['auth_token']}"} if config.get('auth_token') else {}


def endpoint(config, path):
    base = base_url(config)
    return base + ('/' if base.endswith('/v1') else '/v1/') + path


def wire_messages(messages):
    """Translate internal tool_name/arguments objects to compatible API messages."""
    result = []
    pending = []
    for original in messages:
        message = {k: v for k, v in original.items() if k in ('role', 'content', 'tool_calls', 'tool_call_id', 'name')}
        if message.get('tool_calls'):
            calls = []
            for call in message['tool_calls']:
                call_id = call.get('id') or 'call_' + uuid.uuid4().hex
                fn = call['function']
                args = fn.get('arguments', {})
                calls.append({'id': call_id, 'type': 'function', 'function': {
                    'name': fn['name'], 'arguments': args if isinstance(args, str) else json.dumps(args)}})
                pending.append((fn['name'], call_id))
            message['tool_calls'] = calls
        if message['role'] == 'tool':
            name = original.get('tool_name')
            index = next((i for i, pair in enumerate(pending) if pair[0] == name), 0)
            if pending:
                _, call_id = pending.pop(index)
                message.setdefault('tool_call_id', call_id)
        result.append(message)
    return result


def body(config, model, messages, options, tools, stream):
    value = {'model': model, 'messages': wire_messages(messages), 'stream': stream,
             'temperature': (options or {}).get('temperature', 0.7),
             'max_tokens': (options or {}).get('num_predict', 1024)}
    if tools and config.get('tools_mode', 'native') != 'none':
        value['tools'] = tools
    return value


async def complete(config, *, model, messages, options=None, tools=None, timeout=None):
    async with httpx.AsyncClient(timeout=timeout or 120) as client:
        response = await client.post(endpoint(config, 'chat/completions'), headers=headers(config),
                                     json=body(config, model, messages, options, tools, False))
        response.raise_for_status()
        data = response.json()
    message = data['choices'][0]['message']
    usage = data.get('usage', {})
    return {'model': model, 'output': message.get('content') or '', 'tool_calls': message.get('tool_calls'),
            'in_tokens': usage.get('prompt_tokens', 0), 'out_tokens': usage.get('completion_tokens', 0)}


async def stream(config, *, model, messages, options=None, tools=None, timeout=None):
    calls = {}
    finished = False
    async with httpx.AsyncClient(timeout=timeout or 120) as client:
        async with client.stream('POST', endpoint(config, 'chat/completions'), headers=headers(config),
                                 json=body(config, model, messages, options, tools, True)) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith('data:'):
                    continue
                raw = line[5:].strip()
                if raw == '[DONE]':
                    break
                data = json.loads(raw)
                if 'error' in data:
                    raise RuntimeError(str(data['error']))
                for choice in data.get('choices', []):
                    if choice.get('index', 0) != 0:
                        continue
                    delta = choice.get('delta', {})
                    for part in delta.get('tool_calls', []):
                        call = calls.setdefault(part['index'], {'id': '', 'type': 'function', 'function': {'name': '', 'arguments': ''}})
                        if part.get('id'):
                            call['id'] = part['id']
                        for key in ('name', 'arguments'):
                            call['function'][key] += part.get('function', {}).get(key) or ''
                    done = choice.get('finish_reason') is not None
                    finished = finished or done
                    yield {'token': delta.get('content') or '', 'done': done,
                           'tool_calls': list(calls.values()) if done else [],
                           'finish_reason': choice.get('finish_reason'), 'usage': data.get('usage')}
    if not finished:
        raise RuntimeError('Provider stream ended before completing the response; retry the turn.')


def for_endpoint(host=None, port=None):
    config = active_provider.get()
    if not config:
        return None
    # Auxiliary local gates/embeddings must never inherit remote credentials.
    requested = host if host and '://' in host else f"http://{host or '127.0.0.1'}:{port or 11434}"
    return config if requested.rstrip('/') == base_url(config) else None
