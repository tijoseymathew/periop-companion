"""Eval harness tests (spec §6): score a completed Case against its GoldCase.

The judge (semantic matcher) is injected so scoring is deterministic in tests.
"""

import pytest

from periop.agents.handoff import HANDOFF_ID
from periop.agents.issue_anticipator import ANTICIPATED_ISSUES_ID
from periop.agents.intraop_record import INTRAOP_RECORD_ID
from periop.agents.preop_note import PREOP_NOTE_ID
from periop.evals.harness import CaseReport, evaluate_case
from periop.schemas import ArtifactRecord, Case, Claim, ClaimStatus, Event
from periop.synthgen.bundle import GoldCase


def _claim(cid, text, status=ClaimStatus.SUPPORTED):
    return Claim(claim_id=cid, text=text, provenance=["doc:x#c1"], status=status)


@pytest.fixture
def case():
    c = Case(case_id="sg-0001", open_questions=["Is the patient still on aspirin?"])
    c.intraop_events = [Event(t="08:02", category="dose", value="propofol 120", units="mg")]
    c.artifacts = [
        ArtifactRecord(artifact_id=PREOP_NOTE_ID, claims=[
            _claim("c1", "Aspirin stopped 6 days pre-op."),
            _claim("c2", "History of resolved pneumonia 2018."),  # distractor leak
        ]),
        ArtifactRecord(artifact_id=INTRAOP_RECORD_ID, claims=[_claim("c1", "Propofol 120 mg.")]),
        ArtifactRecord(artifact_id=ANTICIPATED_ISSUES_ID, claims=[_claim("c1", "PONV watch.")]),
        ArtifactRecord(artifact_id=HANDOFF_ID, claims=[_claim("c1", "Aspirin held.")]),
    ]
    return c


@pytest.fixture
def gold():
    return GoldCase(
        questions=["Confirm current aspirin use."],
        events=[Event(t="08:02", category="dose", value="propofol 120", units="mg")],
        preop_note_claims=["Aspirin discontinued preoperatively.", "Penicillin allergy."],
        handoff_claims=["Aspirin held perioperatively."],
        distractors=["Pneumonia resolved in 2018", "Old wrist fracture"],
    )


def keyword_matcher(p, g):
    """Match if the two strings share a salient content word."""
    import re

    stop = {"patient", "still", "current", "resolved", "history"}

    def words(s):
        return {w for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 3 and w not in stop}

    return bool(words(p) & words(g))


class TestEvaluateCase:
    def test_produces_full_report(self, case, gold):
        report = evaluate_case(case, gold, matches=keyword_matcher)
        assert isinstance(report, CaseReport)
        assert report.case_id == "sg-0001"

    def test_extraction_f1_perfect(self, case, gold):
        report = evaluate_case(case, gold, matches=keyword_matcher)
        assert report.extraction_f1 == 1.0

    def test_gap_analysis_matches_on_aspirin(self, case, gold):
        report = evaluate_case(case, gold, matches=keyword_matcher)
        assert report.gap_f1 == 1.0

    def test_gap_analysis_uses_question_matcher_when_given(self, case, gold):
        # fact matcher says nothing matches; the question matcher must be the
        # one consulted for the gap metric — and only for the gap metric
        report = evaluate_case(
            case, gold,
            matches=lambda p, g: False,
            matches_questions=keyword_matcher,
        )
        assert report.gap_f1 == 1.0
        assert report.preop_claim_recall == 0.0

    def test_claim_recall_partial(self, case, gold):
        report = evaluate_case(case, gold, matches=keyword_matcher)
        # "aspirin" gold recalled, "penicillin" not → 0.5
        assert report.preop_claim_recall == 0.5

    def test_distractor_leakage_detected(self, case, gold):
        report = evaluate_case(case, gold, matches=keyword_matcher)
        assert report.distractor_leakage == 0.5  # pneumonia leaked, fracture not

    def test_handoff_hallucination_zero_when_all_cited_supported(self, case, gold):
        report = evaluate_case(case, gold, matches=keyword_matcher)
        assert report.handoff_hallucination_rate == 0.0

    def test_report_serializes_to_dict(self, case, gold):
        report = evaluate_case(case, gold, matches=keyword_matcher)
        d = report.model_dump()
        assert set(d) >= {
            "case_id", "extraction_f1", "gap_f1", "preop_claim_recall",
            "distractor_leakage", "handoff_hallucination_rate",
            "preop_provenance_coverage", "handoff_provenance_coverage",
        }
