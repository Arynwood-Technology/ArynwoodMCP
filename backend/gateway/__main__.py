"""Start the backend headless, as the always-on gateway daemon.

    python -m backend.gateway [--host 127.0.0.1] [--port 8020]

The same FastAPI app the desktop uses (backend.api:app), so every /api route works, with
no frontend and no desktop shell. Host and port come from mcp/config/gateway/config.json
plus the overlay (see its README); the flags override both.

Unlike the desktop's sidecar backend this doesn't die with its parent: it is meant to be
run by a service manager (see docs/gateway.md for a systemd user unit) and outlive
whatever started it.
"""

import argparse
import logging
import os

import uvicorn

from backend._frozen import sanitize_environ_for_children


def main(argv=None) -> None:
    from backend.gateway.config import load_config

    config = load_config()
    parser = argparse.ArgumentParser(prog="python -m backend.gateway", description=__doc__.splitlines()[0])
    parser.add_argument("--host", default=config["bind_host"])
    parser.add_argument("--port", type=int, default=config["port"])
    args = parser.parse_args(argv)

    os.environ["ARYNWOOD_BIND_HOST"] = args.host
    os.environ["ARYNWOOD_GATEWAY_DAEMON"] = "1"   # before the app is imported: see gateway.is_daemon()
    sanitize_environ_for_children()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    from backend.api import app
    from backend.services.exposure import validate_bind_host
    validate_bind_host(args.host)
    uvicorn.run(app, host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
