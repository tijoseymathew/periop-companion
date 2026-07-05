"""Scripted-encounter generation tests (spec §5).

The ScriptWriter produces diarized gold interview scripts (pre-op, post-op),
intra-op voice notes with a consistent gold event log, and gold claims for
the notes/handoff. The pre-op script must reveal the defect truth — that is
the whole point of the planted defect.
"""

import pytest
from pydantic import ValidationError

from periop.schemas import EventCategory
from periop.synthgen.scripts import (
    GoldArtifacts,
    InterviewScript,
    IntraOpBundle,
    ScriptTurn,
    ScriptWriter,
    VoiceNote,
)
from tests.test_case_designer import make_design


def make_interview(reveal: str = "I stopped the aspirin last Tuesday, lah.") -> InterviewScript:
    return InterviewScript(
        turns=[
            ScriptTurn(speaker="PROVIDER", text="Are you still taking aspirin?"),
            ScriptTurn(speaker="PATIENT", text=reveal),
        ]
    )


def make_intraop() -> IntraOpBundle:
    return IntraOpBundle(
        notes=[
            VoiceNote(t="08:02", text="Induction propofol one hundred twenty milligrams."),
            VoiceNote(t="08:03", text="Rocuronium fifty milligrams, grade one view, tube in."),
            VoiceNote(t="08:20", text="Phenylephrine one hundred mikes for pressure dip."),
        ],
        events=[
            {"t": "08:02", "category": "dose", "value": "propofol 120", "units": "mg"},
            {"t": "08:03", "category": "dose", "value": "rocuronium 50", "units": "mg"},
            {"t": "08:03", "category": "airway", "value": "CL grade 1, intubated"},
        ],
    )


def make_gold() -> GoldArtifacts:
    return GoldArtifacts(
        preop_note_claims=[
            "Patient stopped aspirin 6 days prior to surgery.",
            "Type 2 diabetes mellitus on metformin 500 mg BD.",
            "Allergic to penicillin (rash).",
        ],
        handoff_claims=[
            "Aspirin held since 6 days pre-op.",
            "Diabetic — monitor glucose in PACU.",
            "Penicillin allergy.",
        ],
    )


class TestScriptSchemas:
    def test_speaker_roles_constrained(self):
        with pytest.raises(ValidationError):
            ScriptTurn(speaker="NARRATOR", text="hi")

    def test_intraop_events_use_event_schema(self):
        bundle = make_intraop()
        assert bundle.events[0].category == EventCategory.DOSE


class FakeChat:
    """Returns canned structured outputs keyed by requested schema."""

    def __init__(self, by_schema: dict):
        self.by_schema = by_schema
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append({"user": user, "schema": schema})
        return self.by_schema[schema]


@pytest.fixture
def writer():
    chat = FakeChat(
        {
            InterviewScript: make_interview(),
            IntraOpBundle: make_intraop(),
            GoldArtifacts: make_gold(),
        }
    )
    return ScriptWriter(chat=chat), chat


class TestScriptWriter:
    def test_preop_interview_prompt_demands_defect_reveal(self, writer):
        w, chat = writer
        script = w.preop_interview(make_design())
        assert script.turns[1].speaker == "PATIENT"
        prompt = chat.calls[0]["user"]
        assert make_design().defect.truth in prompt
        assert "Singapore" in prompt

    def test_preop_interview_rejects_script_missing_reveal(self, writer):
        # A script that never reveals the truth is regenerated once, then errors.
        design = make_design()
        chat = FakeChat({InterviewScript: make_interview(reveal="Yes still taking it.")})
        w = ScriptWriter(chat=chat)
        with pytest.raises(ValueError, match="reveal"):
            w.preop_interview(design)
        assert len(chat.calls) == 2  # one retry

    def test_intraop_bundle_covers_notes_and_events(self, writer):
        w, chat = writer
        bundle = w.intraop(make_design())
        assert len(bundle.notes) == 3
        assert len(bundle.events) == 3
        assert make_design().surgery in chat.calls[0]["user"]

    def test_postop_interview(self, writer):
        w, chat = writer
        script = w.postop_interview(make_design())
        assert script.turns
        assert "post" in chat.calls[0]["user"].lower()

    def test_gold_artifacts_mention_defect_truth_requirement(self, writer):
        w, chat = writer
        gold = w.gold_artifacts(make_design())
        assert gold.preop_note_claims
        assert make_design().defect.truth in chat.calls[0]["user"]
