"""Stage functions: pure Case → Case transforms for the three peri-op phases.

M0 stubs: each stage appends its artifact(s) with no claims. M2/M3 replace
the bodies with real agent calls (GapAnalyst, note writers, HandoffComposer)
behind the same signatures, so the ADK/NAT orchestration seam never moves.
"""

from periop.schemas import ArtifactRecord, Case

PREOP_NOTE_ID = "note:pre-anesthesia-eval"
INTRAOP_RECORD_ID = "record:intra-op"
PACU_HANDOFF_ID = "note:pacu-handoff"
POSTOP_NOTE_ID = "note:post-anesthesia-eval"


def _require(case: Case, artifact_id: str, stage: str) -> None:
    if case.get_artifact(artifact_id) is None:
        raise ValueError(f"{stage} requires {artifact_id} — run the earlier stage first")


def run_preop(case: Case) -> Case:
    """Pre-op stage: record ingestion, gap analysis, interview, note writing."""
    case.add_artifact(ArtifactRecord(artifact_id=PREOP_NOTE_ID))
    return case


def run_intraop(case: Case) -> Case:
    """Intra-op stage: voice-note transcription, event extraction, record."""
    _require(case, PREOP_NOTE_ID, "intra-op stage")
    case.add_artifact(ArtifactRecord(artifact_id=INTRAOP_RECORD_ID))
    return case


def run_postop(case: Case) -> Case:
    """Post-op stage: PACU handoff composition + post-anesthesia evaluation."""
    _require(case, INTRAOP_RECORD_ID, "post-op stage")
    case.add_artifact(ArtifactRecord(artifact_id=PACU_HANDOFF_ID))
    case.add_artifact(ArtifactRecord(artifact_id=POSTOP_NOTE_ID))
    return case
