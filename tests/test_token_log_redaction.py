"""A WebSocket may carry the API key as ?token=; uvicorn's logs print the path with its query string.

Found 2026-10-23 in the security pass: the access log (on by default) recorded the key in plain text."""
import logging

import backend.api  # noqa: F401  (installs the filter, as starting the server does)


def test_the_token_is_redacted_in_access_and_websocket_log_lines(caplog):
    with caplog.at_level(logging.INFO, logger="uvicorn.access"), caplog.at_level(logging.INFO, logger="uvicorn.error"):
        # The exact formats uvicorn uses for an HTTP request and a WebSocket handshake.
        logging.getLogger("uvicorn.access").info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5", "GET", "/api/chat/ws?token=owner-secret&x=1", "1.1", 101)
        logging.getLogger("uvicorn.error").info('%s - "WebSocket %s" [accepted]', "127.0.0.1:5", "/api/chat/ws?a=b&TOKEN=owner-secret")
    assert "owner-secret" not in caplog.text
    assert "/api/chat/ws?token=[redacted]&x=1" in caplog.text
    assert "/api/chat/ws?a=b&TOKEN=[redacted]" in caplog.text


def test_other_query_values_are_left_as_they_are(caplog):
    with caplog.at_level(logging.INFO, logger="uvicorn.access"):
        logging.getLogger("uvicorn.access").info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5", "GET", "/api/fs/read?path=docs/x.md&access_token_hint=1", "1.1", 200)
    assert "/api/fs/read?path=docs/x.md&access_token_hint=1" in caplog.text
