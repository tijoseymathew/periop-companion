"""NAT wiring tests (spec §3.1): the ADK pipeline is registered as a NAT
function so `nat run / serve / eval` can drive it.

M0 exit criterion: `nat run` executes a trivial 3-stage pass.
"""

import pytest

from periop.pipeline import (
    INTRAOP_RECORD_ID,
    PACU_HANDOFF_ID,
    POSTOP_NOTE_ID,
    PREOP_NOTE_ID,
)
from periop.schemas import Case, Chunk, Source, SourceType
from periop.store import CaseStore


@pytest.fixture
def config_file(tmp_path):
    config = tmp_path / "workflow.yml"
    config.write_text(
        f"""\
workflow:
  _type: periop_pipeline
  case_dir: {tmp_path / "cases"}
  stub: true
"""
    )
    return config


async def run_workflow(config_file, message: str) -> str:
    from nat.runtime.loader import load_workflow

    async with load_workflow(config_file) as session_manager:
        async with session_manager.run(message) as runner:
            return await runner.result(to_type=str)


class TestNatWorkflow:
    async def test_runs_three_stages_and_persists_case(self, config_file, tmp_path):
        result = await run_workflow(config_file, "sg-0001")
        for artifact_id in (
            PREOP_NOTE_ID,
            INTRAOP_RECORD_ID,
            PACU_HANDOFF_ID,
            POSTOP_NOTE_ID,
        ):
            assert artifact_id in result
        # processed cases land in <case_dir>/_out, same as the CLI runner
        saved = CaseStore(tmp_path / "cases" / "_out").load("sg-0001")
        assert len(saved.artifacts) == 4

    async def test_loads_existing_case_from_store(self, config_file, tmp_path):
        store = CaseStore(tmp_path / "cases" / "_out")
        store.save(Case(case_id="sg-0042", patient_profile_ref="personas/uuid-9"))
        await run_workflow(config_file, "sg-0042")
        assert store.load("sg-0042").patient_profile_ref == "personas/uuid-9"

    async def test_non_stub_builds_real_pipeline_for_case_bundle(self, tmp_path, monkeypatch):
        """The default (non-stub) path builds the real agent pipeline rooted at
        the case's bundle directory — this is the path `nat run` takes live."""
        import periop.agents.pipeline as agents_pipeline
        import periop.nim as nim

        captured = {}

        def fake_build_case_pipeline(case_dir, chat, fast_chat=None):
            captured["case_dir"] = case_dir
            return None  # run_case falls back to the stub SequentialAgent

        monkeypatch.setattr(agents_pipeline, "build_case_pipeline", fake_build_case_pipeline)
        monkeypatch.setattr(nim, "reasoning_chat", lambda **kw: object())
        monkeypatch.setattr(nim, "fast_chat", lambda **kw: object())

        config = tmp_path / "workflow.yml"
        config.write_text(
            f"""\
workflow:
  _type: periop_pipeline
  case_dir: {tmp_path / "cases"}
"""
        )
        result = await run_workflow(config, "sg-0001")
        assert captured["case_dir"] == tmp_path / "cases" / "sg-0001"
        assert "sg-0001" in result


# ---------------------------------------------------------- periop_stage_run


@pytest.fixture
def stage_config_file(tmp_path):
    """configs/api.yml-shaped config (spec v2-nat §3.1) in stub mode."""
    config = tmp_path / "api.yml"
    config.write_text(
        f"""\
workflow:
  _type: periop_stage_run
  case_dir: {tmp_path / "cases"}
  stub: true
"""
    )
    return config


def seed_case_with_document(store: CaseStore, case_id: str) -> Case:
    """The minimum the stub runner needs: one chunked document source."""
    case = Case(case_id=case_id)
    case.add_source(
        Source(
            source_id="doc:gp-summary",
            type=SourceType.DOCUMENT,
            chunks=[Chunk(chunk_id="c0", text="Aspirin 100mg OD, current.")],
        )
    )
    store.save(case)
    return case


class TestPeriopStageRun:
    """Stage-sized NAT function: the granularity the write API calls at
    (spec v2-nat §3.1). Same store layout as periop_pipeline."""

    async def test_runs_one_stage_and_persists_case(self, stage_config_file, tmp_path):
        store = CaseStore(tmp_path / "cases" / "_out")
        seed_case_with_document(store, "sg-0100")

        result = await run_workflow(
            stage_config_file, '{"case_id": "sg-0100", "stage": "preop"}'
        )

        assert "sg-0100" in result and "preop" in result
        saved = store.load("sg-0100")
        assert saved.get_artifact(PREOP_NOTE_ID) is not None
        # one stage ran, not the whole pipeline
        assert saved.get_artifact(INTRAOP_RECORD_ID) is None

    async def test_missing_case_fails_loudly(self, stage_config_file):
        # unlike periop_pipeline, a stage run never fabricates a case: the
        # write API creates cases, so an unknown id is an error, not a seed
        with pytest.raises(Exception, match="sg-does-not-exist"):
            await run_workflow(
                stage_config_file, '{"case_id": "sg-does-not-exist", "stage": "preop"}'
            )

    async def test_stage_run_keeps_the_session_loop_free_for_export(self, tmp_path):
        """The runner is blocking, so it must run *off* the NAT loop thread:
        a blocked session loop cannot deliver marshaled steps until the
        workflow has already closed its event stream, and the OTel exporter
        drops every LLM span ("Cannot create export task: no running event
        loop") — found live in W8d: the smoke's Langfuse trace held only the
        workflow bracket, zero LLM observations."""
        import asyncio

        from nat.builder.runtime_event_subscriber import pull_intermediate
        from nat.runtime.loader import load_workflow

        from periop.nat.register import _LIVE_BRIDGE, StageRunBridge, StageRunInput
        from periop.nat.telemetry import traced_llm_call

        config = tmp_path / "api.yml"
        config.write_text(
            f"""\
workflow:
  _type: periop_stage_run
  case_dir: {tmp_path / "cases"}
"""
        )
        store = CaseStore(tmp_path / "cases" / "_out")
        seed_case_with_document(store, "sg-0300")
        seen: dict = {}

        class TracedRunner:
            def run_stage(self, case, stage, case_dir, emit):
                try:
                    seen["loop"] = asyncio.get_running_loop()
                except RuntimeError:
                    seen["loop"] = None
                with traced_llm_call("fake", [{"role": "user", "content": "x"}]) as rec:
                    rec.response = None
                return case

        async with load_workflow(config) as sessions:
            _LIVE_BRIDGE.set(
                StageRunBridge(
                    runner=TracedRunner(),
                    emit=lambda e, d: None,
                    out_dir=tmp_path / "cases" / "_out",
                    case_dir=tmp_path / "cases",
                )
            )
            async with sessions.run(
                StageRunInput(case_id="sg-0300", stage="preop")
            ) as runner:
                steps_task = asyncio.ensure_future(pull_intermediate())
                await asyncio.create_task(runner.result(to_type=str))
                steps = await steps_task

        assert seen["loop"] is None, (
            "run_stage executed on the session loop — while it blocks, "
            "steps pushed by the pipeline cannot be delivered for export"
        )
        types = [s["payload"]["event_type"] for s in steps]
        assert "LLM_START" in types and "LLM_END" in types

    async def test_steps_pushed_off_loop_marshal_back_to_the_session_loop(self, tmp_path):
        """The layer below the last test: the ADK pipeline runs every NimChat
        completion in ``asyncio.to_thread``, so its steps are pushed from
        loop-less worker threads — exporters react to a step by calling
        ``asyncio.create_task`` in the *delivering* thread, and off-loop
        delivery drops the span ("Cannot create export task … no running
        event loop", one warning per LLM call, workflow-only Langfuse traces).
        ``bind_export_loop`` in the NAT function must bring those steps home."""
        import asyncio
        import contextvars
        import threading

        from nat.builder.context import ContextState
        from nat.builder.runtime_event_subscriber import pull_intermediate
        from nat.runtime.loader import load_workflow

        from periop.nat.register import _LIVE_BRIDGE, StageRunBridge, StageRunInput
        from periop.nat.telemetry import traced_llm_call

        config = tmp_path / "api.yml"
        config.write_text(
            f"""\
workflow:
  _type: periop_stage_run
  case_dir: {tmp_path / "cases"}
"""
        )
        store = CaseStore(tmp_path / "cases" / "_out")
        seed_case_with_document(store, "sg-0301")
        delivery_threads: list[int] = []

        class OffLoopRunner:
            def run_stage(self, case, stage, case_dir, emit):
                # run_agent's exact shape: the pipeline on a worker thread
                # with the caller's context copied, no event loop anywhere
                def pipeline():
                    with traced_llm_call("fake", [{"role": "user", "content": "x"}]) as rec:
                        rec.response = None

                ctx = contextvars.copy_context()
                worker = threading.Thread(target=ctx.run, args=(pipeline,))
                worker.start()
                worker.join()
                return case

        async with load_workflow(config) as sessions:
            _LIVE_BRIDGE.set(
                StageRunBridge(
                    runner=OffLoopRunner(),
                    emit=lambda e, d: None,
                    out_dir=tmp_path / "cases" / "_out",
                    case_dir=tmp_path / "cases",
                )
            )
            async with sessions.run(
                StageRunInput(case_id="sg-0301", stage="preop")
            ) as runner:
                subscription = (
                    ContextState.get().event_stream.get()
                    .subscribe(lambda _: delivery_threads.append(threading.get_ident()))
                )
                steps_task = asyncio.ensure_future(pull_intermediate())
                await asyncio.create_task(runner.result(to_type=str))
                steps = await steps_task
                subscription.unsubscribe()

        types = [s["payload"]["event_type"] for s in steps]
        assert "LLM_START" in types and "LLM_END" in types
        assert delivery_threads and set(delivery_threads) == {threading.get_ident()}, (
            "steps were delivered on a foreign thread — the OTel exporter "
            "cannot schedule export tasks there and drops the spans"
        )
