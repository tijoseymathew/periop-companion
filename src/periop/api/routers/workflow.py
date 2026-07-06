"""Write path: provider roster and case creation (spec v2 §5.2).

The roster is a hand-editable JSON file surfaced as-is — the picker is a demo
affordance whose honest job is stamping attribution (v2 §5.1), not identity.
Every case-scoped write endpoint refuses demo cases (no ``workflow`` block)
with a 409: seeded synthetic cases are reviewable everywhere, writable
nowhere.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from periop.schemas import Case, Provider, Workflow
from periop.store import CaseStore

router = APIRouter()


def _store(request: Request) -> CaseStore:
    return CaseStore(request.app.state.out_dir)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def load_providers(request: Request) -> list[Provider]:
    path = request.app.state.providers_path
    if not path.is_file():
        return []
    return [Provider.model_validate(p) for p in json.loads(path.read_text())]


def require_provider(request: Request, provider_id: str) -> Provider:
    provider = next(
        (p for p in load_providers(request) if p.provider_id == provider_id), None
    )
    if provider is None:
        raise HTTPException(status_code=404, detail=f"no such provider: {provider_id}")
    return provider


def require_writable(case: Case) -> None:
    if case.is_demo:
        raise HTTPException(
            status_code=409,
            detail=(
                f"case {case.case_id} is seeded demo data (no workflow block) "
                "and cannot be modified"
            ),
        )


@router.get("/providers")
def list_providers(request: Request) -> list[Provider]:
    return load_providers(request)


class CreateCase(BaseModel):
    label: str
    provider_id: str

    @field_validator("label")
    @classmethod
    def _sane_label(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("label must not be blank")
        if ".." in v or "/" in v or "\\" in v:
            raise ValueError("label must not contain path separators")
        return v


def _slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


@router.post("/cases", status_code=201)
def create_case(request: Request, body: CreateCase) -> Case:
    provider = require_provider(request, body.provider_id)
    store = _store(request)

    base = _slug(body.label) or "case"
    existing = set(store.list_case_ids())
    case_id = base
    n = 2
    while case_id in existing:
        case_id = f"{base}-{n}"
        n += 1

    case = Case(
        case_id=case_id,
        label=body.label,
        workflow=Workflow(created_by=provider, created_at=_now()),
    )
    store.save(case)
    return case
