"""Pre-op stage wiring + CLI provenance rendering (spec §3.3, M2 exit).

The stage composes: ingest records → gap analysis → interview transcript →
note writing → claim verification, all against one Case. Chat is injected so
the wiring is testable without live NIMs.
"""

import pytest

from periop.agents.claim_verifier import VerifierVerdict
from periop.agents.gap_analyst import ClarificationQuestion, GapQuestions, QuestionReason
from periop.agents.preop_note import WriterClaim, WriterOutput
from periop.agents.preop_stage import run_preop_stage
from periop.cli.render import render_claim_provenance
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
        postop=make_interview(),
        gold_artifacts=make_gold(),
    )
    return d


class ScriptedChat:
    """Dispatches by requested schema; verifier returns 'supported' each call."""

    def __init__(self):
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append(schema.__name__)
        if schema is GapQuestions:
            return GapQuestions(
                questions=[
                    ClarificationQuestion(
                        question="Is the patient still taking aspirin?",
                        reason=QuestionReason.CONFLICTING,
                        provenance=["doc:med-list#c001"],
                    )
                ]
            )
        if schema is WriterOutput:
            return WriterOutput(
                claims=[
                    WriterClaim(
                        text="Aspirin was stopped 6 days before surgery.",
                        section="Medications",
                        provenance=["audio:preop-interview#s002"],
                    ),
                    WriterClaim(
                        text="Scheduled for laparoscopic cholecystectomy.",
                        section="History",
                        provenance=["doc:op-plan#c001"],
                    ),
                ]
            )
        if schema is VerifierVerdict:
            return VerifierVerdict(status=ClaimStatus.SUPPORTED, rationale="ok")
        raise AssertionError(f"unexpected schema {schema}")


class TestPreOpStage:
    def test_end_to_end_produces_verified_note(self, case_dir):
        chat = ScriptedChat()
        case = run_preop_stage(Case(case_id="sg-0001"), case_dir, chat=chat)

        # records + interview registered as sources
        assert case.get_source("doc:gp-summary") is not None
        assert case.get_source("audio:preop-interview") is not None
        # gap questions captured
        assert [q.question for q in case.open_questions] == [
            "Is the patient still taking aspirin?"
        ]
        # note written and every claim verified
        note = case.get_artifact("note:pre-anesthesia-eval")
        assert len(note.claims) == 2
        assert all(c.status == ClaimStatus.SUPPORTED for c in note.claims)

    def test_note_claims_resolve_to_real_spans(self, case_dir):
        case = run_preop_stage(Case(case_id="sg-0001"), case_dir, chat=ScriptedChat())
        note = case.get_artifact("note:pre-anesthesia-eval")
        # audio provenance resolves to a segment with speaker + timing
        seg = case.resolve(note.claims[0].provenance[0])
        assert seg.speaker == "PATIENT"


class TestRenderProvenance:
    def test_audio_citation_shows_speaker_and_time(self, case_dir):
        case = run_preop_stage(Case(case_id="sg-0001"), case_dir, chat=ScriptedChat())
        note = case.get_artifact("note:pre-anesthesia-eval")
        rendered = render_claim_provenance(case, note.claims[0])
        assert "PATIENT" in rendered
        assert "stopped the aspirin" in rendered or "stopped the" in rendered
        assert "audio:preop-interview#s002" in rendered

    def test_document_citation_shows_chunk_text(self, case_dir):
        case = run_preop_stage(Case(case_id="sg-0001"), case_dir, chat=ScriptedChat())
        note = case.get_artifact("note:pre-anesthesia-eval")
        rendered = render_claim_provenance(case, note.claims[1])
        assert "doc:op-plan#c001" in rendered


class TestWorkflowIntegration:
    def test_gap_analyst_skipped_when_questions_already_reviewed(self, case_dir):
        # the live workflow runs the GapAnalyst at intake and the provider
        # reviews the list (v2 §4.1) — the stage run must not overwrite it
        from periop.schemas import OpenQuestion

        case = Case(case_id="sg-0001")
        case.open_questions = [
            OpenQuestion(question="Is the patient still taking aspirin?", review="approved")
        ]
        chat = ScriptedChat()
        run_preop_stage(case, case_dir, chat=chat)
        assert "GapQuestions" not in chat.calls
        assert case.open_questions[0].review == "approved"

    def test_emits_progress_events(self, case_dir):
        events = []
        run_preop_stage(
            Case(case_id="sg-0001"),
            case_dir,
            chat=ScriptedChat(),
            emit=lambda e, d: events.append((e, d)),
        )
        names = [e for e, _ in events]
        # one start/end pair per agent, then the finished artifact
        assert names == [
            "agent_start", "agent_end",   # GapAnalyst
            "agent_start", "agent_end",   # InterviewTranscriber (ASR leg)
            "agent_start", "agent_end",   # PreOpNoteWriter
            "agent_start", "agent_end",   # ClaimVerifier
            "artifact_complete",
        ]
        assert events[0][1] == {"stage": "preop", "agent": "GapAnalyst"}
        assert events[-1][1]["artifact_id"] == "note:pre-anesthesia-eval"
        assert events[-1][1]["claims"] == 2

        # each drafting/verification step's agent_end rides a short preview
        # of what it actually produced (v2-ui feedback: show intermediate
        # results, not just a count), not merely a summary string
        gap_end, note_end, verifier_end = events[1], events[5], events[7]
        assert gap_end[1]["agent"] == "GapAnalyst"
        assert gap_end[1]["preview"] == ["Is the patient still taking aspirin?"]
        assert note_end[1]["agent"] == "PreOpNoteWriter"
        assert note_end[1]["preview"] == [
            "Aspirin was stopped 6 days before surgery.",
            "Scheduled for laparoscopic cholecystectomy.",
        ]
        assert verifier_end[1]["agent"] == "ClaimVerifier"
        assert len(verifier_end[1]["preview"]) == 2
        assert all(p.startswith("supported: ") for p in verifier_end[1]["preview"])
