"""EventExtractor (spec §3.4 step 2): voice-note transcript → structured events.

Two-tier per spec §8: a fast Nemotron Nano first pass proposes events cheaply,
then a Nemotron Super pass verifies/corrects them against the transcript and a
strict schema. In the ADK composition these are two generate→validate steps in
the intra-op stage sequence; the first pass leaves its raw events in session
state and the verify step reads them back. Every event cites the segment it
came from; events citing unknown segments are dropped. The A/B (nano-only vs
nano→super) is exposed via the `verify` flag for the eval harness.
"""

from typing import Any, Mapping

from pydantic import BaseModel, Field

from periop.agents.context import preview_texts, render_sources
from periop.schemas import Case, EventCategory, SourceType

FIRST_PASS_KEY = "event_extract__first"
EVENTS_KEY = "extracted_events"


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


def render_event_log(events: list[ExtractedEvent]) -> str:
    return "\n".join(
        f"- {e.t} [{e.category}] {e.value} {e.units or ''} "
        f"({', '.join(e.provenance)})"
        for e in events
    )


def first_pass_prompt(case: Case, state: Mapping[str, Any] | None = None) -> str:
    return FIRST_PASS.format(sources=render_sources(case, types=(SourceType.AUDIO,)))


def verify_prompt(case: Case, state: Mapping[str, Any]) -> str:
    first = [ExtractedEvent.model_validate(e) for e in state.get(FIRST_PASS_KEY) or []]
    return VERIFY.format(
        sources=render_sources(case, types=(SourceType.AUDIO,)),
        first_pass=render_event_log(first),
    )


def resolved_events(case: Case, events: list[ExtractedEvent]) -> list[ExtractedEvent]:
    return [e for e in events if _resolves(case, e)]


def _event_line(e: ExtractedEvent) -> str:
    return f"{e.t} [{e.category}] {e.value}" + (f" {e.units}" if e.units else "")


def apply_first_pass(final: bool):
    """First-pass apply: stash raw events for the verify step; when the pass
    is final (verify disabled, the A/B arm) also commit the resolved list."""

    def _apply(
        case: Case, out: ExtractedEvents, state: Mapping[str, Any] | None = None
    ) -> tuple[str, dict[str, Any]]:
        delta: dict[str, Any] = {
            FIRST_PASS_KEY: [e.model_dump(mode="json") for e in out.events]
        }
        events = out.events
        if final:
            events = resolved_events(case, events)
            delta[EVENTS_KEY] = [e.model_dump(mode="json") for e in events]
        delta["__preview__"] = preview_texts([_event_line(e) for e in events])
        return f"{len(events)} events", delta

    return _apply


def apply_verify(
    case: Case, out: ExtractedEvents, state: Mapping[str, Any] | None = None
) -> tuple[str, dict[str, Any]]:
    events = resolved_events(case, out.events)
    return f"{len(events)} events", {
        EVENTS_KEY: [e.model_dump(mode="json") for e in events],
        "__preview__": preview_texts([_event_line(e) for e in events]),
    }


def _resolves(case: Case, event: ExtractedEvent) -> bool:
    if not event.provenance:
        return False
    try:
        for ref in event.provenance:
            case.resolve(ref)
    except (KeyError, ValueError):
        return False
    return True


class EventExtractor:
    """Facade: run the ADK extraction step(s) standalone over one case."""

    def __init__(self, fast_chat, reasoning_chat, verify: bool = True) -> None:
        self.fast_chat = fast_chat
        self.reasoning_chat = reasoning_chat
        self.verify = verify

    def extract(self, case: Case, source_id: str) -> list[ExtractedEvent]:
        from google.adk.agents import SequentialAgent

        from periop.adk.runtime import run_agent
        from periop.adk.stages import extractor_steps

        agent = SequentialAgent(
            name="event_extractor",
            sub_agents=extractor_steps(
                self.fast_chat, self.reasoning_chat, verify=self.verify
            ),
        )
        _, state = run_agent(agent, case)
        return [ExtractedEvent.model_validate(e) for e in state.get(EVENTS_KEY) or []]
