"""Intra-op + post-op stage orchestration and full-case runner (spec §3.4-3.5, M3 exit)."""

import json
import threading

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

    def test_postop_writers_overlap_with_deterministic_ledger_order(self, case_dir):
        """Post-op's two Super calls are independent (v2-speed §3.4): they run
        concurrently, but the ledger order is fixed — handoff first — no
        matter which finishes first. Here the handoff is *forced to finish
        last*: it blocks until the post-op note's call has returned, which a
        strictly sequential stage (handoff first) can never satisfy."""
        scripted = ScriptedChat()
        case = Case(case_id="sg-0001")
        from periop.agents.preop_stage import run_preop_stage
        run_preop_stage(case, case_dir, chat=scripted)
        run_intraop_stage(case, case_dir, chat=scripted, fast_chat=scripted)

        # the handoff call blocks until the post-op note's agent_end has been
        # *emitted* (not merely returned), so the completion order the stage
        # reports is fully deterministic here: note first, handoff second
        postop_note_done = threading.Event()

        class OrderedChat:
            def complete_structured(self, user, schema, system=None, **kwargs):
                if schema.__name__ == "HandoffPlan":
                    assert postop_note_done.wait(timeout=10), (
                        "handoff ran strictly before the post-op note — "
                        "the two writers are not overlapping"
                    )
                return scripted.complete_structured(user, schema, system=system, **kwargs)

        events = []

        def emit(event, data):
            events.append((event, data))
            if event == "agent_end" and data.get("agent") == "PostAnesthesiaEvaluator":
                postop_note_done.set()

        run_postop_stage(case, case_dir, chat=OrderedChat(), fast_chat=scripted, emit=emit)

        # both artifacts exist, handoff first in the ledger regardless of
        # completion order (conformance-stable, v2-speed §3.4)
        ids = [a.artifact_id for a in case.artifacts]
        assert ids.index(HANDOFF_ID) < ids.index(POSTOP_NOTE_ID)
        assert case.get_artifact(HANDOFF_ID).claims
        assert case.get_artifact(POSTOP_NOTE_ID).claims

        # SSE: both writers announced up front; ends arrive in completion
        # order (the note finished first here); both artifacts completed
        writer = ("HandoffComposer", "PostAnesthesiaEvaluator")
        flow = [(e, d.get("agent")) for e, d in events
                if d.get("agent") in writer and e in ("agent_start", "agent_end")]
        assert flow[0][0] == flow[1][0] == "agent_start"
        assert flow[2] == ("agent_end", "PostAnesthesiaEvaluator")
        assert flow[3] == ("agent_end", "HandoffComposer")
        completed = [d["artifact_id"] for e, d in events if e == "artifact_complete"]
        assert HANDOFF_ID in completed and POSTOP_NOTE_ID in completed

    def test_postop_writer_failure_raises_and_appends_nothing(self, case_dir):
        scripted = ScriptedChat()
        case = Case(case_id="sg-0001")
        from periop.agents.preop_stage import run_preop_stage
        run_preop_stage(case, case_dir, chat=scripted)
        run_intraop_stage(case, case_dir, chat=scripted, fast_chat=scripted)

        class FailingHandoffChat:
            def complete_structured(self, user, schema, system=None, **kwargs):
                if schema.__name__ == "HandoffPlan":
                    raise RuntimeError("reasoning NIM unreachable")
                return scripted.complete_structured(user, schema, system=system, **kwargs)

        with pytest.raises(RuntimeError, match="unreachable"):
            run_postop_stage(case, case_dir, chat=FailingHandoffChat(), fast_chat=scripted)
        # all-or-nothing: a half-generated stage leaves no partial artifacts
        assert case.get_artifact(HANDOFF_ID) is None
        assert case.get_artifact(POSTOP_NOTE_ID) is None

    async def test_adk_case_pipeline_drives_real_stages(self, case_dir):
        # the real agents run inside ADK StageAgents (observability seam intact)
        from periop.agents.pipeline import build_case_pipeline, run_case
        chat = ScriptedChat()
        pipeline = build_case_pipeline(case_dir, chat=chat, fast_chat=chat)
        case = await run_case(Case(case_id="sg-0001"), pipeline=pipeline)
        ids = {a.artifact_id for a in case.artifacts}
        assert {PREOP_NOTE_ID, INTRAOP_RECORD_ID, HANDOFF_ID, POSTOP_NOTE_ID} <= ids
