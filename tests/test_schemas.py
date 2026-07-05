"""Schema tests: Case, Source, Claim, Artifact, Event, ProvenanceRef.

The Case object is the substrate for provenance (spec §3.2): notes are stored
as sets of claims, each claim cites source anchors, and conflicts are
first-class.
"""

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
    ProvenanceRef,
    Source,
    SourceType,
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
