"""Single-process demo entry point: ``uv run python -m periop.api``.

Serves the API and, when ``ui/dist`` exists (``cd ui && npm run build``),
the built review SPA at http://localhost:8000/.
"""

import os

import uvicorn


def main() -> None:
    uvicorn.run(
        "periop.api.app:app",
        host=os.environ.get("PERIOP_API_HOST", "127.0.0.1"),
        port=int(os.environ.get("PERIOP_API_PORT", "8000")),
    )


if __name__ == "__main__":
    main()
