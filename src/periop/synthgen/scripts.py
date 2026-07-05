"""ScriptWriter: CaseDesign → diarized interview scripts, intra-op voice
notes with gold events, and gold claims (spec §5).

The pre-op interview is where the planted defect surfaces: generation is
re-checked (keyword overlap with defect.truth in PATIENT/CAREGIVER turns)
and retried once, because a case whose interview never reveals the truth is
unusable for evaluating the GapAnalyst.
"""

import re
from typing import Literal

from pydantic import BaseModel, Field

from periop.schemas import Event
from periop.synthgen.design import CaseDesign

Speaker = Literal["PROVIDER", "PATIENT", "CAREGIVER"]


class ScriptTurn(BaseModel):
    speaker: Speaker
    text: str


class InterviewScript(BaseModel):
    turns: list[ScriptTurn] = Field(min_length=2)


class VoiceNote(BaseModel):
    t: str = Field(description="Clock time HH:MM")
    text: str


class IntraOpBundle(BaseModel):
    notes: list[VoiceNote] = Field(min_length=3, description="Anesthetist voice notes")
    events: list[Event] = Field(
        min_length=3, description="Gold structured events consistent with the notes"
    )


class GoldArtifacts(BaseModel):
    preop_note_claims: list[str] = Field(min_length=3)
    handoff_claims: list[str] = Field(min_length=3)


_STOP = {"patient", "their", "about", "after", "before", "since", "advice",
         "allergy", "allergic", "history", "taking", "stopped", "medication"}


def _content_words(text: str) -> set[str]:
    # 4+ letters, truncated to a 5-char stem so morphological variants
    # ("allergy"/"allergic", "stop"/"stopped") still line up.
    return {
        w[:5] for w in re.findall(r"[a-z]{4,}", text.lower()) if w not in _STOP
    }


def reveals_truth(script: InterviewScript, truth: str) -> bool:
    """Do the non-provider turns carry the defect truth (keyword overlap)?

    Generic stop words (allergy, medication, …) are dropped so the check keys
    on the *distinctive* facts (the allergen, the drug, the timing). At least
    half of those, and always ≥1, must appear in what the patient/caregiver
    actually says.
    """
    words = _content_words(truth)
    if not words:
        return True
    spoken = _content_words(
        " ".join(t.text for t in script.turns if t.speaker != "PROVIDER")
    )
    needed = max(1, len(words) // 2)
    return len(words & spoken) >= needed


PREOP_PROMPT = """\
Write a pre-anesthesia interview script for this synthetic Singapore case.

Surgery: {surgery} ({urgency}); plan: {anesthesia_plan}.
True medications: {medications}
True allergies: {allergies}
Comorbidities: {comorbidities}

CRITICAL: the prior records are flawed. Records say: "{record_states}".
The truth — which the PATIENT must reveal naturally during this interview —
is: "{truth}". The provider should ask about it (e.g. "{gold_question}") and
the patient's answer must contain the key facts.

Style: natural colloquial Singapore-English register for the patient
(occasional "lah"/"ah" is fine, don't overdo it); professional but warm
provider. Cover the standard pre-op ground: history of presenting condition,
medications, allergies, NPO status, prior anesthetics, functional status.
10-20 turns, alternating naturally. Speakers: PROVIDER, PATIENT (CAREGIVER
only if it genuinely fits).
"""

INTRAOP_PROMPT = """\
Write the anesthetist's intra-op voice notes for this synthetic case, plus
the gold structured event log they encode.

Surgery: {surgery}; plan: {anesthesia_plan}. Patient: ASA {asa_ps},
comorbidities: {comorbidities}.

Voice notes: short spoken fragments as an anesthetist would dictate hands-free
("induction propofol one hundred twenty milligrams", "tube in, grade one
view"), each with a clock time (HH:MM), covering induction agents & doses,
airway management, lines, fluids, and 1-2 notable hemodynamic events with
treatment. Doses in WORDS in the notes (speech), numerals in the events.

Events: one entry per clinical fact with t matching the note it came from,
category one of agent|dose|airway|line|fluid|event, value, units where
applicable. Events must be exactly consistent with the notes — no extra, no
missing.
"""

POSTOP_PROMPT = """\
Write a short post-operative (PACU) interview script for this synthetic case:
provider checking on the patient after {surgery} under {anesthesia_plan}.
Cover: pain score, nausea/PONV, airway/breathing comfort, recall/awareness,
and any issue plausibly linked to ASA {asa_ps} comorbidities:
{comorbidities}. Natural Singapore-English register for the patient. 6-12
turns. Speakers: PROVIDER, PATIENT.
"""

GOLD_PROMPT = """\
Write the GOLD claims for this synthetic case's documentation.

Case: {surgery} ({urgency}), {anesthesia_plan}, ASA {asa_ps}.
True medications: {medications}
True allergies: {allergies}
Comorbidities: {comorbidities}
Defect truth (MUST be captured as a claim): {truth}

1. preop_note_claims: atomic factual claims a correct pre-anesthesia
   evaluation note must contain (history, meds with status, allergies,
   ASA-PS with reason, airway/plan). One fact per claim.
2. handoff_claims: the subset/compression a correct PACU handoff must carry
   (key history, intra-op course expectations, anticipated issues).

Do NOT include any distractor item: {distractors}
"""


class ScriptWriter:
    def __init__(self, chat) -> None:
        self.chat = chat

    def _design_fields(self, design: CaseDesign) -> dict:
        return {
            "surgery": design.surgery,
            "urgency": design.urgency,
            "anesthesia_plan": design.anesthesia_plan,
            "asa_ps": design.asa_ps,
            "comorbidities": "; ".join(design.comorbidities),
            "medications": "; ".join(
                f"{m.name} {m.dose} {m.frequency}{'' if m.active else ' (stopped)'}"
                for m in design.medications
            ),
            "allergies": "; ".join(design.allergies) or "none",
            "distractors": "; ".join(d.description for d in design.distractors),
        }

    def preop_interview(self, design: CaseDesign) -> InterviewScript:
        prompt = PREOP_PROMPT.format(
            **self._design_fields(design),
            record_states=design.defect.record_states,
            truth=design.defect.truth,
            gold_question=design.defect.gold_question,
        )
        script = self.chat.complete_structured(prompt, schema=InterviewScript)
        if not reveals_truth(script, design.defect.truth):
            script = self.chat.complete_structured(prompt, schema=InterviewScript)
        if not reveals_truth(script, design.defect.truth):
            raise ValueError(
                f"case {design.case_id}: interview script fails to reveal the "
                f"defect truth after retry: {design.defect.truth!r}"
            )
        return script

    def intraop(self, design: CaseDesign) -> IntraOpBundle:
        return self.chat.complete_structured(
            INTRAOP_PROMPT.format(**self._design_fields(design)), schema=IntraOpBundle
        )

    def postop_interview(self, design: CaseDesign) -> InterviewScript:
        return self.chat.complete_structured(
            POSTOP_PROMPT.format(**self._design_fields(design)), schema=InterviewScript
        )

    def gold_artifacts(self, design: CaseDesign) -> GoldArtifacts:
        return self.chat.complete_structured(
            GOLD_PROMPT.format(**self._design_fields(design), truth=design.defect.truth),
            schema=GoldArtifacts,
        )
