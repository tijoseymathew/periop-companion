"""FastAPI app factory (spec ui.md §4).

Read-mostly API over the existing on-disk case store and rendered audio.
Directories come from the existing env vocabulary (``PERIOP_OUT_DIR``,
``PERIOP_CASE_DIR``) with the repo defaults. When ``ui/dist`` exists (built
SPA), it is served at ``/`` so ``python -m periop.api`` is the single-process
demo command.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import find_dotenv, load_dotenv
from fastapi import FastAPI

from periop.api.routers import (
    audio,
    cases,
    chat,
    claim_reviews,
    edits,
    equipment,
    stage_runs,
    stream_asr,
    workflow,
)

DEFAULT_CASE_DIR = Path("data/cases")
DEFAULT_PROVIDERS = Path("data/providers.json")
_REPO_ROOT = Path(__file__).resolve().parents[3]
UI_DIST = _REPO_ROOT / "ui" / "dist"
NAT_CONFIG = _REPO_ROOT / "configs" / "api.yml"


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """One long-lived NAT session per API process (spec v2-nat §3.2).

    Every live stage run executes inside this session's ``Runner`` so the
    existing ``traced_llm_call`` instrumentation lands on a subscribed
    intermediate-step stream instead of a no-op one. The config's own
    ``case_dir`` never applies here — the API passes its dirs and runner
    through the ``_LIVE_BRIDGE`` contextvar per request.
    """
    from nat.runtime.loader import load_workflow

    from periop.api.gap_analysis import fail_interrupted_analyses
    from periop.api.routers.stage_runs import fail_interrupted_stage_runs
    from periop.api.transcription import fail_interrupted_transcriptions

    # a crash mid-question-prep, mid-transcription or mid-generation leaves a
    # stage stuck at pending/running/generating; sweep those back so the
    # retry paths open up
    fail_interrupted_analyses(app.state.out_dir)
    fail_interrupted_transcriptions(app.state.out_dir)
    fail_interrupted_stage_runs(app.state.out_dir)
    async with load_workflow(NAT_CONFIG) as nat_sessions:
        app.state.nat_sessions = nat_sessions
        yield


def create_app(
    out_dir: Path | str | None = None,
    case_dir: Path | str | None = None,
    ui_dist: Path | str | None = None,
    providers_path: Path | str | None = None,
    runner=None,
    streaming_asr_factory=None,
    chat_runtime=None,
) -> FastAPI:
    # uvicorn/`python -m periop.api` bypass the CLI wrappers that call
    # load_dotenv themselves; resolve from the working directory like the
    # on-disk defaults below already do (never overrides real env vars)
    load_dotenv(find_dotenv(usecwd=True))

    case_dir = Path(case_dir or os.environ.get("PERIOP_CASE_DIR", DEFAULT_CASE_DIR))
    out_dir = Path(out_dir or os.environ.get("PERIOP_OUT_DIR", case_dir / "_out"))
    providers_path = Path(
        providers_path or os.environ.get("PERIOP_PROVIDERS", DEFAULT_PROVIDERS)
    )

    app = FastAPI(
        title="PeriOp Companion — Review API", version="0.1.0", lifespan=_lifespan
    )
    app.state.out_dir = out_dir
    app.state.case_dir = case_dir
    app.state.providers_path = providers_path

    stub = os.environ.get("PERIOP_STUB_RUNNER") == "1"
    if runner is None:
        from periop.api.runner import LivePipelineRunner, StubPipelineRunner

        # hermetic e2e (spec v2 §8): the real server with instant artifacts
        runner = StubPipelineRunner() if stub else LivePipelineRunner()
    app.state.runner = runner

    if streaming_asr_factory is None:
        # one transcriber per dictation session (v2 stretch): fake under the
        # stub flag, the Parakeet streaming profile live
        if stub:
            from periop.api.runner import FakeStreamingTranscriber

            streaming_asr_factory = FakeStreamingTranscriber
        else:

            def streaming_asr_factory():
                from periop.agents.lexicon import ANESTHESIA_LEXICON
                from periop.tools.asr import ParakeetStreamingAsr

                return ParakeetStreamingAsr(boosted_words=ANESTHESIA_LEXICON)

    app.state.streaming_asr_factory = streaming_asr_factory

    from periop.equipment import EquipmentStore

    app.state.equipment_store = EquipmentStore(out_dir)
    if chat_runtime is None:
        if stub:
            from periop.api.runner import StubChatRuntime

            chat_runtime = StubChatRuntime(out_dir)
        else:
            # lazy: the runtime builds its agent + fast-tier client on the
            # first turn, so creating the app needs no network or keys
            from periop.agents.case_chat import CaseChatRuntime

            chat_runtime = CaseChatRuntime(out_dir)
    app.state.chat_runtime = chat_runtime

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(cases.router, prefix="/api")
    app.include_router(audio.router, prefix="/api")
    app.include_router(workflow.router, prefix="/api")
    app.include_router(stage_runs.router, prefix="/api")
    app.include_router(claim_reviews.router, prefix="/api")
    app.include_router(edits.router, prefix="/api")
    app.include_router(stream_asr.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(equipment.router, prefix="/api")

    ui_dist = Path(ui_dist) if ui_dist is not None else UI_DIST
    if ui_dist.is_dir():
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=ui_dist, html=True), name="ui")

    return app


app = create_app()
