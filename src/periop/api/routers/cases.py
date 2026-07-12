"""Case listing and detail endpoints (spec ui.md §4)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from periop.schemas import Case, ClaimStatus, SourceType, Workflow
from periop.store import CaseStore

router = APIRouter()


class CaseSummary(BaseModel):
    case_id: str
    artifact_count: int
    claim_count: int
    status_counts: dict[ClaimStatus, int]
    has_audio: bool
    # worklist fields (v2 §6.8): live cases carry their workflow block so the
    # UI derives stage + status in words; demo cases have neither
    label: str | None = None
    workflow: Workflow | None = None


def _store(request: Request) -> CaseStore:
    return CaseStore(request.app.state.out_dir)


def _has_audio(request: Request, case: Case) -> bool:
    audio_dir = request.app.state.case_dir / case.case_id / "audio"
    return any(
        (audio_dir / f"{s.source_id.removeprefix('audio:')}.wav").is_file()
        for s in case.sources
        if s.type is SourceType.AUDIO
    )


def _summarize(request: Request, case: Case) -> CaseSummary:
    claims = [c for a in case.artifacts for c in a.claims]
    return CaseSummary(
        case_id=case.case_id,
        artifact_count=len(case.artifacts),
        claim_count=len(claims),
        status_counts={
            status: sum(1 for c in claims if c.status is status) for status in ClaimStatus
        },
        has_audio=_has_audio(request, case),
        label=case.label,
        workflow=case.workflow,
    )


def load_case(request: Request, case_id: str) -> Case:
    try:
        return _store(request).load(case_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"no such case: {case_id}") from None


@router.get("/cases")
def list_cases(request: Request) -> list[CaseSummary]:
    store = _store(request)
    return [_summarize(request, store.load(cid)) for cid in store.list_case_ids()]


@router.get("/cases/{case_id}")
def get_case(request: Request, case_id: str) -> Case:
    return load_case(request, case_id)
