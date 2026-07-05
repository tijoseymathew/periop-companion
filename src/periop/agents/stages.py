"""Stage orchestration for intra-op and post-op, plus a full-case runner.

Each stage is a Case → Case transform that registers its sources and appends
its artifacts. `chat` is the reasoning tier; `fast_chat` is the fast tier used
for the event-extraction first pass and claim verification. Both are injected
(live NimChat, or stubs in tests).
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
from periop.tools.ingest import transcript_source


def run_intraop_stage(case: Case, case_dir: Path | str, chat, fast_chat=None) -> Case:
    case_dir = Path(case_dir)
    fast_chat = fast_chat or chat

    notes = case_dir / "scripts" / "intraop-notes.json"
    if notes.exists() and case.get_source("audio:intraop-notes") is None:
        case.add_source(transcript_source(case_dir, "intraop-notes", "audio:intraop-notes"))

    events = EventExtractor(fast_chat=fast_chat, reasoning_chat=chat).extract(
        case, "audio:intraop-notes"
    )
    IntraOpRecordWriter(chat=chat).write(case, events)
    IssueAnticipator(chat=chat).anticipate(case)
    verifier = ClaimVerifier(chat=fast_chat)
    verifier.verify(case, INTRAOP_RECORD_ID)
    verifier.verify(case, ANTICIPATED_ISSUES_ID, forward_looking=True)
    return case


def run_postop_stage(case: Case, case_dir: Path | str, chat, fast_chat=None) -> Case:
    case_dir = Path(case_dir)
    fast_chat = fast_chat or chat

    postop = case_dir / "scripts" / "postop-interview.json"
    if postop.exists() and case.get_source("audio:postop-interview") is None:
        case.add_source(transcript_source(case_dir, "postop-interview", "audio:postop-interview"))

    HandoffComposer(chat=chat).compose(case)
    PostAnesthesiaEvaluator(chat=chat).write(case)
    verifier = ClaimVerifier(chat=fast_chat)
    verifier.verify(case, HANDOFF_ID)
    verifier.verify(case, POSTOP_NOTE_ID)
    return case


def run_case_stages(case: Case, case_dir: Path | str, chat, fast_chat=None) -> Case:
    """Run all three stages end-to-end on one case."""
    fast_chat = fast_chat or chat
    run_preop_stage(case, case_dir, chat=chat, verifier_chat=fast_chat)
    run_intraop_stage(case, case_dir, chat=chat, fast_chat=fast_chat)
    run_postop_stage(case, case_dir, chat=chat, fast_chat=fast_chat)
    return case
