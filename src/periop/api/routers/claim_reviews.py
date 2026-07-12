"""Per-claim review actions (spec v2 §2 stretch): mark reviewed / flag.

Sidecar state beside the case file — annotating the review pass never edits
the ledger (unchanged ui.md invariant: review actions operate on claims and
stages, never on text). The sign-off screen reads this map to say what has
been looked at and what a provider flagged.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from periop.api.routers.cases import load_case
from periop.api.routers.workflow import require_provider, require_writable
from periop.schemas import ClaimReview, ClaimReviewState
from periop.store import CaseStore

router = APIRouter()


@router.get("/cases/{case_id}/claim-reviews")
def get_claim_reviews(request: Request, case_id: str) -> dict[str, ClaimReview]:
    load_case(request, case_id)  # 404 on unknown cases
    return CaseStore(request.app.state.out_dir).load_claim_reviews(case_id)


class ReviewAction(BaseModel):
    ref: str  # artifact_id#claim_id
    state: ClaimReviewState | None  # null clears the action
    provider_id: str


@router.post("/cases/{case_id}/claim-reviews")
def review_claim(request: Request, case_id: str, body: ReviewAction) -> dict[str, ClaimReview]:
    case = load_case(request, case_id)
    require_writable(case)
    require_provider(request, body.provider_id)
    if case.get_claim(body.ref) is None:
        raise HTTPException(status_code=404, detail=f"no such claim: {body.ref}")

    store = CaseStore(request.app.state.out_dir)
    reviews = store.load_claim_reviews(case_id)
    if body.state is None:
        reviews.pop(body.ref, None)
    else:
        reviews[body.ref] = ClaimReview(
            state=body.state, by=body.provider_id, at=datetime.now(timezone.utc)
        )
    store.save_claim_reviews(case_id, reviews)
    return reviews
