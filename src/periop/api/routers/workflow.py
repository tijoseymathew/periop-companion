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
from periop.schemas import (
    Case,
    OpenQuestion,
    Provider,
    ReopenRecord,
    StageStatus,
    Workflow,
)
from periop.store import CaseStore
from periop.tools import audio as audio_tools
from periop.tools.chunker import ingest_document

MAX_DOCUMENT_BYTES = 5 * 1024 * 1024  # ~5 MB (spec v2 §5.2)
MAX_AUDIO_BYTES = 50 * 1024 * 1024  # ~50 MB

AUDIO_KIND_TO_STAGE = {
    "preop-interview": "preop",
    "intraop-notes": "intraop",
    "postop-interview": "postop",
}

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


class ReviewedQuestions(BaseModel):
    questions: list[OpenQuestion]
    provider_id: str


@router.put("/cases/{case_id}/questions")
def review_questions(request: Request, case_id: str, body: ReviewedQuestions) -> Case:
    """Persist the provider-reviewed question list and pass the question gate.

    Dismissals are kept, never deleted (v2 §4.1): the submitted list *is* the
    record of the review, including what was dismissed.
    """
    case = load_case(request, case_id)
    require_writable(case)

    unreviewed = [q.question for q in body.questions if q.review is None]
    if unreviewed:
        raise HTTPException(
            status_code=422,
            detail=f"every question needs a review decision; missing on: {unreviewed}",
        )
    for q in body.questions:
        for ref in q.provenance:
            try:
                case.resolve(ref)
            except (KeyError, ValueError):
                raise HTTPException(
                    status_code=422,
                    detail=f"question {q.question!r} cites unresolvable provenance {ref}",
                ) from None

    case.open_questions = body.questions
    case.workflow.stages["preop"].questions_approved_at = _now()
    case.workflow.stages["preop"].performed_by = body.provider_id
    _store(request).save(case)
    return case


@router.post("/cases/{case_id}/sources/audio", status_code=201)
async def add_audio(request: Request, case_id: str, confirm: bool = False) -> Case:
    """Capture/upload audio for a stage, normalized to wav (v2 §5.2).

    Intra-op memos append to one growing wav; interview kinds replace only
    with explicit confirmation. Segments arrive later, from ASR at generate
    time — this endpoint records the input, not the transcript.
    """
    case = load_case(request, case_id)
    require_writable(case)

    form = await request.form()
    upload = form.get("file")
    kind = str(form.get("kind", ""))
    provider_id = form.get("provider_id")
    if kind not in AUDIO_KIND_TO_STAGE:
        raise HTTPException(
            status_code=422,
            detail=f"kind must be one of {', '.join(AUDIO_KIND_TO_STAGE)}",
        )
    if upload is None or isinstance(upload, str):
        raise HTTPException(status_code=422, detail="multipart upload needs a 'file' part")
    data = await upload.read()
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio exceeds the 50 MB upload cap")

    stage = case.workflow.stages[AUDIO_KIND_TO_STAGE[kind]]
    if stage.status is StageStatus.SIGNED_OFF:
        raise HTTPException(
            status_code=409,
            detail="this stage is signed off — reopen it before changing its inputs",
        )

    audio_dir = request.app.state.case_dir / case_id / "audio"
    dest = audio_dir / f"{kind}.wav"
    filename = upload.filename or "recording.wav"
    try:
        if kind == "intraop-notes" and dest.exists():
            # memos accumulate (v2 §4.2 step 2)
            memo = audio_dir / ".memo.tmp.wav"
            audio_tools.normalize_to_wav(data, filename, memo)
            try:
                audio_tools.append_wav(dest, memo)
            finally:
                memo.unlink(missing_ok=True)
        else:
            if dest.exists() and kind != "intraop-notes" and not confirm:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"{kind} is already recorded — re-send with ?confirm=true "
                        "to replace it"
                    ),
                )
            audio_tools.normalize_to_wav(data, filename, dest)
    except audio_tools.AudioNormalizationError as e:
        raise HTTPException(
            status_code=503 if e.needs_ffmpeg else 422, detail=str(e)
        ) from None

    stage.inputs_recorded_at = _now()
    if provider_id:
        stage.performed_by = str(provider_id)
    if stage.status is StageStatus.AWAITING_INPUTS:
        stage.status = StageStatus.READY_TO_GENERATE
    _store(request).save(case)
    return case


class ProviderAction(BaseModel):
    provider_id: str


def _require_stage(case: Case, stage: str):
    if case.workflow is None or stage not in case.workflow.stages:
        raise HTTPException(status_code=404, detail=f"no such stage: {stage}")
    return case.workflow.stages[stage]


@router.post("/cases/{case_id}/stages/{stage}/signoff")
def signoff_stage(request: Request, case_id: str, stage: str, body: ProviderAction) -> Case:
    """Assert 'I have reviewed this stage's output' (v2 §4.5).

    Allowed with outstanding conflicts — the ledger keeps them visible; the
    sign-off screen is responsible for surfacing them, not hiding them.
    """
    case = load_case(request, case_id)
    require_writable(case)
    state = _require_stage(case, stage)
    require_provider(request, body.provider_id)

    if state.status is StageStatus.SIGNED_OFF:
        raise HTTPException(status_code=409, detail=f"the {stage} stage is already signed off")
    if state.status is not StageStatus.AWAITING_REVIEW:
        raise HTTPException(
            status_code=409,
            detail=f"nothing to sign off — generate the {stage} output first",
        )

    state.status = StageStatus.SIGNED_OFF
    state.signed_off_by = body.provider_id
    state.signed_off_at = _now()
    _store(request).save(case)
    return case


@router.post("/cases/{case_id}/stages/{stage}/reopen")
def reopen_stage(request: Request, case_id: str, stage: str, body: ProviderAction) -> Case:
    """Reopen a signed-off stage for re-review. Prior artifacts are kept —
    the ledger is append-only in spirit (v2 §4.5)."""
    case = load_case(request, case_id)
    require_writable(case)
    state = _require_stage(case, stage)
    require_provider(request, body.provider_id)

    if state.status is not StageStatus.SIGNED_OFF:
        raise HTTPException(
            status_code=409, detail=f"only signed-off stages can be reopened"
        )

    state.status = StageStatus.AWAITING_REVIEW
    state.signed_off_by = None
    state.signed_off_at = None
    state.reopens.append(ReopenRecord(reopened_by=body.provider_id, reopened_at=_now()))
    _store(request).save(case)
    return case


@router.post("/cases/{case_id}/handoff/ack")
def acknowledge_handoff(request: Request, case_id: str, body: ProviderAction) -> Case:
    """The receiving provider acknowledges the PACU handoff (v2 §4.4).

    Deliberately not a signature or a legal artifact — it demonstrates the
    shape of a safe transfer (received, traceable, acknowledged).
    """
    case = load_case(request, case_id)
    require_writable(case)
    require_provider(request, body.provider_id)

    if case.get_artifact("note:pacu-handoff") is None:
        raise HTTPException(
            status_code=409, detail="generate the PACU handoff before acknowledging it"
        )
    state = case.workflow.stages["postop"]
    if state.handoff_acknowledged_by is not None:
        raise HTTPException(
            status_code=409,
            detail=f"handoff already acknowledged by {state.handoff_acknowledged_by}",
        )

    state.handoff_acknowledged_by = body.provider_id
    state.handoff_acknowledged_at = _now()
    _store(request).save(case)
    return case
