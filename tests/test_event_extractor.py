"""Voice-note transcriber + EventExtractor tests (spec §3.4 steps 1-2).

Voice notes become a single-speaker (PROVIDER) audio source. The extractor
runs a fast first pass then a reasoning verification pass against a strict
event schema, and each event cites the segment it came from.
"""

import pytest

from periop.agents.event_extractor import (
    EventExtractor,
    ExtractedEvent,
    ExtractedEvents,
)
from periop.schemas import Case, EventCategory, SourceType
from periop.tools.ingest import transcript_from_voice_notes


VOICE_NOTES = {
    "notes": [
        {"t": "08:02", "text": "Induction propofol one hundred twenty milligrams."},
        {"t": "08:03", "text": "Rocuronium fifty milligrams, grade one view, tube in."},
        {"t": "08:20", "text": "Phenylephrine one hundred mikes for a pressure dip."},
    ]
}


@pytest.fixture
def case(tmp_path):
    path = tmp_path / "intraop-notes.json"
    import json

    path.write_text(json.dumps(VOICE_NOTES))
    c = Case(case_id="sg-0001")
    c.add_source(transcript_from_voice_notes(path, "audio:intraop-notes"))
    return c


class TestTranscriptFromVoiceNotes:
    def test_single_speaker_segments_with_clock_times(self, case):
        src = case.get_source("audio:intraop-notes")
        assert src.type == SourceType.AUDIO
        assert {s.speaker for s in src.segments} == {"PROVIDER"}
        # dictation clock time is preserved in the segment text
        assert src.segments[0].text == "[08:02] Induction propofol one hundred twenty milligrams."

    def test_segment_ids_stable(self, case):
        src = case.get_source("audio:intraop-notes")
        assert [s.seg_id for s in src.segments] == ["s001", "s002", "s003"]


class TieredChat:
    """Records model tier used per call; returns canned events."""

    def __init__(self, model, first_pass, verified):
        self.model = model
        self.first_pass = first_pass
        self.verified = verified
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append({"model": self.model, "user": user})
        # first call on a fast chat returns first_pass; reasoning returns verified
        return self.first_pass if "nano" in self.model else self.verified


def _events(*specs):
    return ExtractedEvents(
        events=[
            ExtractedEvent(
                t=t, category=cat, value=val, units=units, provenance=[prov]
            )
            for (t, cat, val, units, prov) in specs
        ]
    )


class TestEventExtractor:
    def test_two_pass_returns_verified_events(self, case):
        first = _events(
            ("08:02", "dose", "propofol 120", "mg", "audio:intraop-notes#s001"),
            ("08:03", "dose", "rocuronium 50", "mg", "audio:intraop-notes#s002"),
        )
        verified = _events(
            ("08:02", "dose", "propofol 120", "mg", "audio:intraop-notes#s001"),
            ("08:03", "dose", "rocuronium 50", "mg", "audio:intraop-notes#s002"),
            ("08:03", "airway", "CL grade 1, intubated", None, "audio:intraop-notes#s002"),
        )
        fast = TieredChat("nvidia/nano", first, verified)
        reasoning = TieredChat("nvidia/super", first, verified)
        extractor = EventExtractor(fast_chat=fast, reasoning_chat=reasoning)
        events = extractor.extract(case, "audio:intraop-notes")
        assert len(events) == 3
        assert events[2].category == EventCategory.AIRWAY
        # first pass ran on fast, verification on reasoning
        assert fast.calls and reasoning.calls
        # first-pass events are shown to the verifier
        assert "propofol 120" in reasoning.calls[0]["user"]

    def test_drops_events_citing_unknown_segment(self, case):
        first = _events(("08:02", "dose", "propofol 120", "mg", "audio:intraop-notes#s001"))
        verified = _events(
            ("08:02", "dose", "propofol 120", "mg", "audio:intraop-notes#s001"),
            ("08:99", "dose", "ghost 1", "mg", "audio:intraop-notes#s999"),
        )
        extractor = EventExtractor(
            fast_chat=TieredChat("nvidia/nano", first, verified),
            reasoning_chat=TieredChat("nvidia/super", first, verified),
        )
        events = extractor.extract(case, "audio:intraop-notes")
        assert [e.value for e in events] == ["propofol 120"]

    def test_single_pass_when_verification_disabled(self, case):
        first = _events(("08:02", "dose", "propofol 120", "mg", "audio:intraop-notes#s001"))
        fast = TieredChat("nvidia/nano", first, first)
        reasoning = TieredChat("nvidia/super", first, first)
        extractor = EventExtractor(fast_chat=fast, reasoning_chat=reasoning, verify=False)
        events = extractor.extract(case, "audio:intraop-notes")
        assert len(events) == 1
        assert not reasoning.calls  # verification skipped
