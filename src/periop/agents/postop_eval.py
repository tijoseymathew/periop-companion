"""PostAnesthesiaEvaluator (spec §3.5 step 3): post-op interview + case history
→ post-anesthesia evaluation note.

Unlike the handoff this DOES generate new claims (from the post-op interview),
each cited to its interview segment or prior source. Same claim-structured,
provenance-checked output as the pre-op note. Like the handoff, the artifact
is parked in session state — the post-op stage runs both writers under a
``ParallelAgent`` and commits the ledger in fixed order (v2-speed §3.4).
"""

from typing import Any, Mapping

from periop.agents.context import preview_texts, render_sources
from periop.agents.preop_note import WriterOutput, filtered_claims
from periop.schemas import ArtifactRecord, Case

POSTOP_NOTE_ID = "note:post-anesthesia-eval"
POSTOP_STATE_KEY = "postop_eval__artifact"

SYSTEM = (
    "You write a post-anesthesia evaluation note from the post-operative "
    "interview and the case history, as atomic cited claims. Every claim is "
    "grounded in a cited span; a clinician reviews the note."
)

PROMPT = """\
Write a post-anesthesia evaluation note as atomic claims, from the post-op
interview and the case sources.

Sources (cite by the bracketed id):
{sources}

Cover: recovery course, pain, PONV/nausea, airway/respiratory status,
recall/awareness, and any issue linked to the anticipated post-op concerns.
Each claim: text (one fact), section, provenance (the supporting id(s)).

This note is about THIS recovery, not a history summary. Do not recite past
medical history from the records: resolved conditions, healed injuries, and
discontinued medications must not appear at all — not even prefixed with
"history of" or "resolved" — unless the item directly explains a finding in
this post-operative course, in which case state that connection in the claim.
"""


def prompt(case: Case, state: Mapping[str, Any] | None = None) -> str:
    return PROMPT.format(sources=render_sources(case))


def apply(
    case: Case, out: WriterOutput, state: Mapping[str, Any] | None = None
) -> tuple[str, dict[str, Any]]:
    artifact = ArtifactRecord(
        artifact_id=POSTOP_NOTE_ID, claims=filtered_claims(case, out)
    )
    return f"{len(artifact.claims)} claims", {
        POSTOP_STATE_KEY: artifact.model_dump(mode="json"),
        "__preview__": preview_texts([c.text for c in artifact.claims]),
    }


class PostAnesthesiaEvaluator:
    """Facade: run the ADK post-op eval step standalone; returns without appending."""

    def __init__(self, chat) -> None:
        self.chat = chat

    def write(self, case: Case) -> ArtifactRecord:
        from periop.adk.runtime import run_agent
        from periop.adk.stages import postop_eval_step

        _, state = run_agent(postop_eval_step(self.chat, announce=False), case)
        return ArtifactRecord.model_validate(state[POSTOP_STATE_KEY])
