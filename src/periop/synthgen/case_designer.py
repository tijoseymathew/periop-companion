"""CaseDesigner: persona → CaseDesign via the reasoning LLM (spec §5)."""

from periop.synthgen.design import CaseDesign, DefectKind
from periop.synthgen.personas import Persona

SYSTEM = (
    "You design synthetic (entirely fictional) peri-operative cases for testing "
    "an anesthesia documentation assistant. Cases must be clinically plausible "
    "for the given patient and grounded in a Singapore healthcare context "
    "(polyclinic/GP referrals, restructured hospitals, local medication brands "
    "are fine but use generic drug names). This is synthetic test data — no "
    "real patients."
)

PROMPT = """\
Design one peri-operative case for this synthetic Singapore patient:

- Age: {age}, Sex: {sex}
- Occupation: {occupation} ({planning_area})
- Persona: {persona}
- Background: {cultural_background}

Requirements:
1. Choose a surgery plausible for this demographic, and an anesthesia plan.
2. Comorbidity bundle and medication list consistent with age/history.
   Include at least one discontinued medication (active=false).
3. Exactly ONE deliberate documentation defect, kind one of:
   - missing_allergy: a real allergy absent from the records
   - stale_med_list: records list a medication regimen that has since changed
   - record_patient_conflict: records and patient's account directly disagree
   Fill record_states (what the flawed records say), truth (what the patient
   will reveal in interview), and gold_question (what a good pre-op gap
   analysis must ask to surface it).
4. 2-3 distractors: resolved or irrelevant history items that will appear in
   the records but must NOT appear in a good note (e.g., pneumonia cleared
   years ago, remote fracture, discontinued meds for a resolved condition).
5. ASA-PS consistent with the comorbidity burden.

Set case_id to "{case_id}" and persona_uuid to "{persona_uuid}".
"""


def design_case_id(index: int) -> str:
    return f"sg-{index:04d}"


class CaseDesigner:
    def __init__(self, chat) -> None:
        self.chat = chat

    def design(self, persona: Persona, index: int) -> CaseDesign:
        case_id = design_case_id(index)
        prompt = PROMPT.format(
            age=persona.age,
            sex=persona.sex,
            occupation=persona.occupation,
            planning_area=persona.planning_area,
            persona=persona.persona,
            cultural_background=persona.cultural_background,
            case_id=case_id,
            persona_uuid=persona.uuid,
        )
        assert all(k.value in prompt for k in DefectKind)
        design = self.chat.complete_structured(prompt, schema=CaseDesign, system=SYSTEM)
        # ids are assigned by us, not the model
        return design.model_copy(update={"case_id": case_id, "persona_uuid": persona.uuid})
