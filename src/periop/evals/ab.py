"""A/B experiments the eval harness enables (spec §6).

extraction_ab: Nemotron Nano-only vs Nano→Super verification for intra-op
event extraction — the model-tiering quality/cost trade-off, measured as
extraction-F1 delta against the gold event log.
"""

from pathlib import Path

from pydantic import BaseModel

from periop.agents.event_extractor import EventExtractor
from periop.evals.metrics import extraction_f1
from periop.schemas import Case, Event
from periop.tools.ingest import transcript_from_voice_notes


class ExtractionAB(BaseModel):
    nano_only_f1: float
    nano_then_super_f1: float

    @property
    def delta(self) -> float:
        return self.nano_then_super_f1 - self.nano_only_f1


def _case_with_notes(notes_path: Path) -> Case:
    case = Case(case_id="ab")
    case.add_source(transcript_from_voice_notes(notes_path, "audio:intraop-notes"))
    return case


def extraction_ab(notes_path, gold_events, fast_chat, reasoning_chat) -> ExtractionAB:
    notes_path = Path(notes_path)

    nano_only = EventExtractor(fast_chat=fast_chat, reasoning_chat=reasoning_chat, verify=False)
    nano_events = nano_only.extract(_case_with_notes(notes_path), "audio:intraop-notes")

    two_pass = EventExtractor(fast_chat=fast_chat, reasoning_chat=reasoning_chat, verify=True)
    verified_events = two_pass.extract(_case_with_notes(notes_path), "audio:intraop-notes")

    to_event = lambda es: [
        Event(t=e.t, category=e.category, value=e.value, units=e.units, provenance=e.provenance)
        for e in es
    ]
    return ExtractionAB(
        nano_only_f1=extraction_f1(to_event(nano_events), gold_events).f1,
        nano_then_super_f1=extraction_f1(to_event(verified_events), gold_events).f1,
    )
