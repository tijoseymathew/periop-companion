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
from periop.schemas import Case
from periop.store import CaseStore


@pytest.fixture
def config_file(tmp_path):
    config = tmp_path / "workflow.yml"
    config.write_text(
        f"""\
workflow:
  _type: periop_pipeline
  case_dir: {tmp_path / "cases"}
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
        saved = CaseStore(tmp_path / "cases").load("sg-0001")
        assert len(saved.artifacts) == 4

    async def test_loads_existing_case_from_store(self, config_file, tmp_path):
        store = CaseStore(tmp_path / "cases")
        store.save(Case(case_id="sg-0042", patient_profile_ref="personas/uuid-9"))
        await run_workflow(config_file, "sg-0042")
        assert store.load("sg-0042").patient_profile_ref == "personas/uuid-9"
