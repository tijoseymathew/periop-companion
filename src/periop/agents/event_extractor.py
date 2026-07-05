"""EventExtractor (spec §3.4 step 2): voice-note transcript → structured events.

Two-tier per spec §8: a fast Nemotron Nano first pass proposes events cheaply,
then a Nemotron Super pass verifies/corrects them against the transcript and a
strict schema. Every event cites the segment it came from; events citing
unknown segments are dropped. The A/B (nano-only vs nano→super) is exposed via
the `verify` flag for the eval harness.
"""

from pydantic import BaseModel, Field

from periop.agents.context import render_sources
from periop.schemas import Case, EventCategory, SourceType


class ExtractedEvent(BaseModel):
    t: str = Field(description="Clock time HH:MM from the voice note")
    category: EventCategory
    value: str = Field(description="e.g. 'propofol 120', 'CL grade 1, intubated'")
    units: str | None = None
    provenance: list[str] = Field(description="audio segment id(s) this came from")


class ExtractedEvents(BaseModel):
    events: list[ExtractedEvent]


SYSTEM = (
    "You extract structured intra-operative events from an anesthetist's voice "
    "notes. Spoken number words map to numerals ('one hundred twenty' → 120). "
    "You never invent events; every event cites the segment it came from."
)

FIRST_PASS = """\
Extract every clinical event from these intra-op voice-note segments (each
line is prefixed with its citable id):

{sources}

For each event: t (clock time HH:MM as spoken), category (agent|dose|airway|
line|fluid|event), value (drug + numeral dose, or the finding), units where
applicable, provenance (the bracketed segment id). Convert spoken number words
to numerals.
"""

VERIFY = """\
Here is a first-pass event extraction from the intra-op voice notes. Verify it
against the source segments: fix wrong doses/number-word conversions, add
missed events, drop hallucinated ones, and correct categories. Return the
full corrected event list.

Source segments:
{sources}

First-pass events:
{first_pass}
"""


class EventExtractor:
    def __init__(self, fast_chat, reasoning_chat, verify: bool = True) -> None:
        self.fast_chat = fast_chat
        self.reasoning_chat = reasoning_chat
        self.verify = verify

    def extract(self, case: Case, source_id: str) -> list[ExtractedEvent]:
        sources = render_sources(case, types=(SourceType.AUDIO,))
        first = self.fast_chat.complete_structured(
            FIRST_PASS.format(sources=sources), schema=ExtractedEvents, system=SYSTEM
        )
        result = first
        if self.verify:
            first_pass_text = "\n".join(
                f"- {e.t} [{e.category}] {e.value} {e.units or ''} "
                f"({', '.join(e.provenance)})"
                for e in first.events
            )
            result = self.reasoning_chat.complete_structured(
                VERIFY.format(sources=sources, first_pass=first_pass_text),
                schema=ExtractedEvents,
                system=SYSTEM,
            )
        return [e for e in result.events if self._resolves(case, e)]

    @staticmethod
    def _resolves(case: Case, event: ExtractedEvent) -> bool:
        if not event.provenance:
            return False
        try:
            for ref in event.provenance:
                case.resolve(ref)
        except (KeyError, ValueError):
            return False
        return True
