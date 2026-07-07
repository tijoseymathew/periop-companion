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
