"""Best-effort credential minimization; not an egress policy or secret detector."""
import re

_SECRET_KEY = re.compile(r'(?i)(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)')
_PATTERNS = (
    re.compile(r'sk-[A-Za-z0-9_-]{20,}'),
    re.compile(r'(?i)\bbearer\s+[A-Za-z0-9._~+/-]+=*'),
    re.compile(r'(?i)\b(?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s&,;]+'),
)


def redact(value):
    if isinstance(value, str):
        for pattern in _PATTERNS:
            value = pattern.sub('[REDACTED]', value)
        return value
    if isinstance(value, dict):
        return {key: '[REDACTED]' if _SECRET_KEY.search(str(key)) else redact(item)
                for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    return value
