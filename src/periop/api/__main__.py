"""Single-process demo entry point: ``uv run python -m periop.api``.

Serves the API and, when ``ui/dist`` exists (``cd ui && npm run build``),
the built review SPA at http://localhost:8000/.
"""

import os
from urllib.parse import urlparse

import uvicorn
from dotenv import find_dotenv, load_dotenv

LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0"}


def tier_port_collisions(port: int) -> list[str]:
    """Chat tiers whose base URL would loop back to this server's port.

    A collision means every generation request the server makes would land on
    the server itself (e.g. the reasoning NIM and the API both claiming
    localhost:8000) — name it at startup instead of hanging at submit time.
    """
    from periop.nim import tier_config

    return [
        tier
        for tier in ("reasoning", "fast")
        if (url := urlparse(tier_config(tier).base_url)).port == port
        and (url.hostname or "") in LOCAL_HOSTS
    ]


def main() -> None:
    load_dotenv(find_dotenv(usecwd=True))
    port = int(os.environ.get("PERIOP_API_PORT", "8000"))
    for tier in tier_port_collisions(port):
        print(
            f"WARNING: the {tier} model URL points at this server's own port "
            f"({port}) — generation requests would loop back and fail. "
            f"Start the API elsewhere, e.g. PERIOP_API_PORT={port + 80}."
        )
    uvicorn.run(
        "periop.api.app:app",
        host=os.environ.get("PERIOP_API_HOST", "127.0.0.1"),
        port=port,
    )


if __name__ == "__main__":
    main()
