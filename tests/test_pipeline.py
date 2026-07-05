"""M0 pipeline tests: three stage stubs runnable end-to-end (spec §9 M0).

Stage functions are pure Case → Case transforms so they stay testable without
any LLM; the ADK layer wraps them. Real agent logic replaces the stub bodies
in M2/M3 without changing the orchestration seam.
"""

import pytest
from google.genai import types

from periop.pipeline import (
    INTRAOP_RECORD_ID,
    PACU_HANDOFF_ID,
    POSTOP_NOTE_ID,
    PREOP_NOTE_ID,
    run_intraop,
    run_postop,
    run_preop,
)
from periop.agents.pipeline import build_pipeline, run_case
from periop.schemas import Case


class TestStageFunctions:
    def test_preop_adds_pre_anesthesia_note(self):
        case = run_preop(Case(case_id="sg-0001"))
        assert case.get_artifact(PREOP_NOTE_ID) is not None

    def test_intraop_adds_record(self):
        case = run_intraop(run_preop(Case(case_id="sg-0001")))
        assert case.get_artifact(INTRAOP_RECORD_ID) is not None

    def test_postop_adds_handoff_and_note(self):
        case = run_postop(run_intraop(run_preop(Case(case_id="sg-0001"))))
        assert case.get_artifact(PACU_HANDOFF_ID) is not None
        assert case.get_artifact(POSTOP_NOTE_ID) is not None

    def test_stage_order_is_enforced(self):
        # Intra-op before pre-op is a workflow error, not a silent pass.
        with pytest.raises(ValueError, match=PREOP_NOTE_ID):
            run_intraop(Case(case_id="sg-0001"))
        with pytest.raises(ValueError, match=INTRAOP_RECORD_ID):
            run_postop(run_preop(Case(case_id="sg-0001")))


class TestAdkPipeline:
    def test_pipeline_has_three_stage_agents(self):
        pipeline = build_pipeline()
        assert pipeline.name == "periop_pipeline"
        assert [a.name for a in pipeline.sub_agents] == [
            "preop_stage",
            "intraop_stage",
            "postop_stage",
        ]

    async def test_run_case_produces_all_artifacts(self):
        case = await run_case(Case(case_id="sg-0042"))
        assert [a.artifact_id for a in case.artifacts] == [
            PREOP_NOTE_ID,
            INTRAOP_RECORD_ID,
            PACU_HANDOFF_ID,
            POSTOP_NOTE_ID,
        ]

    async def test_stage_agents_report_progress_events(self):
        from google.adk.runners import InMemoryRunner

        runner = InMemoryRunner(agent=build_pipeline(), app_name="periop")
        session = await runner.session_service.create_session(
            app_name="periop",
            user_id="tester",
            state={"case": Case(case_id="sg-0042").model_dump(mode="json")},
        )
        authors = []
        async for event in runner.run_async(
            user_id="tester",
            session_id=session.id,
            new_message=types.Content(role="user", parts=[types.Part(text="run")]),
        ):
            authors.append(event.author)
        assert authors == ["preop_stage", "intraop_stage", "postop_stage"]
