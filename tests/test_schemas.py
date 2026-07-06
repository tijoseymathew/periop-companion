"""Schema tests: Case, Source, Claim, Artifact, Event, ProvenanceRef.

The Case object is the substrate for provenance (spec §3.2): notes are stored
as sets of claims, each claim cites source anchors, and conflicts are
first-class.
"""

import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from periop.schemas import (
    ArtifactRecord,
    AudioSegment,
    Case,
    Chunk,
    Claim,
    ClaimStatus,
    Event,
    EventCategory,
    OpenQuestion,
    ProvenanceRef,
    Provider,
    Source,
    SourceType,
    StageName,
    StageStatus,
    Workflow,
)


# ---------------------------------------------------------------- ProvenanceRef


class TestProvenanceRef:
    def test_parses_string_form(self):
        ref = ProvenanceRef.parse("audio:preop-interview#s017")
        assert ref.source_id == "audio:preop-interview"
        assert ref.anchor == "s017"

    def test_round_trips_to_string(self):
        ref = ProvenanceRef(source_id="doc:gp-summary-2024", anchor="c003")
        assert str(ref) == "doc:gp-summary-2024#c003"
        assert ProvenanceRef.parse(str(ref)) == ref

    def test_rejects_missing_anchor(self):
        with pytest.raises(ValueError):
            ProvenanceRef.parse("doc:gp-summary-2024")

    def test_source_id_may_contain_colon(self):
        # source ids like "audio:preop-interview" contain a colon; only the
        # final "#" splits the anchor.
        ref = ProvenanceRef.parse("doc:op-plan#c001")
        assert ref.source_id == "doc:op-plan"


# ----------------------------------------------------------------------- Source


class TestSource:
    def test_document_source_holds_chunks(self):
        src = Source(
            source_id="doc:gp-summary-2024",
            type=SourceType.DOCUMENT,
            chunks=[Chunk(chunk_id="c001", text="Aspirin 100mg OD.", section="Medications")],
        )
        assert src.chunks[0].chunk_id == "c001"

    def test_audio_source_holds_segments(self):
        src = Source(
            source_id="audio:preop-interview",
            type=SourceType.AUDIO,
            segments=[
                AudioSegment(
                    seg_id="s017",
                    t0=214.3,
                    t1=221.8,
                    speaker="PATIENT",
                    text="stopped the aspirin last Tuesday",
                )
            ],
        )
        assert src.segments[0].speaker == "PATIENT"

    def test_document_source_rejects_segments(self):
        with pytest.raises(ValidationError):
            Source(
                source_id="doc:x",
                type=SourceType.DOCUMENT,
                segments=[
                    AudioSegment(seg_id="s1", t0=0.0, t1=1.0, speaker="PATIENT", text="hi")
                ],
            )

    def test_audio_source_rejects_chunks(self):
        with pytest.raises(ValidationError):
            Source(
                source_id="audio:x",
                type=SourceType.AUDIO,
                chunks=[Chunk(chunk_id="c1", text="hi")],
            )

    def test_segment_times_must_be_ordered(self):
        with pytest.raises(ValidationError):
            AudioSegment(seg_id="s1", t0=5.0, t1=4.0, speaker="PATIENT", text="hi")

    def test_anchor_lookup(self):
        src = Source(
            source_id="doc:gp-summary-2024",
            type=SourceType.DOCUMENT,
            chunks=[Chunk(chunk_id="c001", text="Aspirin 100mg OD.")],
        )
        assert src.get_anchor("c001").text == "Aspirin 100mg OD."
        assert src.get_anchor("nope") is None


# ------------------------------------------------------------------------ Claim


class TestClaim:
    def test_defaults_to_unverified(self):
        claim = Claim(
            claim_id="c-031",
            text="Aspirin was discontinued 6 days prior to surgery.",
            provenance=[ProvenanceRef.parse("audio:preop-interview#s017")],
        )
        assert claim.status == ClaimStatus.UNVERIFIED

    def test_provenance_accepts_string_refs(self):
        claim = Claim(
            claim_id="c-001",
            text="x",
            provenance=["doc:gp-summary-2024#c003"],
        )
        assert claim.provenance[0].anchor == "c003"

    def test_serializes_provenance_as_strings(self):
        claim = Claim(claim_id="c-001", text="x", provenance=["doc:a#c1"])
        dumped = claim.model_dump(mode="json")
        assert dumped["provenance"] == ["doc:a#c1"]


# ------------------------------------------------------------------------ Event


class TestEvent:
    def test_intraop_event(self):
        ev = Event(
            t="10:32",
            category=EventCategory.DOSE,
            value="propofol 120",
            units="mg",
            provenance=["audio:intraop-notes#s003"],
        )
        assert ev.category == EventCategory.DOSE

    def test_category_is_constrained(self):
        with pytest.raises(ValidationError):
            Event(t="10:32", category="banana", value="x")


# ------------------------------------------------------------------------- Case


class TestCase:
    def _case(self) -> Case:
        return Case(case_id="sg-0042", patient_profile_ref="personas/uuid-1")

    def _doc(self) -> Source:
        return Source(
            source_id="doc:gp-summary-2024",
            type=SourceType.DOCUMENT,
            chunks=[Chunk(chunk_id="c001", text="Aspirin 100mg OD.")],
        )

    def test_add_source_and_lookup(self):
        case = self._case()
        case.add_source(self._doc())
        assert case.get_source("doc:gp-summary-2024").type == SourceType.DOCUMENT

    def test_source_registry_is_append_only(self):
        case = self._case()
        case.add_source(self._doc())
        with pytest.raises(ValueError, match="already registered"):
            case.add_source(self._doc())

    def test_resolve_provenance_ref_to_chunk(self):
        case = self._case()
        case.add_source(self._doc())
        anchor = case.resolve("doc:gp-summary-2024#c001")
        assert anchor.text == "Aspirin 100mg OD."

    def test_resolve_unknown_ref_raises(self):
        case = self._case()
        with pytest.raises(KeyError):
            case.resolve("doc:missing#c001")

    def test_add_artifact_validates_claim_provenance(self):
        case = self._case()
        case.add_source(self._doc())
        artifact = ArtifactRecord(
            artifact_id="note:pre-anesthesia-eval",
            claims=[Claim(claim_id="c-1", text="On aspirin.", provenance=["doc:gp-summary-2024#c001"])],
        )
        case.add_artifact(artifact)
        assert case.get_artifact("note:pre-anesthesia-eval") is artifact

    def test_add_artifact_rejects_dangling_provenance(self):
        case = self._case()
        artifact = ArtifactRecord(
            artifact_id="note:x",
            claims=[Claim(claim_id="c-1", text="x", provenance=["doc:missing#c9"])],
        )
        with pytest.raises(ValueError, match="doc:missing#c9"):
            case.add_artifact(artifact)

    def test_json_round_trip(self):
        case = self._case()
        case.add_source(self._doc())
        case.add_artifact(
            ArtifactRecord(
                artifact_id="note:x",
                claims=[Claim(claim_id="c-1", text="x", provenance=["doc:gp-summary-2024#c001"])],
            )
        )
        restored = Case.model_validate_json(case.model_dump_json())
        assert restored == case
        assert restored.resolve("doc:gp-summary-2024#c001").text == "Aspirin 100mg OD."

# --------------------------------------------------------------- Workflow block


def _workflow() -> Workflow:
    return Workflow(
        created_by=Provider(provider_id="p-lim", name="Dr A. Lim", role="consultant"),
        created_at="2026-07-06T09:12:00+08:00",
    )


class TestWorkflowBlock:
    def test_new_workflow_starts_all_stages_awaiting_inputs(self):
        wf = _workflow()
        assert set(wf.stages) == {StageName.PREOP, StageName.INTRAOP, StageName.POSTOP}
        assert all(s.status is StageStatus.AWAITING_INPUTS for s in wf.stages.values())

    def test_case_without_workflow_is_immutable_demo_data(self):
        case = Case(case_id="sg-0001")
        assert case.workflow is None
        assert case.is_demo

    def test_case_with_workflow_is_live(self):
        case = Case(case_id="live-1", workflow=_workflow())
        assert not case.is_demo

    def test_workflow_round_trips_through_json(self):
        case = Case(case_id="live-1", workflow=_workflow())
        stage = case.workflow.stages[StageName.PREOP]
        stage.status = StageStatus.SIGNED_OFF
        stage.performed_by = "p-lim"
        stage.signed_off_by = "p-lim"
        restored = Case.model_validate_json(case.model_dump_json())
        assert restored == case
        assert restored.workflow.stages[StageName.PREOP].status is StageStatus.SIGNED_OFF

    def test_committed_case_jsons_load_unchanged(self):
        # spec v2 §5.1: additive only — every *committed* synthetic case loads
        # as demo data (no workflow block). Only git-tracked files count: the
        # same directory also collects live cases created through the API,
        # which rightly carry a workflow block.
        tracked = subprocess.run(
            ["git", "ls-files", "data/cases/_out/*.json"],
            capture_output=True, text=True, check=True,
        ).stdout.split()
        assert tracked, "expected committed synthetic case JSONs"
        for name in tracked:
            case = Case.model_validate_json(Path(name).read_text())
            assert case.workflow is None, name


# ---------------------------------------------------------------- OpenQuestion


class TestOpenQuestion:
    def test_legacy_plain_string_coerces(self):
        case = Case(case_id="x", open_questions=["Allergy status?"])
        q = case.open_questions[0]
        assert isinstance(q, OpenQuestion)
        assert q.question == "Allergy status?"
        assert q.review is None

    def test_effective_text_prefers_edit(self):
        q = OpenQuestion(question="orig", review="edited", edited_text="better")
        assert q.effective_text == "better"
        assert OpenQuestion(question="orig").effective_text == "orig"

    def test_dismissed_questions_are_inactive(self):
        assert not OpenQuestion(question="q", review="dismissed").is_active
        assert OpenQuestion(question="q", review="approved").is_active
        assert OpenQuestion(question="q").is_active  # unreviewed = active (batch path)

    def test_review_state_is_constrained(self):
        with pytest.raises(ValidationError):
            OpenQuestion(question="q", review="banana")

    def test_serializes_as_object_with_provenance_strings(self):
        case = Case(
            case_id="x",
            open_questions=[
                OpenQuestion(question="Q?", reason="missing", provenance=["doc:a#c1"])
            ],
        )
        dumped = case.model_dump(mode="json")["open_questions"][0]
        assert dumped["question"] == "Q?"
        assert dumped["provenance"] == ["doc:a#c1"]


# ------------------------------------------------------------- Source capture


class TestSourceCaptureFields:
    def test_captured_at_and_provided_by_default_none(self):
        src = Source(source_id="doc:x", type=SourceType.DOCUMENT)
        assert src.captured_at is None
        assert src.provided_by is None

    def test_capture_fields_round_trip(self):
        src = Source(
            source_id="audio:preop-interview",
            type=SourceType.AUDIO,
            captured_at="2026-07-06T10:00:00+08:00",
            provided_by="p-lim",
        )
        restored = Source.model_validate_json(src.model_dump_json())
        assert restored == src
