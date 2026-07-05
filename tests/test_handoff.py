"""HandoffComposer + PostAnesthesiaEvaluator tests (spec §3.5, §4).

The HandoffComposer is deliberately constrained: it may select, order, and
lightly rephrase EXISTING claims but may not introduce new claims. Provenance
is inherited from the referenced source claims — so a handoff claim can never
cite a span the composer invented. This is the demoable hallucination-control
statement (spec §3.5).
"""

import pytest

from periop.agents.handoff import (
    HANDOFF_ID,
    HandoffComposer,
    HandoffItem,
    HandoffPlan,
)
from periop.agents.postop_eval import POSTOP_NOTE_ID, PostAnesthesiaEvaluator
from periop.agents.preop_note import WriterClaim, WriterOutput
from periop.schemas import (
    ArtifactRecord,
    AudioSegment,
    Case,
    Chunk,
    Claim,
    ClaimStatus,
    Source,
    SourceType,
)
from periop.tools.ingest import transcript_from_script


@pytest.fixture
def case(tmp_path):
    # Artifacts are appended directly (not via add_artifact) so the fixture
    # need not also register every underlying source — the composer is what's
    # under test, and it composes over existing claims.
    c = Case(case_id="sg-0001")
    c.add_source(Source(source_id="doc:gp-summary", type=SourceType.DOCUMENT,
                        chunks=[Chunk(chunk_id="c005", text="Penicillin (rash)")]))
    c.add_source(Source(source_id="audio:preop-interview", type=SourceType.AUDIO,
                        segments=[AudioSegment(seg_id="s002", t0=1.0, t1=2.0,
                                               speaker="PATIENT", text="stopped aspirin")]))
    c.add_source(Source(source_id="audio:intraop-notes", type=SourceType.AUDIO,
                        segments=[AudioSegment(seg_id="s001", t0=0.0, t1=1.0,
                                               speaker="PROVIDER", text="propofol")]))
    c.artifacts.append(
        ArtifactRecord(
            artifact_id="note:pre-anesthesia-eval",
            claims=[
                Claim(claim_id="c-001", text="Penicillin allergy (rash).",
                      provenance=["doc:gp-summary#c005"], status=ClaimStatus.SUPPORTED),
                Claim(claim_id="c-002", text="Aspirin stopped 6 days pre-op.",
                      provenance=["audio:preop-interview#s002"], status=ClaimStatus.SUPPORTED),
            ],
        )
    )
    c.artifacts.append(
        ArtifactRecord(
            artifact_id="record:intra-op",
            claims=[
                Claim(claim_id="c-001", text="Induced with propofol 120 mg.",
                      provenance=["audio:intraop-notes#s001"], status=ClaimStatus.SUPPORTED),
            ],
        )
    )
    return c


class FakeChat:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append(user)
        return self.result


class TestHandoffComposer:
    def test_composes_only_from_existing_claims(self, case):
        plan = HandoffPlan(
            items=[
                HandoffItem(section="Allergies", text="Allergic to penicillin.",
                            source_claims=["note:pre-anesthesia-eval#c-001"]),
                HandoffItem(section="Medications", text="Aspirin held 6 days.",
                            source_claims=["note:pre-anesthesia-eval#c-002"]),
                HandoffItem(section="Anesthetic", text="Propofol induction 120 mg.",
                            source_claims=["record:intra-op#c-001"]),
            ]
        )
        artifact = HandoffComposer(chat=FakeChat(plan)).compose(case)
        assert artifact.artifact_id == HANDOFF_ID
        assert len(artifact.claims) == 3

    def test_provenance_is_inherited_not_regenerated(self, case):
        plan = HandoffPlan(items=[
            HandoffItem(section="Allergies", text="Penicillin allergy.",
                        source_claims=["note:pre-anesthesia-eval#c-001"]),
        ])
        artifact = HandoffComposer(chat=FakeChat(plan)).compose(case)
        # inherited from the pre-op claim, not invented
        assert [str(r) for r in artifact.claims[0].provenance] == ["doc:gp-summary#c005"]

    def test_merges_provenance_from_multiple_source_claims(self, case):
        plan = HandoffPlan(items=[
            HandoffItem(section="Summary", text="Penicillin allergy; aspirin held.",
                        source_claims=["note:pre-anesthesia-eval#c-001",
                                       "note:pre-anesthesia-eval#c-002"]),
        ])
        artifact = HandoffComposer(chat=FakeChat(plan)).compose(case)
        refs = {str(r) for r in artifact.claims[0].provenance}
        assert refs == {"doc:gp-summary#c005", "audio:preop-interview#s002"}

    def test_item_referencing_nonexistent_claim_is_dropped(self, case):
        plan = HandoffPlan(items=[
            HandoffItem(section="Allergies", text="Penicillin allergy.",
                        source_claims=["note:pre-anesthesia-eval#c-001"]),
            HandoffItem(section="Invented", text="Patient has a pacemaker.",
                        source_claims=["note:pre-anesthesia-eval#c-999"]),
        ])
        artifact = HandoffComposer(chat=FakeChat(plan)).compose(case)
        assert [c.text for c in artifact.claims] == ["Penicillin allergy."]

    def test_item_with_no_source_claims_is_dropped(self, case):
        plan = HandoffPlan(items=[
            HandoffItem(section="Freehand", text="Looks stable.", source_claims=[]),
        ])
        artifact = HandoffComposer(chat=FakeChat(plan)).compose(case)
        assert artifact.claims == []

    def test_prompt_lists_existing_claims_by_global_id(self, case):
        composer = HandoffComposer(chat=FakeChat(HandoffPlan(items=[])))
        composer.compose(case)
        prompt = composer.chat.calls[0]
        assert "note:pre-anesthesia-eval#c-001" in prompt
        assert "record:intra-op#c-001" in prompt


class TestPostAnesthesiaEvaluator:
    def test_writes_note_from_postop_interview(self, case, tmp_path):
        script = tmp_path / "postop.json"
        script.write_text(
            '{"turns": [{"speaker": "PATIENT", "text": "No pain, no nausea."}]}'
        )
        case.add_source(transcript_from_script(script, "audio:postop-interview"))
        out = WriterOutput(claims=[
            WriterClaim(text="No PONV in PACU.", section="Recovery",
                        provenance=["audio:postop-interview#s001"]),
        ])
        evaluator = PostAnesthesiaEvaluator(chat=FakeChat(out))
        artifact = evaluator.write(case)
        assert artifact.artifact_id == POSTOP_NOTE_ID
        assert artifact.claims[0].text == "No PONV in PACU."
