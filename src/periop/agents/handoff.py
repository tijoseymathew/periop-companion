"""HandoffComposer (spec §3.5 step 2, §3.5 constraint): the PACU handoff.

Deliberately constrained: it selects, orders, and lightly rephrases EXISTING
claims but may not introduce new ones. Each handoff item references source
claims by global id (``artifact_id#claim_id``); provenance is INHERITED from
those claims, never regenerated. Items that reference no existing claim (a
hallucinated addition) are dropped — this is the demoable hallucination-control
property.

The step's apply leaves the artifact in its own session-state key instead of
appending it: the post-op ``ParallelAgent`` runs this writer concurrently with
the PostAnesthesiaEvaluator, and a downstream agent commits both to the ledger
in fixed order (v2-speed §3.4).
"""

from typing import Any, Mapping

from pydantic import BaseModel, Field, field_validator

from periop.agents.context import normalize_refs, preview_texts, render_claims
from periop.agents.intraop_record import INTRAOP_RECORD_ID
from periop.agents.issue_anticipator import ANTICIPATED_ISSUES_ID
from periop.agents.preop_note import PREOP_NOTE_ID
from periop.schemas import ArtifactRecord, Case, Claim

HANDOFF_ID = "note:pacu-handoff"
HANDOFF_STATE_KEY = "handoff__artifact"

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

Select for PACU relevance only: do NOT carry over resolved or remote history
with no bearing on this recovery (healed fractures, infections cleared years
ago, long-discontinued medications). If a background claim would not change
what the PACU nurse watches for or does, leave it out — do not mention it
even as context.
"""


class HandoffItem(BaseModel):
    section: str
    text: str
    source_claims: list[str] = Field(
        description="Global ids (artifact_id#claim_id) of the existing claims this is built from"
    )

    _normalize = field_validator("source_claims")(staticmethod(normalize_refs))


class HandoffPlan(BaseModel):
    items: list[HandoffItem]


def prompt(case: Case, state: Mapping[str, Any] | None = None) -> str:
    available = [
        render_claims(a)
        for aid in _SOURCE_ARTIFACTS
        if (a := case.get_artifact(aid)) is not None
    ]
    return PROMPT.format(claims="\n".join(available))


def compose_artifact(case: Case, plan: HandoffPlan) -> ArtifactRecord:
    claims: list[Claim] = []
    for item in plan.items:
        provenance = _inherit_provenance(case, item.source_claims)
        if not provenance:  # references nothing real → drop (no new claims)
            continue
        claims.append(
            Claim(
                claim_id=f"c-{len(claims) + 1:03d}",
                text=item.text,
                provenance=provenance,
            )
        )
    return ArtifactRecord(artifact_id=HANDOFF_ID, claims=claims)


def apply(
    case: Case, plan: HandoffPlan, state: Mapping[str, Any] | None = None
) -> tuple[str, dict[str, Any]]:
    artifact = compose_artifact(case, plan)
    # parked in state, not appended: the ledger commit is a downstream agent
    # so artifact order never depends on writer completion order
    return f"{len(artifact.claims)} claims", {
        HANDOFF_STATE_KEY: artifact.model_dump(mode="json"),
        "__preview__": preview_texts([c.text for c in artifact.claims]),
    }


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


class HandoffComposer:
    """Facade: run the ADK handoff step standalone; returns without appending."""

    def __init__(self, chat) -> None:
        self.chat = chat

    def compose(self, case: Case) -> ArtifactRecord:
        from periop.adk.runtime import run_agent
        from periop.adk.stages import handoff_step

        _, state = run_agent(handoff_step(self.chat, announce=False), case)
        return ArtifactRecord.model_validate(state[HANDOFF_STATE_KEY])
