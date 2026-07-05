"""Evaluation metric tests (spec §6).

Metrics split into pure (coverage, precision, hallucination, extraction F1,
KER) and judge-based set matching (claim recall, gap P/R, distractor leakage)
which take an injected matcher so they run without an LLM in tests.
"""

import pytest

from periop.evals.metrics import (
    PRF,
    claim_recall,
    distractor_leakage,
    extraction_f1,
    gap_analysis_prf,
    hallucinated_claim_rate,
    keyword_error_rate,
    provenance_coverage,
    provenance_precision,
    set_prf,
    speaker_attribution_accuracy,
)
from periop.schemas import ArtifactRecord, Claim, ClaimStatus, Event


def _claim(cid, text, prov, status=ClaimStatus.SUPPORTED):
    return Claim(claim_id=cid, text=text, provenance=prov, status=status)


class TestProvenanceMetrics:
    def test_coverage_fraction_with_citations(self):
        art = ArtifactRecord(artifact_id="n", claims=[
            _claim("c1", "a", ["doc:x#c1"]),
            _claim("c2", "b", []),
        ])
        assert provenance_coverage(art) == 0.5

    def test_coverage_of_empty_artifact_is_one(self):
        assert provenance_coverage(ArtifactRecord(artifact_id="n")) == 1.0

    def test_precision_is_supported_over_cited(self):
        art = ArtifactRecord(artifact_id="n", claims=[
            _claim("c1", "a", ["doc:x#c1"], ClaimStatus.SUPPORTED),
            _claim("c2", "b", ["doc:x#c2"], ClaimStatus.CONFLICTING),
            _claim("c3", "c", [], ClaimStatus.UNVERIFIED),  # excluded: no citation
        ])
        assert provenance_precision(art) == 0.5

    def test_hallucination_rate(self):
        art = ArtifactRecord(artifact_id="n", claims=[
            _claim("c1", "a", ["doc:x#c1"], ClaimStatus.SUPPORTED),
            _claim("c2", "b", [], ClaimStatus.UNVERIFIED),  # no citation → hallucinated
            _claim("c3", "c", ["doc:x#c3"], ClaimStatus.UNSUPPORTED),  # unsupported → hallucinated
        ])
        assert hallucinated_claim_rate(art) == pytest.approx(2 / 3)


class TestExtractionF1:
    def _ev(self, t, cat, val, units=None):
        return Event(t=t, category=cat, value=val, units=units)

    def test_perfect_match(self):
        gold = [self._ev("08:02", "dose", "propofol 120", "mg")]
        pred = [self._ev("08:02", "dose", "propofol 120", "mg")]
        assert extraction_f1(pred, gold).f1 == 1.0

    def test_normalizes_value_and_time_bucket(self):
        # different spacing/case + same 5-min bucket still matches
        gold = [self._ev("08:02", "dose", "Propofol 120", "mg")]
        pred = [self._ev("08:04", "dose", "propofol  120", "mg")]
        assert extraction_f1(pred, gold).f1 == 1.0

    def test_partial(self):
        gold = [self._ev("08:02", "dose", "propofol 120", "mg"),
                self._ev("08:03", "dose", "rocuronium 50", "mg")]
        pred = [self._ev("08:02", "dose", "propofol 120", "mg"),
                self._ev("08:03", "dose", "rocuronium 40", "mg")]  # wrong dose
        prf = extraction_f1(pred, gold)
        assert prf.precision == 0.5
        assert prf.recall == 0.5

    def test_empty_both_is_one(self):
        assert extraction_f1([], []).f1 == 1.0

    def test_tolerates_finer_gold_granularity(self):
        # gold splits agent + dose; the extractor combines them. A combined
        # pred should still match the gold agent event (token-subset).
        gold = [self._ev("08:00", "agent", "propofol"),
                self._ev("08:00", "dose", "120 mg")]
        pred = [self._ev("08:00", "agent", "propofol 120 mg")]
        prf = extraction_f1(pred, gold)
        assert prf.precision == 1.0        # the one pred matched a gold
        assert prf.recall == 0.5           # only the agent gold was covered

    def test_wrong_dose_still_no_match(self):
        gold = [self._ev("08:00", "dose", "rocuronium 50 mg")]
        pred = [self._ev("08:00", "dose", "rocuronium 40 mg")]
        assert extraction_f1(pred, gold).f1 == 0.0


class TestKER:
    def test_all_terms_correct(self):
        ker = keyword_error_rate(
            hypothesis="gave propofol and rocuronium",
            reference="gave propofol and rocuronium",
            lexicon=["propofol", "rocuronium"],
        )
        assert ker == 0.0

    def test_missing_term_counts_as_error(self):
        # reference has both; hypothesis mangled 'rocuronium'
        ker = keyword_error_rate(
            hypothesis="gave propofol and rockuronium",
            reference="gave propofol and rocuronium",
            lexicon=["propofol", "rocuronium"],
        )
        assert ker == 0.5

    def test_no_reference_terms_is_zero(self):
        assert keyword_error_rate("x", "y", lexicon=["propofol"]) == 0.0


class TestSetPRF:
    def test_exact_membership(self):
        prf = set_prf(pred=["a", "b", "c"], gold=["a", "b", "d"],
                      matches=lambda p, g: p == g)
        assert prf.precision == pytest.approx(2 / 3)
        assert prf.recall == pytest.approx(2 / 3)

    def test_matcher_allows_semantic_equivalence(self):
        prf = set_prf(
            pred=["Aspirin stopped"], gold=["Patient discontinued aspirin"],
            matches=lambda p, g: "aspirin" in p.lower() and "aspirin" in g.lower(),
        )
        assert prf.f1 == 1.0

    def test_each_gold_matched_once(self):
        # two preds matching the same single gold → recall counts one gold hit
        prf = set_prf(pred=["a", "a"], gold=["a"], matches=lambda p, g: p == g)
        assert prf.recall == 1.0
        assert prf.precision == 0.5


class TestJudgeBackedMetrics:
    def _match_by_keyword(self, kw):
        return lambda p, g: kw in p.lower() and kw in g.lower()

    def test_claim_recall_uses_matcher(self):
        art = ArtifactRecord(artifact_id="n", claims=[
            _claim("c1", "Aspirin was stopped 6 days ago.", ["doc:x#c1"]),
        ])
        r = claim_recall(art, gold_claims=["Aspirin discontinued preoperatively.",
                                           "Penicillin allergy."],
                         matches=self._match_by_keyword("aspirin"))
        assert r == 0.5  # 1 of 2 gold claims recalled

    def test_gap_analysis_prf(self):
        prf = gap_analysis_prf(
            questions=["Is the patient still taking aspirin?"],
            gold_questions=["Confirm current aspirin use."],
            matches=self._match_by_keyword("aspirin"),
        )
        assert prf.f1 == 1.0

    def test_distractor_leakage_counts_leaked(self):
        art = ArtifactRecord(artifact_id="n", claims=[
            _claim("c1", "History of resolved pneumonia in 2018.", ["doc:x#c1"]),
            _claim("c2", "On metformin.", ["doc:x#c2"]),
        ])
        rate = distractor_leakage(
            [art],
            distractors=["Pneumonia resolved in 2018", "Old wrist fracture"],
            matches=self._match_by_keyword("pneumonia"),
        )
        assert rate == 0.5  # 1 of 2 distractors leaked


class TestSpeakerAttributionAccuracy:
    def test_perfect_attribution(self):
        gold = [
            {"speaker": "PROVIDER", "t0": 0.0, "t1": 2.0},
            {"speaker": "PATIENT", "t0": 2.5, "t1": 4.0},
        ]
        asr = [
            {"speaker": "PROVIDER", "t0": 0.1, "t1": 1.9},
            {"speaker": "PATIENT", "t0": 2.6, "t1": 3.9},
        ]
        assert speaker_attribution_accuracy(asr, gold) == pytest.approx(1.0)

    def test_swapped_speakers_score_zero(self):
        gold = [{"speaker": "PROVIDER", "t0": 0.0, "t1": 2.0}]
        asr = [{"speaker": "PATIENT", "t0": 0.0, "t1": 2.0}]
        assert speaker_attribution_accuracy(asr, gold) == pytest.approx(0.0)

    def test_partial_overlap_weighted_by_time(self):
        gold = [
            {"speaker": "PROVIDER", "t0": 0.0, "t1": 2.0},
            {"speaker": "PATIENT", "t0": 2.0, "t1": 4.0},
        ]
        # one ASR segment spans both gold turns labelled PROVIDER:
        # 2s correct, 2s wrong -> 0.5
        asr = [{"speaker": "PROVIDER", "t0": 0.0, "t1": 4.0}]
        assert speaker_attribution_accuracy(asr, gold) == pytest.approx(0.5)

    def test_empty_inputs(self):
        assert speaker_attribution_accuracy([], []) == 0.0


class TestInferenceStatus:
    """Forward-looking claims verified as 'inference' (risk basis supported)."""

    def test_provenance_precision_counts_inference_as_valid(self):
        artifact = ArtifactRecord(
            artifact_id="note:anticipated-issues",
            claims=[
                _claim("c1", "PONV risk elevated.", ["doc:a#c1"], ClaimStatus.INFERENCE),
                _claim("c2", "Grade 3 view.", ["doc:a#c1"], ClaimStatus.SUPPORTED),
            ],
        )
        assert provenance_precision(artifact) == 1.0

    def test_hallucinated_rate_excludes_inference(self):
        artifact = ArtifactRecord(
            artifact_id="note:anticipated-issues",
            claims=[
                _claim("c1", "PONV risk elevated.", ["doc:a#c1"], ClaimStatus.INFERENCE),
                _claim("c2", "Made up.", [], ClaimStatus.UNVERIFIED),
            ],
        )
        assert hallucinated_claim_rate(artifact) == 0.5
