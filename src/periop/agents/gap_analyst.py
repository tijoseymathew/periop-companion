"""GapAnalyst (spec §3.3 step 2): records → prioritized clarification questions.

Each question is tagged with why it matters (missing / stale / conflicting)
and cites the chunk that triggered it. Questions whose citations don't resolve
against the case are dropped — a hallucinated citation is worse than a missing
question here.

The prompt, output schema, and apply step live here; execution is the ADK
generate→validate step built in ``periop.adk.stages``. The ``GapAnalyst``
class is a facade over a single-step ADK run for standalone callers (intake
gap analysis, eval scripts).
"""

from enum import StrEnum
from typing import Any, Mapping

from pydantic import BaseModel, Field, field_validator

from periop.agents.context import normalize_refs, render_sources
from periop.schemas import Case, OpenQuestion, SourceType


class QuestionReason(StrEnum):
    MISSING = "missing"
    STALE = "stale"
    CONFLICTING = "conflicting"


class ClarificationQuestion(BaseModel):
    question: str
    reason: QuestionReason
    provenance: list[str] = Field(
        description="source_id#chunk refs to the triggering record chunk(s)"
    )

    _normalize = field_validator("provenance")(staticmethod(normalize_refs))


class GapQuestions(BaseModel):
    questions: list[ClarificationQuestion]


SYSTEM = (
    "You are a pre-anesthesia gap analyst. You review a patient's prior records "
    "and identify what a provider must clarify before anesthesia. You do not "
    "invent facts and you cite the exact record chunk that triggered each "
    "question."
)

PROMPT = """\
Review these prior-record chunks (each line is prefixed with its citable id):

{sources}

Produce a prioritized list of clarification questions the anesthetist should
ask the patient before surgery. For each question:
- reason = "missing" (important info absent), "stale" (info likely out of
  date), or "conflicting" (chunks disagree, or a well-known interaction/risk
  is implied but unconfirmed).
- provenance = the id(s) of the chunk(s) that triggered it, exactly as shown
  in brackets above (e.g. "doc:gp-summary#c001"). Every question must cite at
  least one real chunk id from the list.
Prioritize items that affect anesthetic safety (allergies, anticoagulants,
airway history, prior anesthetic complications, cardiorespiratory disease).
"""


def prompt(case: Case, state: Mapping[str, Any] | None = None) -> str:
    return PROMPT.format(sources=render_sources(case, types=(SourceType.DOCUMENT,)))


def apply(
    case: Case, result: GapQuestions, state: Mapping[str, Any] | None = None
) -> tuple[str, dict[str, Any]]:
    """Keep only questions whose citations resolve; store them on the case."""
    from periop.adk.runtime import case_delta

    valid = [q for q in result.questions if _citations_resolve(case, q)]
    case.open_questions = [
        OpenQuestion(question=q.question, reason=q.reason, provenance=q.provenance)
        for q in valid
    ]
    return f"{len(valid)} questions", case_delta(case)


def _citations_resolve(case: Case, q: ClarificationQuestion) -> bool:
    if not q.provenance:
        return False
    try:
        for ref in q.provenance:
            case.resolve(ref)
    except (KeyError, ValueError):
        return False
    return True


class GapAnalyst:
    """Facade: run the ADK gap-analysis step standalone over one case."""

    def __init__(self, chat) -> None:
        self.chat = chat

    def analyze(self, case: Case) -> list[ClarificationQuestion]:
        from periop.adk.runtime import run_agent, sync_case
        from periop.adk.stages import gap_analyst_step

        result, _ = run_agent(gap_analyst_step(self.chat, skip_when_present=False), case)
        sync_case(case, result)
        return [
            ClarificationQuestion(
                question=q.question,
                reason=QuestionReason(q.reason),
                provenance=[str(r) for r in q.provenance],
            )
            for q in case.open_questions
        ]
