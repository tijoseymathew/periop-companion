"""Stage orchestration for intra-op and post-op, plus a full-case runner.

Each stage is a Case → Case transform that registers its sources and appends
its artifacts. `chat` is the reasoning tier; `fast_chat` is the fast tier used
for the event-extraction first pass and claim verification. Both are injected
(live NimChat, or stubs in tests). `emit` is an optional progress callback
``emit(event, data)`` feeding the SSE stream (ui.md §7).
"""

from pathlib import Path

from periop.agents.claim_verifier import ClaimVerifier
from periop.agents.event_extractor import EventExtractor
from periop.agents.handoff import HANDOFF_ID, HandoffComposer
from periop.agents.intraop_record import INTRAOP_RECORD_ID, IntraOpRecordWriter
from periop.agents.issue_anticipator import ANTICIPATED_ISSUES_ID, IssueAnticipator
from periop.agents.postop_eval import POSTOP_NOTE_ID, PostAnesthesiaEvaluator
from periop.agents.preop_stage import run_preop_stage
from periop.schemas import Case
from periop.tools.ingest import has_transcript_inputs, transcript_source


def _noop(event: str, data: dict) -> None:
    pass


def _claims(case: Case, artifact_id: str) -> int:
    artifact = case.get_artifact(artifact_id)
    return len(artifact.claims) if artifact else 0


def run_intraop_stage(case: Case, case_dir: Path | str, chat, fast_chat=None, emit=None) -> Case:
    case_dir = Path(case_dir)
    fast_chat = fast_chat or chat
    emit = emit or _noop

    if case.get_source("audio:intraop-notes") is None and has_transcript_inputs(
        case_dir, "intraop-notes"
    ):
        case.add_source(transcript_source(case_dir, "intraop-notes", "audio:intraop-notes"))

    emit("agent_start", {"stage": "intraop", "agent": "EventExtractor"})
    events = EventExtractor(fast_chat=fast_chat, reasoning_chat=chat).extract(
        case, "audio:intraop-notes"
    )
    emit("agent_end", {"stage": "intraop", "agent": "EventExtractor", "summary": f"{len(events)} events"})

    emit("agent_start", {"stage": "intraop", "agent": "IntraOpRecordWriter"})
    IntraOpRecordWriter(chat=chat).write(case, events)
    emit("agent_end", {"stage": "intraop", "agent": "IntraOpRecordWriter", "summary": f"{_claims(case, INTRAOP_RECORD_ID)} claims"})

    emit("agent_start", {"stage": "intraop", "agent": "IssueAnticipator"})
    IssueAnticipator(chat=chat).anticipate(case)
    emit("agent_end", {"stage": "intraop", "agent": "IssueAnticipator", "summary": f"{_claims(case, ANTICIPATED_ISSUES_ID)} issues"})

    emit("agent_start", {"stage": "intraop", "agent": "ClaimVerifier"})
    verifier = ClaimVerifier(chat=fast_chat)
    verifier.verify(case, INTRAOP_RECORD_ID)
    verifier.verify(case, ANTICIPATED_ISSUES_ID, forward_looking=True)
    emit("agent_end", {"stage": "intraop", "agent": "ClaimVerifier", "summary": "verified"})

    emit("artifact_complete", {"artifact_id": INTRAOP_RECORD_ID, "claims": _claims(case, INTRAOP_RECORD_ID)})
    emit("artifact_complete", {"artifact_id": ANTICIPATED_ISSUES_ID, "claims": _claims(case, ANTICIPATED_ISSUES_ID)})
    return case


def run_postop_stage(case: Case, case_dir: Path | str, chat, fast_chat=None, emit=None) -> Case:
    case_dir = Path(case_dir)
    fast_chat = fast_chat or chat
    emit = emit or _noop

    if case.get_source("audio:postop-interview") is None and has_transcript_inputs(
        case_dir, "postop-interview"
    ):
        case.add_source(transcript_source(case_dir, "postop-interview", "audio:postop-interview"))

    emit("agent_start", {"stage": "postop", "agent": "HandoffComposer"})
    HandoffComposer(chat=chat).compose(case)
    emit("agent_end", {"stage": "postop", "agent": "HandoffComposer", "summary": f"{_claims(case, HANDOFF_ID)} claims"})
    emit("artifact_complete", {"artifact_id": HANDOFF_ID, "claims": _claims(case, HANDOFF_ID)})

    emit("agent_start", {"stage": "postop", "agent": "PostAnesthesiaEvaluator"})
    PostAnesthesiaEvaluator(chat=chat).write(case)
    emit("agent_end", {"stage": "postop", "agent": "PostAnesthesiaEvaluator", "summary": f"{_claims(case, POSTOP_NOTE_ID)} claims"})

    emit("agent_start", {"stage": "postop", "agent": "ClaimVerifier"})
    verifier = ClaimVerifier(chat=fast_chat)
    verifier.verify(case, HANDOFF_ID)
    verifier.verify(case, POSTOP_NOTE_ID)
    emit("agent_end", {"stage": "postop", "agent": "ClaimVerifier", "summary": "verified"})
    emit("artifact_complete", {"artifact_id": POSTOP_NOTE_ID, "claims": _claims(case, POSTOP_NOTE_ID)})
    return case


def run_case_stages(case: Case, case_dir: Path | str, chat, fast_chat=None) -> Case:
    """Run all three stages end-to-end on one case."""
    fast_chat = fast_chat or chat
    run_preop_stage(case, case_dir, chat=chat, verifier_chat=fast_chat)
    run_intraop_stage(case, case_dir, chat=chat, fast_chat=fast_chat)
    run_postop_stage(case, case_dir, chat=chat, fast_chat=fast_chat)
    return case
