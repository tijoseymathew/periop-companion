"""CaseDesigner tests (spec §5).

The designer turns a persona into a CaseDesign: surgery + comorbidity bundle
+ medication list + one deliberate documentation defect + distractor history.
LLM is stubbed — live generation happens in scripts/generate_cases.py.
"""

import pytest
from pydantic import ValidationError

from periop.synthgen.case_designer import CaseDesigner, design_case_id
from periop.synthgen.design import (
    CaseDesign,
    DefectKind,
    DocumentationDefect,
    Distractor,
    Medication,
)
from tests.test_personas import make_persona


def make_design(case_id: str = "sg-0001") -> CaseDesign:
    return CaseDesign(
        case_id=case_id,
        persona_uuid="u1",
        surgery="Laparoscopic cholecystectomy",
        urgency="elective",
        anesthesia_plan="General anesthesia with endotracheal intubation",
        asa_ps=2,
        comorbidities=["Type 2 diabetes mellitus", "Hypertension"],
        medications=[
            Medication(name="Metformin", dose="500 mg", frequency="BD", active=True),
            Medication(name="Aspirin", dose="100 mg", frequency="OD", active=False),
        ],
        allergies=["Penicillin (rash)"],
        defect=DocumentationDefect(
            kind=DefectKind.RECORD_PATIENT_CONFLICT,
            record_states="GP med list shows aspirin 100 mg OD as current.",
            truth="Patient stopped aspirin 6 days ago on surgeon's advice.",
            gold_question="Is the patient still taking aspirin, and when was the last dose?",
        ),
        distractors=[
            Distractor(
                description="Community-acquired pneumonia in 2015, fully resolved.",
                why_irrelevant="Resolved a decade ago; no residual respiratory disease.",
            )
        ],
    )


class TestCaseDesignSchema:
    def test_valid_design_round_trips(self):
        design = make_design()
        assert CaseDesign.model_validate_json(design.model_dump_json()) == design

    def test_defect_kind_is_constrained(self):
        with pytest.raises(ValidationError):
            DocumentationDefect(
                kind="typo", record_states="x", truth="y", gold_question="z"
            )

    def test_asa_ps_bounds(self):
        with pytest.raises(ValidationError):
            make_design().model_copy(update={"asa_ps": 7}).model_dump()
            CaseDesign.model_validate(make_design().model_dump() | {"asa_ps": 7})


class TestDesignCaseId:
    def test_sequential_ids(self):
        assert design_case_id(1) == "sg-0001"
        assert design_case_id(42) == "sg-0042"


class FakeChat:
    def __init__(self, design: CaseDesign):
        self.design = design
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append({"user": user, "schema": schema, "system": system})
        return self.design


class TestCaseDesigner:
    def test_designs_case_from_persona(self):
        persona = make_persona("u1", 63, "Female")
        fake = FakeChat(make_design())
        designer = CaseDesigner(chat=fake)
        design = designer.design(persona, index=1)
        assert design.case_id == "sg-0001"
        assert design.persona_uuid == "u1"

    def test_prompt_carries_persona_and_requirements(self):
        persona = make_persona("u1", 63, "Female")
        fake = FakeChat(make_design())
        CaseDesigner(chat=fake).design(persona, index=1)
        prompt = fake.calls[0]["user"]
        assert "63" in prompt
        assert "Female" in prompt
        assert persona.persona in prompt
        # the three defect kinds must be offered
        for kind in ("missing_allergy", "stale_med_list", "record_patient_conflict"):
            assert kind in prompt
        assert fake.calls[0]["schema"] is CaseDesign

    def test_overrides_ids_even_if_model_invents_them(self):
        persona = make_persona("u9", 40, "Male")
        fake = FakeChat(make_design(case_id="sg-9999"))
        design = CaseDesigner(chat=fake).design(persona, index=7)
        assert design.case_id == "sg-0007"
        assert design.persona_uuid == "u9"
