"""PreOpNoteWriter + ClaimVerifier tests (spec §3.3 step 5, §4).

The note writer emits atomic claims, each citing record chunks and/or
interview segments. The verifier re-checks each claim against its cited spans
(NLI-style) → supported / unsupported / conflicting. Unsupported claims are
kept but flagged, never dropped (spec §4.3).
"""

import pytest

from periop.agents.claim_verifier import ClaimVerifier
from periop.agents.preop_note import PreOpNoteWriter, WriterClaim, WriterOutput
from periop.schemas import Case, ClaimStatus, OpenQuestion, SourceType
from periop.tools.chunker import ingest_document
from periop.tools.ingest import transcript_from_script


GP = """\
# GP Summary

## Medications

Aspirin 100mg OD, current.
"""


def _case_with_interview(tmp_path):
    case = Case(case_id="sg-0001")
    case.add_source(ingest_document("doc:gp-summary", GP))
    script = tmp_path / "preop.json"
    script.write_text(
        '{"turns": ['
        '{"speaker": "PROVIDER", "text": "Still on aspirin?"},'
        '{"speaker": "PATIENT", "text": "No, I stopped it six days ago."}'
        ']}'
    )
    case.add_source(transcript_from_script(script, "audio:preop-interview"))
    return case


class FakeChat:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append({"user": user, "schema": schema, "system": system})
        return self.result


class TestPreOpNoteWriter:
    def test_builds_artifact_of_claims(self, tmp_path):
        case = _case_with_interview(tmp_path)
        out = WriterOutput(
            claims=[
                WriterClaim(
                    text="Aspirin was discontinued 6 days before surgery.",
                    section="Medications",
                    provenance=["audio:preop-interview#s002"],
                )
            ]
        )
        writer = PreOpNoteWriter(chat=FakeChat(out))
        artifact = writer.write(case)
        assert artifact.artifact_id == "note:pre-anesthesia-eval"
        assert artifact.claims[0].claim_id == "c-001"
        assert artifact.claims[0].status == ClaimStatus.UNVERIFIED
        # persisted on the case with provenance validated
        assert case.get_artifact("note:pre-anesthesia-eval") is artifact

    def test_prompt_includes_open_questions_for_alignment(self, tmp_path):
        case = _case_with_interview(tmp_path)
        case.open_questions = [OpenQuestion(question="Is the patient still taking aspirin?")]
        writer = PreOpNoteWriter(chat=FakeChat(WriterOutput(claims=[])))
        writer.write(case)
        prompt = writer.chat.calls[0]["user"]
        assert "Is the patient still taking aspirin?" in prompt
        assert "audio:preop-interview#s002" in prompt  # interview cited by anchor

    def test_prompt_uses_reviewed_question_list(self, tmp_path):
        # spec v2 §4.1: the approved list is what question→answer alignment
        # runs against — dismissed questions are excluded, edits win
        case = _case_with_interview(tmp_path)
        case.open_questions = [
            OpenQuestion(question="Dismissed q?", review="dismissed"),
            OpenQuestion(question="Original q?", review="edited", edited_text="Edited q?"),
            OpenQuestion(question="Approved q?", review="approved"),
        ]
        writer = PreOpNoteWriter(chat=FakeChat(WriterOutput(claims=[])))
        writer.write(case)
        prompt = writer.chat.calls[0]["user"]
        assert "Dismissed q?" not in prompt
        assert "Edited q?" in prompt
        assert "Original q?" not in prompt
        assert "Approved q?" in prompt

    def test_bracketed_provenance_refs_are_normalized_and_kept(self, tmp_path):
        # prompts display refs as [source#anchor]; models sometimes echo the
        # brackets — the claim must survive with the clean ref, not be dropped
        case = _case_with_interview(tmp_path)
        out = WriterOutput(
            claims=[
                WriterClaim(text="ok", section="X",
                            provenance=["[doc:gp-summary#c001]", " audio:preop-interview#s002 "]),
            ]
        )
        artifact = PreOpNoteWriter(chat=FakeChat(out)).write(case)
        assert [str(r) for r in artifact.claims[0].provenance] == [
            "doc:gp-summary#c001",
            "audio:preop-interview#s002",
        ]

    def test_drops_claims_with_dangling_provenance(self, tmp_path):
        case = _case_with_interview(tmp_path)
        out = WriterOutput(
            claims=[
                WriterClaim(text="ok", section="X", provenance=["doc:gp-summary#c001"]),
                WriterClaim(text="bad", section="X", provenance=["doc:ghost#c9"]),
            ]
        )
        artifact = PreOpNoteWriter(chat=FakeChat(out)).write(case)
        assert [c.text for c in artifact.claims] == ["ok"]


class VerifierFakeChat:
    """Returns a status per claim in call order."""

    def __init__(self, statuses):
        self.statuses = list(statuses)
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append(user)
        status = self.statuses.pop(0)
        return schema(status=status, rationale="test")


class TestRelevanceFiltering:
    """Distractor leakage (spec §5/§6): records carry deliberately irrelevant
    history; the writer must exclude it or justify its anesthetic relevance."""

    def test_prompt_carries_relevance_rule_with_examples(self, tmp_path):
        case = _case_with_interview(tmp_path)
        chat = FakeChat(WriterOutput(claims=[]))
        PreOpNoteWriter(chat=chat).write(case)
        prompt = chat.calls[0]["user"]
        assert "Relevance filter" in prompt
        assert "resolved" in prompt and "distractor" in prompt.lower()
        # the justification requirement is what distractor_leakage measures
        assert "state that reason in the claim text" in prompt


class TestClaimVerifier:
    def _artifact_case(self, tmp_path):
        case = _case_with_interview(tmp_path)
        out = WriterOutput(
            claims=[
                WriterClaim(text="Stopped aspirin 6 days ago.", section="Meds",
                            provenance=["audio:preop-interview#s002"]),
                WriterClaim(text="Patient is on aspirin.", section="Meds",
                            provenance=["doc:gp-summary#c001"]),
            ]
        )
        PreOpNoteWriter(chat=FakeChat(out)).write(case)
        return case

    def test_sets_status_from_verifier(self, tmp_path):
        case = self._artifact_case(tmp_path)
        verifier = ClaimVerifier(chat=VerifierFakeChat(["supported", "conflicting"]))
        verifier.verify(case, "note:pre-anesthesia-eval")
        claims = case.get_artifact("note:pre-anesthesia-eval").claims
        assert claims[0].status == ClaimStatus.SUPPORTED
        assert claims[1].status == ClaimStatus.CONFLICTING

    def test_verifier_sees_cited_span_text(self, tmp_path):
        case = self._artifact_case(tmp_path)
        verifier = ClaimVerifier(chat=VerifierFakeChat(["supported", "supported"]))
        verifier.verify(case, "note:pre-anesthesia-eval")
        assert "stopped it six days ago" in verifier.chat.calls[0].lower()

    def test_forward_looking_mode_offers_inference_verdict(self, tmp_path):
        # Anticipated issues are risk projections: the spans can support the
        # risk factors but never entail the outcome, so entailment-style
        # verification would read them all "unsupported" (progress.md).
        case = self._artifact_case(tmp_path)
        verifier = ClaimVerifier(chat=VerifierFakeChat(["inference", "supported"]))
        verifier.verify(case, "note:pre-anesthesia-eval", forward_looking=True)
        claims = case.get_artifact("note:pre-anesthesia-eval").claims
        assert claims[0].status == ClaimStatus.INFERENCE
        assert '"inference"' in verifier.chat.calls[0]

    def test_default_mode_does_not_offer_inference(self, tmp_path):
        case = self._artifact_case(tmp_path)
        verifier = ClaimVerifier(chat=VerifierFakeChat(["supported", "supported"]))
        verifier.verify(case, "note:pre-anesthesia-eval")
        assert '"inference"' not in verifier.chat.calls[0]

    def test_unsupported_claims_are_kept_not_dropped(self, tmp_path):
        case = self._artifact_case(tmp_path)
        ClaimVerifier(chat=VerifierFakeChat(["unsupported", "unsupported"])).verify(
            case, "note:pre-anesthesia-eval"
        )
        claims = case.get_artifact("note:pre-anesthesia-eval").claims
        assert len(claims) == 2
        assert all(c.status == ClaimStatus.UNSUPPORTED for c in claims)
