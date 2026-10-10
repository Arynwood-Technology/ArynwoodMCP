"""Narrow routing rules that do not depend on a model's tool judgment."""
import re


_GREETING = re.compile(r"(?:hello|hi|hey|good morning|good afternoon|good evening)[\s!.?]*", re.IGNORECASE)
GREETING_REPLY_GUIDANCE = (
    "The current user message is only a greeting. Reply with a brief greeting in your own voice. "
    "Do not list search results or discuss tools. Examples in your instructions are not the "
    "user's task; do not continue a feed-adding walkthrough or any other example."
)


def greeting_only(message: str) -> bool:
    """Match the entire message; greetings followed by a task or attachment are not exempt."""
    return bool(_GREETING.fullmatch(message.strip()))
