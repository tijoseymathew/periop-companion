"""FastAPI app factory (spec ui.md §4).

Read-mostly API over the existing on-disk case store and rendered audio.
Directories come from the existing env vocabulary (``PERIOP_OUT_DIR``,
``PERIOP_CASE_DIR``) with the repo defaults. When ``ui/dist`` exists (built
SPA), it is served at ``/`` so ``python -m periop.api`` is the single-process
demo command.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI

from periop.api.routers import audio, cases, workflow

DEFAULT_CASE_DIR = Path("data/cases")
DEFAULT_PROVIDERS = Path("data/providers.json")
UI_DIST = Path(__file__).resolve().parents[3] / "ui" / "dist"


def create_app(
    out_dir: Path | str | None = None,
    case_dir: Path | str | None = None,
    ui_dist: Path | str | None = None,
    providers_path: Path | str | None = None,
    runner=None,
) -> FastAPI:
    case_dir = Path(case_dir or os.environ.get("PERIOP_CASE_DIR", DEFAULT_CASE_DIR))
    out_dir = Path(out_dir or os.environ.get("PERIOP_OUT_DIR", case_dir / "_out"))
    providers_path = Path(
        providers_path or os.environ.get("PERIOP_PROVIDERS", DEFAULT_PROVIDERS)
    )

    app = FastAPI(title="PeriOp Companion — Review API", version="0.1.0")
    app.state.out_dir = out_dir
    app.state.case_dir = case_dir
    app.state.providers_path = providers_path

    if runner is None:
        from periop.api.runner import LivePipelineRunner

        runner = LivePipelineRunner()
    app.state.runner = runner

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(cases.router, prefix="/api")
    app.include_router(audio.router, prefix="/api")
    app.include_router(workflow.router, prefix="/api")

    ui_dist = Path(ui_dist) if ui_dist is not None else UI_DIST
    if ui_dist.is_dir():
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=ui_dist, html=True), name="ui")

    return app


app = create_app()
