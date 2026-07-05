"""IntraOpRecordWriter (spec §3.4 step 3): events → chronological record.

Composes the verified event log into a readable intra-op record, still as
atomic cited claims (agents/doses/times, airway, lines, fluids, notable
events). Each claim cites the event segments; dangling citations are dropped.
"""

from periop.agents.context import provenance_resolves, render_sources
from periop.agents.preop_note import WriterOutput
from periop.schemas import ArtifactRecord, Case, Claim, Event, SourceType

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


class IntraOpRecordWriter:
    def __init__(self, chat) -> None:
        self.chat = chat

    def write(self, case: Case, events) -> ArtifactRecord:
        # the verified event log is first-class case state, carried to
        # downstream stages (issue anticipation) even if the prose record is
        # sparse.
        case.intraop_events = [
            Event(t=e.t, category=e.category, value=e.value, units=e.units,
                  provenance=e.provenance)
            for e in events
        ]
        event_log = "\n".join(
            f"- {e.t} [{e.category}] {e.value} {e.units or ''} "
            f"({', '.join(e.provenance)})"
            for e in events
        )
        prompt = PROMPT.format(
            events=event_log,
            sources=render_sources(case, types=(SourceType.AUDIO,)),
        )
        out = self.chat.complete_structured(prompt, schema=WriterOutput, system=SYSTEM)
        claims: list[Claim] = []
        for wc in out.claims:
            if provenance_resolves(case, wc.provenance):
                claims.append(
                    Claim(claim_id=f"c-{len(claims) + 1:03d}", text=wc.text, provenance=wc.provenance)
                )
        artifact = ArtifactRecord(artifact_id=INTRAOP_RECORD_ID, claims=claims)
        case.add_artifact(artifact)
        return artifact
