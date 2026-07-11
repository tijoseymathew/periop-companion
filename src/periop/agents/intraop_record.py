"""IntraOpRecordWriter (spec §3.4 step 3): events → chronological record.

Composes the verified event log into a readable intra-op record, still as
atomic cited claims (agents/doses/times, airway, lines, fluids, notable
events). Each claim cites the event segments; dangling citations are dropped.
"""

from typing import Any, Mapping

from periop.agents.context import render_sources
from periop.agents.event_extractor import (
    EVENTS_KEY,
    ExtractedEvent,
    render_event_log,
)
from periop.agents.preop_note import WriterOutput, filtered_claims
from periop.schemas import ArtifactRecord, Case, Event, SourceType

INTRAOP_RECORD_ID = "record:intra-op"

SYSTEM = (
    "You write an intra-operative anesthetic record from a verified event log, "
    "as atomic cited claims. You never add clinical facts beyond the events."
)

PROMPT = """\
Write the intra-operative record for this case as atomic claims, in
chronological order, grouped by section (Agents, Airway, Lines, Fluids,
Events).

Verified event log:
{events}

Voice-note segments (cite these ids):
{sources}

Each claim: text (one fact, include the time), section, provenance (the
segment id(s) the fact came from, exactly as bracketed).
"""


def _events_from_state(state: Mapping[str, Any]) -> list[ExtractedEvent]:
    return [ExtractedEvent.model_validate(e) for e in state.get(EVENTS_KEY) or []]


def prompt(case: Case, state: Mapping[str, Any]) -> str:
    return PROMPT.format(
        events=render_event_log(_events_from_state(state)),
        sources=render_sources(case, types=(SourceType.AUDIO,)),
    )


def apply(
    case: Case, out: WriterOutput, state: Mapping[str, Any]
) -> tuple[str, dict[str, Any]]:
    from periop.adk.runtime import case_delta

    # the verified event log is first-class case state, carried to downstream
    # stages (issue anticipation) even if the prose record is sparse.
    case.intraop_events = [
        Event(t=e.t, category=e.category, value=e.value, units=e.units,
              provenance=e.provenance)
        for e in _events_from_state(state)
    ]
    artifact = ArtifactRecord(
        artifact_id=INTRAOP_RECORD_ID, claims=filtered_claims(case, out)
    )
    case.add_artifact(artifact)
    return f"{len(artifact.claims)} claims", case_delta(case)


class IntraOpRecordWriter:
    """Facade: run the ADK record-writer step standalone over one case."""

    def __init__(self, chat) -> None:
        self.chat = chat

    def write(self, case: Case, events) -> ArtifactRecord:
        from periop.adk.runtime import run_agent, sync_case
        from periop.adk.stages import intraop_record_step

        result, _ = run_agent(
            intraop_record_step(self.chat),
            case,
            extra_state={EVENTS_KEY: [e.model_dump(mode="json") for e in events]},
        )
        sync_case(case, result)
        return case.get_artifact(INTRAOP_RECORD_ID)
