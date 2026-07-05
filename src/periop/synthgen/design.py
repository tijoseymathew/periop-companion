"""CaseDesign: the structured blueprint for one synthetic case (spec §5).

The deliberate documentation defect is what makes the GapAnalyst evaluable
(gold = "these questions should have been asked"); distractors are what make
relevance judgment evaluable (they must NOT surface in notes/handoffs).
"""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class DefectKind(StrEnum):
    MISSING_ALLERGY = "missing_allergy"
    STALE_MED_LIST = "stale_med_list"
    RECORD_PATIENT_CONFLICT = "record_patient_conflict"


class Medication(BaseModel):
    name: str
    dose: str
    frequency: str
    active: bool = True


class DocumentationDefect(BaseModel):
    kind: DefectKind
    record_states: str = Field(description="What the (flawed) prior records say")
    truth: str = Field(description="The ground truth, revealed only in the interview")
    gold_question: str = Field(
        description="The clarification question a good gap analysis must ask"
    )


class Distractor(BaseModel):
    description: str = Field(description="Resolved/irrelevant history item in the records")
    why_irrelevant: str


class CaseDesign(BaseModel):
    case_id: str
    persona_uuid: str
    surgery: str
    urgency: Literal["elective", "emergency"]
    anesthesia_plan: str
    asa_ps: int = Field(ge=1, le=5)
    comorbidities: list[str]
    medications: list[Medication]
    allergies: list[str] = Field(default_factory=list)
    defect: DocumentationDefect
    distractors: list[Distractor] = Field(min_length=1)
