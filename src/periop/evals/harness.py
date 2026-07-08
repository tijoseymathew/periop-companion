"""Eval harness (spec §6): score a completed Case against its GoldCase.

Bundles the per-metric functions into one CaseReport. The semantic matcher
(claim/question/distractor equivalence) is injected — an LLM judge in
production (evals.judge), a deterministic stub in tests.
"""

from collections.abc import Callable

from pydantic import BaseModel

from periop.agents.handoff import HANDOFF_ID
from periop.agents.preop_note import PREOP_NOTE_ID
from periop.evals import metrics
from periop.schemas import ArtifactRecord, Case
from periop.synthgen.bundle import GoldCase

Matcher = Callable[[str, str], bool]


class CaseReport(BaseModel):
    case_id: str
    # provenance
    preop_provenance_coverage: float
    preop_provenance_precision: float
    handoff_provenance_coverage: float
    # content correctness
    preop_claim_recall: float
    handoff_claim_recall: float
    gap_precision: float
    gap_recall: float
    gap_f1: float
    # safety
    distractor_leakage: float
    handoff_hallucination_rate: float
    # extraction
    extraction_f1: float


def _empty() -> ArtifactRecord:
    return ArtifactRecord(artifact_id="_missing")


def evaluate_case(
    case: Case, gold: GoldCase, matches: Matcher, matches_questions: Matcher | None = None
) -> CaseReport:
    """Score one case. ``matches`` compares claim/distractor statements;
    ``matches_questions`` compares gap-analysis questions (questions need a
    same-issue judgment, not a same-fact one — defaults to ``matches``)."""
    preop = case.get_artifact(PREOP_NOTE_ID) or _empty()
    handoff = case.get_artifact(HANDOFF_ID) or _empty()
    gap = metrics.gap_analysis_prf(
        [q.effective_text for q in case.open_questions],
        gold.questions,
        matches_questions or matches,
    )

    return CaseReport(
        case_id=case.case_id,
        preop_provenance_coverage=metrics.provenance_coverage(preop),
        preop_provenance_precision=metrics.provenance_precision(preop),
        handoff_provenance_coverage=metrics.provenance_coverage(handoff),
        preop_claim_recall=metrics.claim_recall(preop, gold.preop_note_claims, matches),
        handoff_claim_recall=metrics.claim_recall(handoff, gold.handoff_claims, matches),
        gap_precision=gap.precision,
        gap_recall=gap.recall,
        gap_f1=gap.f1,
        distractor_leakage=metrics.distractor_leakage(
            case.artifacts, gold.distractors, matches
        ),
        handoff_hallucination_rate=metrics.hallucinated_claim_rate(handoff),
        extraction_f1=metrics.extraction_f1(case.intraop_events, gold.events).f1,
    )


def aggregate(reports: list[CaseReport]) -> dict[str, float]:
    """Mean of each numeric metric across cases."""
    if not reports:
        return {}
    fields = [f for f, v in reports[0].model_dump().items() if isinstance(v, float)]
    return {
        f: sum(getattr(r, f) for r in reports) / len(reports) for f in fields
    }
