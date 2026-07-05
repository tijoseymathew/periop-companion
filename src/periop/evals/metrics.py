"""Evaluation metrics (spec §6).

Pure metrics (coverage, precision, hallucination, extraction F1, KER) compute
directly from artifacts/events. Semantic set-matching metrics (claim recall,
gap-analysis P/R, distractor leakage) take an injected ``matches(pred, gold)``
predicate — an LLM judge in production, a keyword stub in tests — so the metric
logic is deterministic and testable.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from periop.schemas import ArtifactRecord, ClaimStatus, Event

Matcher = Callable[[str, str], bool]


@dataclass(frozen=True)
class PRF:
    precision: float
    recall: float

    @property
    def f1(self) -> float:
        if self.precision + self.recall == 0:
            return 0.0
        return 2 * self.precision * self.recall / (self.precision + self.recall)


# --------------------------------------------------------------- provenance


def provenance_coverage(artifact: ArtifactRecord) -> float:
    """Fraction of claims carrying ≥1 citation (spec: provenance recall)."""
    if not artifact.claims:
        return 1.0
    cited = sum(1 for c in artifact.claims if c.provenance)
    return cited / len(artifact.claims)


def provenance_precision(artifact: ArtifactRecord) -> float:
    """Of cited claims, fraction the verifier marked supported."""
    cited = [c for c in artifact.claims if c.provenance]
    if not cited:
        return 1.0
    supported = sum(1 for c in cited if c.status == ClaimStatus.SUPPORTED)
    return supported / len(cited)


def hallucinated_claim_rate(artifact: ArtifactRecord) -> float:
    """Fraction of claims not entailed by any source: uncited, or verified
    unsupported/conflicting."""
    if not artifact.claims:
        return 0.0
    bad = sum(
        1
        for c in artifact.claims
        if not c.provenance
        or c.status in (ClaimStatus.UNSUPPORTED, ClaimStatus.CONFLICTING)
    )
    return bad / len(artifact.claims)


# --------------------------------------------------------------- extraction


def _norm_value(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _time_bucket(t: str, minutes: int = 5) -> str:
    m = re.match(r"^(\d{1,2}):(\d{2})$", t.strip())
    if not m:
        return t.strip()
    total = int(m.group(1)) * 60 + int(m.group(2))
    return str(total // minutes)


def _value_tokens(value: str) -> frozenset[str]:
    return frozenset(_norm_value(value).split())


def _events_match(a: Event, b: Event) -> bool:
    """Same category, same 5-min bucket, and one value's tokens contain the
    other's — so a combined 'propofol 120' matches a gold 'propofol' or a gold
    'propofol 120', but a wrong dose (40 vs 50) does not."""
    if a.category is not b.category or _time_bucket(a.t) != _time_bucket(b.t):
        return False
    ta, tb = _value_tokens(a.value), _value_tokens(b.value)
    return ta <= tb or tb <= ta


def extraction_f1(pred: Sequence[Event], gold: Sequence[Event]) -> PRF:
    """Structured event F1 on (category, value, 5-min bucket) with token-subset
    value matching, so gold's finer agent/dose split still scores. Greedy
    one-to-one pairing (each pred matches at most one gold)."""
    if not pred and not gold:
        return PRF(1.0, 1.0)
    remaining = list(gold)
    tp = 0
    for p in pred:
        for gi, g in enumerate(remaining):
            if _events_match(p, g):
                remaining.pop(gi)
                tp += 1
                break
    precision = tp / len(pred) if pred else (1.0 if not gold else 0.0)
    recall = (len(gold) - len(remaining)) / len(gold) if gold else (1.0 if not pred else 0.0)
    return PRF(precision, recall)


# ---------------------------------------------------------------------- KER


def keyword_error_rate(hypothesis: str, reference: str, lexicon: Sequence[str]) -> float:
    """Fraction of lexicon terms present in the reference that the ASR
    hypothesis got wrong (spec §6: clinical-term KER)."""
    hyp = hypothesis.lower()
    ref = reference.lower()
    ref_terms = [term for term in lexicon if term.lower() in ref]
    if not ref_terms:
        return 0.0
    errors = sum(1 for term in ref_terms if term.lower() not in hyp)
    return errors / len(ref_terms)


# ------------------------------------------------------- semantic set metrics


def set_prf(pred: Sequence[str], gold: Sequence[str], matches: Matcher) -> PRF:
    """P/R/F over two string sets under an arbitrary ``matches`` predicate.

    Each gold item can be matched by at most one pred (and vice versa) via a
    greedy pairing, so duplicated preds don't inflate recall.
    """
    matched_gold: set[int] = set()
    tp = 0
    for p in pred:
        for gi, g in enumerate(gold):
            if gi in matched_gold:
                continue
            if matches(p, g):
                matched_gold.add(gi)
                tp += 1
                break
    precision = tp / len(pred) if pred else (1.0 if not gold else 0.0)
    recall = len(matched_gold) / len(gold) if gold else (1.0 if not pred else 0.0)
    return PRF(precision, recall)


def claim_recall(artifact: ArtifactRecord, gold_claims: Sequence[str], matches: Matcher) -> float:
    """Fraction of gold claims present in the generated artifact."""
    return set_prf([c.text for c in artifact.claims], gold_claims, matches).recall


def gap_analysis_prf(questions: Sequence[str], gold_questions: Sequence[str], matches: Matcher) -> PRF:
    return set_prf(questions, gold_questions, matches)


def distractor_leakage(
    artifacts: Sequence[ArtifactRecord], distractors: Sequence[str], matches: Matcher
) -> float:
    """Fraction of gold distractors that leaked into any generated claim."""
    if not distractors:
        return 0.0
    claim_texts = [c.text for a in artifacts for c in a.claims]
    leaked = sum(1 for d in distractors if any(matches(text, d) for text in claim_texts))
    return leaked / len(distractors)
