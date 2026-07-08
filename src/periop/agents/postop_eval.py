"""PostAnesthesiaEvaluator (spec §3.5 step 3): post-op interview + case history
→ post-anesthesia evaluation note.

Unlike the handoff this DOES generate new claims (from the post-op interview),
each cited to its interview segment or prior source. Same claim-structured,
provenance-checked output as the pre-op note.
"""

from periop.agents.context import provenance_resolves, render_sources
from periop.agents.preop_note import WriterOutput
from periop.schemas import ArtifactRecord, Case, Claim

POSTOP_NOTE_ID = "note:post-anesthesia-eval"

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
"""


class PostAnesthesiaEvaluator:
    def __init__(self, chat) -> None:
        self.chat = chat

    def write(self, case: Case) -> ArtifactRecord:
        out = self.chat.complete_structured(
            PROMPT.format(sources=render_sources(case)),
            schema=WriterOutput,
            system=SYSTEM,
        )
        claims: list[Claim] = []
        for wc in out.claims:
            if provenance_resolves(case, wc.provenance):
                claims.append(
                    Claim(claim_id=f"c-{len(claims) + 1:03d}", text=wc.text, provenance=wc.provenance)
                )
        # returned, not appended: the post-op stage runs this concurrently
        # with the HandoffComposer and appends both in fixed order
        # (v2-speed §3.4), keeping the ledger deterministic
        return ArtifactRecord(artifact_id=POSTOP_NOTE_ID, claims=claims)
