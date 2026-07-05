"""Intra-op + post-op stage orchestration and full-case runner (spec §3.4-3.5, M3 exit)."""

import json

import pytest

from periop.agents.claim_verifier import VerifierVerdict
from periop.agents.event_extractor import ExtractedEvent, ExtractedEvents
from periop.agents.gap_analyst import ClarificationQuestion, GapQuestions, QuestionReason
from periop.agents.handoff import HANDOFF_ID, HandoffItem, HandoffPlan
from periop.agents.intraop_record import INTRAOP_RECORD_ID
from periop.agents.issue_anticipator import (
    ANTICIPATED_ISSUES_ID,
    AnticipatedIssue,
    AnticipatedIssues,
)
from periop.agents.postop_eval import POSTOP_NOTE_ID
from periop.agents.preop_note import PREOP_NOTE_ID, WriterClaim, WriterOutput
from periop.agents.stages import run_case_stages, run_intraop_stage, run_postop_stage
from periop.schemas import Case, ClaimStatus
from periop.synthgen.bundle import write_bundle
from tests.test_case_designer import make_design
from tests.test_personas import make_persona
from tests.test_scripts_gen import make_gold, make_interview, make_intraop


@pytest.fixture
def case_dir(tmp_path):
    d = tmp_path / "sg-0001"
    write_bundle(
        d,
        design=make_design(),
        persona=make_persona("u1", 63, "Female"),
        preop=make_interview("I stopped the aspirin six days ago, doctor."),
        intraop=make_intraop(),
        postop=make_interview("No pain and no nausea, doctor."),
        gold_artifacts=make_gold(),
    )
    return d


class ScriptedChat:
    """One chat that answers every agent by the schema it asks for."""

    def __init__(self):
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append(schema.__name__)
        name = schema.__name__
        if name == "GapQuestions":
            return GapQuestions(questions=[
                ClarificationQuestion(question="Still on aspirin?",
                                      reason=QuestionReason.CONFLICTING,
                                      provenance=["doc:med-list#c001"])
            ])
        if name == "WriterOutput":
            # pre-op note, intra-op record, and post-op note all use WriterOutput;
            # cite a segment that exists in each stage's registered sources.
            return WriterOutput(claims=[
                WriterClaim(text="A cited claim.", section="X",
                            provenance=["audio:preop-interview#s002"]),
            ])
        if name == "ExtractedEvents":
            return ExtractedEvents(events=[
                ExtractedEvent(t="08:02", category="dose", value="propofol 120",
                               units="mg", provenance=["audio:intraop-notes#s001"]),
            ])
        if name == "AnticipatedIssues":
            return AnticipatedIssues(issues=[
                AnticipatedIssue(issue="PONV watch.",
                                 provenance=["audio:intraop-notes#s001"])
            ])
        if name == "HandoffPlan":
            return HandoffPlan(items=[
                HandoffItem(section="S", text="Aspirin held.",
                            source_claims=[f"{PREOP_NOTE_ID}#c-001"]),
            ])
        if name == "VerifierVerdict":
            return VerifierVerdict(status=ClaimStatus.SUPPORTED, rationale="ok")
        raise AssertionError(name)


class TestFullStages:
    def test_intraop_stage_builds_record_and_issues(self, case_dir):
        chat = ScriptedChat()
        case = Case(case_id="sg-0001")
        # pre-op must run first (intra-op record + issues build on it)
        from periop.agents.preop_stage import run_preop_stage
        run_preop_stage(case, case_dir, chat=chat)
        run_intraop_stage(case, case_dir, chat=chat, fast_chat=chat)
        assert case.get_artifact(INTRAOP_RECORD_ID) is not None
        assert case.get_artifact(ANTICIPATED_ISSUES_ID) is not None
        assert case.get_source("audio:intraop-notes") is not None

    def test_intraop_stage_verifies_anticipated_issues(self, case_dir):
        # every generated artifact goes through the ClaimVerifier — the
        # anticipated-issues claims must not stay unverified (spec §4.3)
        chat = ScriptedChat()
        case = Case(case_id="sg-0001")
        from periop.agents.preop_stage import run_preop_stage
        run_preop_stage(case, case_dir, chat=chat)
        run_intraop_stage(case, case_dir, chat=chat, fast_chat=chat)
        issues = case.get_artifact(ANTICIPATED_ISSUES_ID)
        assert issues.claims
        for claim in issues.claims:
            assert claim.status != ClaimStatus.UNVERIFIED

    def test_postop_stage_builds_handoff_and_note(self, case_dir):
        chat = ScriptedChat()
        case = Case(case_id="sg-0001")
        from periop.agents.preop_stage import run_preop_stage
        run_preop_stage(case, case_dir, chat=chat)
        run_intraop_stage(case, case_dir, chat=chat, fast_chat=chat)
        run_postop_stage(case, case_dir, chat=chat)
        handoff = case.get_artifact(HANDOFF_ID)
        assert handoff is not None and handoff.claims
        assert case.get_artifact(POSTOP_NOTE_ID) is not None

    def test_handoff_claims_only_inherit_existing_provenance(self, case_dir):
        chat = ScriptedChat()
        case = run_case_stages(Case(case_id="sg-0001"), case_dir, chat=chat, fast_chat=chat)
        handoff = case.get_artifact(HANDOFF_ID)
        preop = case.get_artifact(PREOP_NOTE_ID)
        allowed = {str(r) for c in preop.claims for r in c.provenance}
        for claim in handoff.claims:
            assert {str(r) for r in claim.provenance} <= allowed

    def test_run_case_stages_produces_all_artifacts(self, case_dir):
        case = run_case_stages(Case(case_id="sg-0001"), case_dir,
                               chat=ScriptedChat(), fast_chat=ScriptedChat())
        ids = {a.artifact_id for a in case.artifacts}
        assert {PREOP_NOTE_ID, INTRAOP_RECORD_ID, ANTICIPATED_ISSUES_ID,
                HANDOFF_ID, POSTOP_NOTE_ID} <= ids

    async def test_adk_case_pipeline_drives_real_stages(self, case_dir):
        # the real agents run inside ADK StageAgents (observability seam intact)
        from periop.agents.pipeline import build_case_pipeline, run_case
        chat = ScriptedChat()
        pipeline = build_case_pipeline(case_dir, chat=chat, fast_chat=chat)
        case = await run_case(Case(case_id="sg-0001"), pipeline=pipeline)
        ids = {a.artifact_id for a in case.artifacts}
        assert {PREOP_NOTE_ID, INTRAOP_RECORD_ID, HANDOFF_ID, POSTOP_NOTE_ID} <= ids
