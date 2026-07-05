"""Prior-records pack: deterministic markdown rendering of the RecordView.

Templates (not LLM) so chunk ids are stable and the defect placement is
exact: records show the flawed view, distractors included, truth withheld.
"""

from periop.synthgen.design import CaseDesign
from periop.synthgen.personas import Persona


def _med_lines(design: CaseDesign) -> str:
    return "\n\n".join(
        f"{m.name} {m.dose} {m.frequency}." for m in design.records.medications
    )


def _allergy_lines(design: CaseDesign) -> str:
    if not design.records.allergies:
        return "No known drug allergies recorded."
    return "\n\n".join(design.records.allergies)


def render_gp_summary(design: CaseDesign, persona: Persona) -> str:
    history = "\n\n".join(design.records.past_history)
    return f"""\
# GP Summary

## Patient

{persona.age}-year-old {persona.sex.lower()}, {persona.occupation}, resident of {persona.planning_area}, Singapore.

## Medications

{_med_lines(design)}

## Allergies

{_allergy_lines(design)}

## Past History

{history}
"""


def render_med_list(design: CaseDesign) -> str:
    return f"""\
# Medication List (Polyclinic Refill Record)

## Current Medications

{_med_lines(design)}
"""


def render_prior_anesthetic_record(design: CaseDesign) -> str:
    return f"""\
# Prior Anesthetic Record

## Summary

{design.records.prior_anesthesia}
"""


def render_op_plan(design: CaseDesign) -> str:
    return f"""\
# Operative Plan

## Procedure

{design.surgery} ({design.urgency}).

## Anesthesia

{design.anesthesia_plan}
"""


def render_records_pack(design: CaseDesign, persona: Persona) -> dict[str, str]:
    """All prior-record documents for a case, keyed by source id."""
    pack = {
        "doc:gp-summary": render_gp_summary(design, persona),
        "doc:med-list": render_med_list(design),
        "doc:op-plan": render_op_plan(design),
    }
    if design.records.prior_anesthesia:
        pack["doc:prior-anesthetic-record"] = render_prior_anesthetic_record(design)
    return pack
