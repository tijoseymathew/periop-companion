"""Human edits to generated artifacts (v2-ui feedback).

A provider can correct a claim's text or add a missing fact on any stage
artifact — the pre-op note, the theatre record, the PACU handoff. The edit
is never anonymous: each one lands as a chunk in the acting provider's own
``edit:<provider_id>`` source (``Case.record_human_edit``) and the claim
cites it, so the ledger shows who asserted what exactly the way it shows
which GP summary a fact came from. A human-attested claim is SUPPORTED by
that attestation; prior provenance is kept for context, never rewritten.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from periop.api.routers.cases import load_case
from periop.api.routers.workflow import require_provider, require_writable
from periop.schemas import Case, Claim, ClaimStatus, Provider, ProvenanceRef, StageStatus
from periop.store import CaseStore

router = APIRouter()

# which stage's sign-off freezes which artifact (v2 §4.5: reopen to change)
ARTIFACT_STAGE = {
    "note:pre-anesthesia-eval": "preop",
    "record:intra-op": "intraop",
    "note:anticipated-issues": "intraop",
    "note:pacu-handoff": "postop",
    "note:post-anesthesia-eval": "postop",
}


class ClaimEdit(BaseModel):
    text: str
    provider_id: str

    @field_validator("text")
    @classmethod
    def _has_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("the claim text must not be blank")
        return v


def _require_editable(case: Case, artifact_id: str) -> None:
    stage_key = ARTIFACT_STAGE.get(artifact_id)
    if (
        stage_key
        and case.workflow is not None
        and case.workflow.stages[stage_key].status is StageStatus.SIGNED_OFF
    ):
        raise HTTPException(
            status_code=409,
            detail=f"the {stage_key} stage is signed off — reopen it before editing its output",
        )


def _next_human_claim_id(artifact) -> str:
    existing = {c.claim_id for c in artifact.claims}
    n = 1
    while f"h-{n:03d}" in existing:
        n += 1
    return f"h-{n:03d}"


def _prepare(request: Request, case_id: str, artifact_id: str, body: ClaimEdit) -> Provider:
    """Shared gates: writable case, known provider, known open artifact."""
    case = load_case(request, case_id)
    require_writable(case)
    provider = require_provider(request, body.provider_id)
    if case.get_artifact(artifact_id) is None:
        raise HTTPException(status_code=404, detail=f"no such artifact: {artifact_id}")
    _require_editable(case, artifact_id)
    return provider


@router.post("/cases/{case_id}/artifacts/{artifact_id}/claims", status_code=201)
def add_claim(request: Request, case_id: str, artifact_id: str, body: ClaimEdit) -> Case:
    """Add a provider-asserted fact to an artifact."""
    provider = _prepare(request, case_id, artifact_id, body)

    def apply(fresh: Case) -> None:
        artifact = fresh.get_artifact(artifact_id)
        if artifact is None:  # deleted between load and mutate — effectively unreachable
            raise HTTPException(status_code=404, detail=f"no such artifact: {artifact_id}")
        ref = fresh.record_human_edit(
            provider, body.text, f"{artifact_id} — added by {provider.name}"
        )
        artifact.claims.append(
            Claim(
                claim_id=_next_human_claim_id(artifact),
                text=body.text,
                provenance=[ref],
                status=ClaimStatus.SUPPORTED,
            )
        )

    # merged into the freshest copy: a background job may be saving this case
    return CaseStore(request.app.state.out_dir).mutate(case_id, apply)


@router.put("/cases/{case_id}/artifacts/{artifact_id}/claims/{claim_id}")
def edit_claim(
    request: Request, case_id: str, artifact_id: str, claim_id: str, body: ClaimEdit
) -> Case:
    """Rewrite one claim's text as a provider-attested correction."""
    provider = _prepare(request, case_id, artifact_id, body)

    def apply(fresh: Case) -> None:
        artifact = fresh.get_artifact(artifact_id)
        claim = next(
            (c for c in (artifact.claims if artifact else []) if c.claim_id == claim_id),
            None,
        )
        if claim is None:
            raise HTTPException(status_code=404, detail=f"no such claim: {claim_id}")
        ref = fresh.record_human_edit(
            provider, body.text, f"{artifact_id}#{claim_id} — edited by {provider.name}"
        )
        claim.text = body.text
        claim.provenance.append(ProvenanceRef.parse(ref))
        claim.status = ClaimStatus.SUPPORTED

    return CaseStore(request.app.state.out_dir).mutate(case_id, apply)
