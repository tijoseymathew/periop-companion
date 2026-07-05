"""GapAnalyst (spec §3.3 step 2): records → prioritized clarification questions.

Each question is tagged with why it matters (missing / stale / conflicting)
and cites the chunk that triggered it. Questions whose citations don't resolve
against the case are dropped — a hallucinated citation is worse than a missing
question here.
"""

from enum import StrEnum

from pydantic import BaseModel, Field

from periop.agents.context import render_sources
from periop.schemas import Case, SourceType


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


class GapAnalyst:
    def __init__(self, chat) -> None:
        self.chat = chat

    def analyze(self, case: Case) -> list[ClarificationQuestion]:
        sources = render_sources(case, types=(SourceType.DOCUMENT,))
        result = self.chat.complete_structured(
            PROMPT.format(sources=sources), schema=GapQuestions, system=SYSTEM
        )
        valid = [q for q in result.questions if self._citations_resolve(case, q)]
        case.open_questions = [q.question for q in valid]
        return valid

    @staticmethod
    def _citations_resolve(case: Case, q: ClarificationQuestion) -> bool:
        if not q.provenance:
            return False
        try:
            for ref in q.provenance:
                case.resolve(ref)
        except (KeyError, ValueError):
            return False
        return True
