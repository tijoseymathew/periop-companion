"""HTTP client plumbing for the provider-workflow CLI.

The CLI is deliberately a thin HTTP client over the same FastAPI app the
browser uses — remote when an API URL is given (``--api-url`` /
``PERIOP_API_URL``), otherwise auto-hosted on an ephemeral localhost port for
the life of the command. Reusing the API wholesale (routers, stage gates,
error copy, the NAT session in the app lifespan) keeps the CLI a re-plumbing,
not a fork, of the workflow layer — the same guarantee v2 §7's conformance
test pins for the API — and v2-nat's tracing comes with it: an auto-hosted
stage run executes inside the same NAT ``Runner`` the server uses.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterable, Iterator
from contextlib import contextmanager

import httpx

#: stage runs block for minutes on Super 49B (ui.md §7) — never time out reads
TIMEOUT = httpx.Timeout(10.0, read=None)


class ApiError(Exception):
    """A non-2xx API response, carrying the server's next-action detail."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def check(resp: httpx.Response) -> httpx.Response:
    """Raise :class:`ApiError` with the structured ``detail`` on failure."""
    if resp.is_success:
        return resp
    try:
        detail = resp.json()["detail"]
    except Exception:
        detail = resp.text or f"HTTP {resp.status_code}"
    raise ApiError(resp.status_code, str(detail))


def iter_sse(lines: Iterable[str]) -> Iterator[tuple[str, dict]]:
    """Parse the run endpoint's ``event:``/``data:`` stream (ui.md §7)."""
    event = None
    for line in lines:
        if line.startswith("event:"):
            event = line.removeprefix("event:").strip()
        elif line.startswith("data:") and event is not None:
            yield event, json.loads(line.removeprefix("data:").strip())
            event = None


@contextmanager
def serve_app(app) -> Iterator[str]:
    """Host ``app`` on an ephemeral localhost port; yield its base URL.

    uvicorn runs on a background thread with the app lifespan entered, so the
    NAT session exists exactly as under ``python -m periop.api``.
    """
    import uvicorn

    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        if not thread.is_alive():
            raise RuntimeError("the API server failed to start")
        time.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join()


@contextmanager
def open_client(api_url: str | None, **app_kwargs) -> Iterator[httpx.Client]:
    """A client for a running server, or for a self-hosted app when none is."""
    if api_url:
        with httpx.Client(base_url=api_url.rstrip("/"), timeout=TIMEOUT) as client:
            yield client
        return

    from periop.api.app import create_app

    with serve_app(create_app(**app_kwargs)) as base_url:
        with httpx.Client(base_url=base_url, timeout=TIMEOUT) as client:
            yield client
