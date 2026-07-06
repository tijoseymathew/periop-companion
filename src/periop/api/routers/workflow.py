"""Write path: provider roster and case creation (spec v2 §5.2).

The roster is a hand-editable JSON file surfaced as-is — the picker is a demo
affordance whose honest job is stamping attribution (v2 §5.1), not identity.
Every case-scoped write endpoint refuses demo cases (no ``workflow`` block)
with a 409: seeded synthetic cases are reviewable everywhere, writable
nowhere.
"""

from __future__ import annotations

import io
import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from periop.api.routers.cases import load_case
from periop.schemas import Case, Provider, Workflow
from periop.store import CaseStore
from periop.tools.chunker import ingest_document

MAX_DOCUMENT_BYTES = 5 * 1024 * 1024  # ~5 MB (spec v2 §5.2)

# typed record slots (v2 §4.1 step 2); names match the synthetic bundles'
# records/ files so live and seeded cases share one convention
DOC_TYPES = ("gp-summary", "med-list", "prior-anesthetic-record", "op-plan", "other")

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


def _extract_pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        raise HTTPException(
            status_code=422, detail="could not extract text from the PDF"
        ) from None


async def _document_payload(request: Request) -> tuple[str, str, str | None]:
    """Parse either form: JSON paste or multipart file upload.

    Returns (doc_type, text, provider_id).
    """
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        doc_type = str(form.get("doc_type", ""))
        provider_id = form.get("provider_id")
        if upload is None or isinstance(upload, str):
            raise HTTPException(status_code=422, detail="multipart upload needs a 'file' part")
        data = await upload.read()
        if len(data) > MAX_DOCUMENT_BYTES:
            raise HTTPException(status_code=413, detail="document exceeds the 5 MB upload cap")
        name = (upload.filename or "").lower()
        if name.endswith(".pdf"):
            text = _extract_pdf_text(data)
        elif name.endswith((".txt", ".md")):
            text = data.decode("utf-8", errors="replace")
        else:
            raise HTTPException(
                status_code=422,
                detail="unsupported file type — upload .txt, .md, or .pdf",
            )
        return doc_type, text, str(provider_id) if provider_id else None

    body = await request.json()
    text = body.get("text", "")
    if len(text.encode()) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="document exceeds the 5 MB paste cap")
    return str(body.get("doc_type", "")), text, body.get("provider_id")


def _preop_inputs_present(case: Case) -> bool:
    doc_ids = {s.source_id for s in case.sources}
    return "doc:op-plan" in doc_ids and len(doc_ids) > 1


@router.post("/cases/{case_id}/sources/document", status_code=201)
async def add_document(request: Request, case_id: str) -> Case:
    case = load_case(request, case_id)
    require_writable(case)

    doc_type, text, provider_id = await _document_payload(request)
    if doc_type not in DOC_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"doc_type must be one of {', '.join(DOC_TYPES)}",
        )
    if not text.strip():
        raise HTTPException(status_code=422, detail="document has no text content")

    source_id = f"doc:{doc_type}"
    if case.get_source(source_id) is not None:
        raise HTTPException(
            status_code=409,
            detail=f"{source_id} already provided (the source registry is append-only)",
        )

    # keep the on-disk records/ convention so RecordIngestor re-ingest and the
    # batch pipeline see the same inputs as the API path
    records_dir = request.app.state.case_dir / case_id / "records"
    records_dir.mkdir(parents=True, exist_ok=True)
    (records_dir / f"{doc_type}.md").write_text(text)

    source = ingest_document(source_id, text)
    source.captured_at = _now()
    source.provided_by = provider_id
    case.add_source(source)

    # the GapAnalyst needs no audio (v2 §4.1 step 3): run it as soon as the
    # op plan and at least one record exist, once
    if not case.open_questions and _preop_inputs_present(case):
        request.app.state.runner.analyze_gaps(case)

    if provider_id and case.workflow is not None:
        case.workflow.stages["preop"].performed_by = provider_id

    _store(request).save(case)
    return case
