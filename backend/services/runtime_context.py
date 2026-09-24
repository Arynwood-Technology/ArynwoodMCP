"""Request-scoped context shared by retrieval and tools; never global user state."""
from contextvars import ContextVar

project_id: ContextVar[int | None] = ContextVar('project_id', default=None)
conversation_id: ContextVar[int | None] = ContextVar('conversation_id', default=None)
source_message_id: ContextVar[int | None] = ContextVar('source_message_id', default=None)
run_id: ContextVar[str | None] = ContextVar('run_id', default=None)
evidence: ContextVar[list | None] = ContextVar('evidence', default=None)


def record_evidence(kind: str, **details):
    events = evidence.get()
    if events is not None:
        events.append({'kind': kind, **details})
