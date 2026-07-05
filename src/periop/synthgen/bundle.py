"""Case bundle assembly: one directory per synthetic case, resumable.

Layout (spec §7 data/cases/):

    sg-0001/
    ├── design.json               # CaseDesign (truth + flawed RecordView)
    ├── records/*.md              # prior-records pack (rendered from RecordView)
    ├── scripts/*.json            # diarized interview scripts + voice notes
    ├── gold/gold.json            # gold questions/events/claims/distractors
    └── audio/*.wav               # optional TTS renditions (separate script)

Every piece is skipped if its file already exists, so live generation can be
re-run after rate-limit interruptions and only fill in the gaps.
"""

import json
from pathlib import Path

from pydantic import BaseModel, Field

from periop.schemas import Event
from periop.synthgen.case_designer import CaseDesigner, design_case_id
from periop.synthgen.design import CaseDesign
from periop.synthgen.personas import Persona
from periop.synthgen.records import render_records_pack
from periop.synthgen.scripts import (
    GoldArtifacts,
    InterviewScript,
    IntraOpBundle,
    ScriptWriter,
)

PREOP_SCRIPT = "scripts/preop-interview.json"
INTRAOP_SCRIPT = "scripts/intraop-notes.json"
POSTOP_SCRIPT = "scripts/postop-interview.json"
GOLD_FILE = "gold/gold.json"
DESIGN_FILE = "design.json"


class GoldCase(BaseModel):
    """Everything the eval harness needs as ground truth for one case."""

    questions: list[str] = Field(description="Gap-analysis questions that must be asked")
    events: list[Event]
    preop_note_claims: list[str]
    handoff_claims: list[str]
    distractors: list[str] = Field(
        description="History items that must NOT surface in notes/handoffs"
    )


def _write_json(path: Path, model: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(model.model_dump_json(indent=2) + "\n")


def write_bundle(
    case_dir: Path,
    *,
    design: CaseDesign,
    persona: Persona,
    preop: InterviewScript,
    intraop: IntraOpBundle,
    postop: InterviewScript,
    gold_artifacts: GoldArtifacts,
) -> None:
    _write_json(case_dir / DESIGN_FILE, design)
    write_records(case_dir, design, persona)
    _write_json(case_dir / PREOP_SCRIPT, preop)
    _write_json(case_dir / INTRAOP_SCRIPT, intraop)
    _write_json(case_dir / POSTOP_SCRIPT, postop)
    _write_json(case_dir / GOLD_FILE, assemble_gold(design, intraop, gold_artifacts))


def write_records(case_dir: Path, design: CaseDesign, persona: Persona) -> None:
    records_dir = case_dir / "records"
    records_dir.mkdir(parents=True, exist_ok=True)
    for source_id, text in render_records_pack(design, persona).items():
        (records_dir / f"{source_id.removeprefix('doc:')}.md").write_text(text)


def assemble_gold(
    design: CaseDesign, intraop: IntraOpBundle, gold_artifacts: GoldArtifacts
) -> GoldCase:
    return GoldCase(
        questions=[design.defect.gold_question],
        events=intraop.events,
        preop_note_claims=gold_artifacts.preop_note_claims,
        handoff_claims=gold_artifacts.handoff_claims,
        distractors=[d.description for d in design.distractors],
    )


def load_gold(case_dir: Path) -> GoldCase:
    return GoldCase.model_validate_json((case_dir / GOLD_FILE).read_text())


def generate_case(persona: Persona, index: int, chat, out_root: Path | str) -> Path:
    """Generate (or resume generating) one case bundle. Returns the case dir."""
    case_dir = Path(out_root) / design_case_id(index)
    writer = ScriptWriter(chat=chat)

    design_path = case_dir / DESIGN_FILE
    if design_path.exists():
        design = CaseDesign.model_validate_json(design_path.read_text())
    else:
        design = CaseDesigner(chat=chat).design(persona, index=index)
        _write_json(design_path, design)

    write_records(case_dir, design, persona)  # deterministic, cheap to re-render

    preop_path = case_dir / PREOP_SCRIPT
    if not preop_path.exists():
        _write_json(preop_path, writer.preop_interview(design))

    intraop_path = case_dir / INTRAOP_SCRIPT
    if intraop_path.exists():
        intraop = IntraOpBundle.model_validate_json(intraop_path.read_text())
    else:
        intraop = writer.intraop(design)
        _write_json(intraop_path, intraop)

    postop_path = case_dir / POSTOP_SCRIPT
    if not postop_path.exists():
        _write_json(postop_path, writer.postop_interview(design))

    gold_path = case_dir / GOLD_FILE
    if not gold_path.exists():
        _write_json(gold_path, assemble_gold(design, intraop, writer.gold_artifacts(design)))

    return case_dir
