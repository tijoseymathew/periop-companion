"""PreOpNoteWriter (spec §3.3 step 5): sources + interview → claim-structured
pre-anesthesia evaluation note.

The note is emitted as atomic claims, each citing record chunks and/or
interview segments. The rendered document is assembled from claims, so
provenance is structural (spec §4.1). Claims whose citations don't resolve
are dropped before the artifact is committed.
"""

from pydantic import BaseModel, Field, field_validator

from periop.agents.context import normalize_refs, provenance_resolves, render_sources
from periop.schemas import ArtifactRecord, Case, Claim

PREOP_NOTE_ID = "note:pre-anesthesia-eval"


class WriterClaim(BaseModel):
    text: str = Field(description="One atomic factual statement")
    section: str = Field(description="ASA note section, e.g. History, Medications, Airway, Plan")
    provenance: list[str] = Field(description="source_id#anchor refs supporting the claim")

    _normalize = field_validator("provenance")(staticmethod(normalize_refs))


class WriterOutput(BaseModel):
    claims: list[WriterClaim]


SYSTEM = (
    "You are an anesthesia documentation assistant. You write a pre-anesthesia "
    "evaluation note as a set of atomic, individually-cited claims. Every claim "
    "must be grounded in the provided record chunks or interview segments — "
    "never assert anything you cannot cite. This is a documentation aid; a "
    "clinician reviews every claim."
)

PROMPT = """\
Write a pre-anesthesia evaluation note for this case, as atomic claims.

Sources (cite by the bracketed id):
{sources}

{questions_block}
Cover the standard ASA elements as sections: History, Medications, Allergies,
NPO status, Airway exam (only as dictated), ASA-PS (with justification claims),
and Plan. Each claim:
- text: one atomic fact.
- section: which element above.
- provenance: the id(s) of the supporting chunk/segment, exactly as bracketed.
When the records and the interview conflict (e.g. records say a drug is
current but the patient says they stopped it), state the CURRENT truth from
the interview and cite it; do not silently keep the stale record value.

Relevance filter: the records deliberately contain distractor history —
resolved conditions (a pneumonia cleared years ago, a healed fracture),
long-discontinued medications, and incidental items with no anesthetic
implication. Before writing any claim from past history, apply this test:
would this item change the anesthetic plan, airway management, drug choice,
or post-op monitoring? If no, leave it out entirely. If yes,
state that reason in the claim text (e.g. "... — relevant because ...");
a historical item without a stated anesthetic reason does not belong here.
"""


def _questions_block(case: Case) -> str:
    # alignment runs against the reviewed list (v2 §4.1): dismissed questions
    # are excluded, edited wording wins; unreviewed questions (batch path) stay
    active = [q for q in case.open_questions if q.is_active]
    if not active:
        return ""
    joined = "\n".join(f"- {q.effective_text}" for q in active)
    return (
        "These clarification questions were raised in gap analysis; ensure the "
        "note answers each one (or records it as unresolved):\n"
        f"{joined}\n"
    )


class PreOpNoteWriter:
    def __init__(self, chat) -> None:
        self.chat = chat

    def write(self, case: Case) -> ArtifactRecord:
        prompt = PROMPT.format(
            sources=render_sources(case),
            questions_block=_questions_block(case),
        )
        out = self.chat.complete_structured(prompt, schema=WriterOutput, system=SYSTEM)
        claims: list[Claim] = []
        for wc in out.claims:
            if not provenance_resolves(case, wc.provenance):
                continue
            claims.append(
                Claim(
                    claim_id=f"c-{len(claims) + 1:03d}",
                    text=wc.text,
                    provenance=wc.provenance,
                )
            )
        artifact = ArtifactRecord(artifact_id=PREOP_NOTE_ID, claims=claims)
        case.add_artifact(artifact)
        return artifact
