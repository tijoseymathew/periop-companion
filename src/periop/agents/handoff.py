"""HandoffComposer (spec §3.5 step 2, §3.5 constraint): the PACU handoff.

Deliberately constrained: it selects, orders, and lightly rephrases EXISTING
claims but may not introduce new ones. Each handoff item references source
claims by global id (``artifact_id#claim_id``); provenance is INHERITED from
those claims, never regenerated. Items that reference no existing claim (a
hallucinated addition) are dropped — this is the demoable hallucination-control
property.
"""

from pydantic import BaseModel, Field

from periop.agents.context import render_claims
from periop.agents.intraop_record import INTRAOP_RECORD_ID
from periop.agents.issue_anticipator import ANTICIPATED_ISSUES_ID
from periop.agents.preop_note import PREOP_NOTE_ID
from periop.schemas import ArtifactRecord, Case, Claim

HANDOFF_ID = "note:pacu-handoff"

# Source artifacts the handoff may draw claims from, in SBAR-ish order.
_SOURCE_ARTIFACTS = (PREOP_NOTE_ID, INTRAOP_RECORD_ID, ANTICIPATED_ISSUES_ID)

SYSTEM = (
    "You compose a PACU handoff by SELECTING and ORDERING existing, already-"
    "verified claims. You may lightly rephrase for a handoff register, but you "
    "MUST NOT introduce any new clinical fact. Every handoff item references "
    "the existing claim(s) it is built from."
)

PROMPT = """\
Compose a PACU handoff (SBAR-shaped) for this case using ONLY the existing
claims below. Select the handoff-relevant ones, order them sensibly, and
rephrase lightly for a spoken handoff. Do NOT add any fact not present here.

Existing claims (reference by the bracketed global id):
{claims}

For each handoff item: section (Situation/Background/Assessment/
Recommendation, or a clinical grouping), text (the handoff phrasing),
source_claims (the id(s) of the existing claim(s) it is built from, exactly as
bracketed — at least one).
"""


class HandoffItem(BaseModel):
    section: str
    text: str
    source_claims: list[str] = Field(
        description="Global ids (artifact_id#claim_id) of the existing claims this is built from"
    )


class HandoffPlan(BaseModel):
    items: list[HandoffItem]


class HandoffComposer:
    def __init__(self, chat) -> None:
        self.chat = chat

    def compose(self, case: Case) -> ArtifactRecord:
        available = [
            render_claims(a)
            for aid in _SOURCE_ARTIFACTS
            if (a := case.get_artifact(aid)) is not None
        ]
        plan = self.chat.complete_structured(
            PROMPT.format(claims="\n".join(available)), schema=HandoffPlan, system=SYSTEM
        )

        claims: list[Claim] = []
        for item in plan.items:
            provenance = self._inherit_provenance(case, item.source_claims)
            if not provenance:  # references nothing real → drop (no new claims)
                continue
            claims.append(
                Claim(
                    claim_id=f"c-{len(claims) + 1:03d}",
                    text=item.text,
                    provenance=provenance,
                )
            )
        artifact = ArtifactRecord(artifact_id=HANDOFF_ID, claims=claims)
        case.add_artifact(artifact)
        return artifact

    @staticmethod
    def _inherit_provenance(case: Case, source_claims: list[str]) -> list[str]:
        refs: list[str] = []
        for ref in source_claims:
            source = case.get_claim(ref)
            if source is None:
                continue
            for prov in source.provenance:
                key = str(prov)
                if key not in refs:
                    refs.append(key)
        return refs
