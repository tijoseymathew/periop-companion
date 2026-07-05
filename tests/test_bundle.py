"""Case bundle tests: one directory per case, resumable generation.

Rate limits are expected during live generation (spec instruction), so
generate_case skips any file that already exists — re-running after an
interruption completes only the missing pieces.
"""

import json

import pytest

from periop.synthgen.bundle import generate_case, load_gold, write_bundle
from periop.synthgen.design import CaseDesign
from periop.synthgen.scripts import GoldArtifacts, InterviewScript, IntraOpBundle
from tests.test_case_designer import make_design
from tests.test_personas import make_persona
from tests.test_scripts_gen import FakeChat, make_gold, make_interview, make_intraop


@pytest.fixture
def fake_chat():
    return FakeChat(
        {
            CaseDesign: make_design(),
            InterviewScript: make_interview(),
            IntraOpBundle: make_intraop(),
            GoldArtifacts: make_gold(),
        }
    )


class TestGenerateCase:
    def test_writes_complete_bundle(self, tmp_path, fake_chat):
        persona = make_persona("u1", 63, "Female")
        case_dir = generate_case(persona, index=1, chat=fake_chat, out_root=tmp_path)
        assert case_dir == tmp_path / "sg-0001"
        for rel in (
            "design.json",
            "records/gp-summary.md",
            "records/med-list.md",
            "records/op-plan.md",
            "records/prior-anesthetic-record.md",
            "scripts/preop-interview.json",
            "scripts/intraop-notes.json",
            "scripts/postop-interview.json",
            "gold/gold.json",
        ):
            assert (case_dir / rel).exists(), rel

    def test_gold_includes_defect_question_events_and_distractors(self, tmp_path, fake_chat):
        persona = make_persona("u1", 63, "Female")
        case_dir = generate_case(persona, index=1, chat=fake_chat, out_root=tmp_path)
        gold = load_gold(case_dir)
        assert make_design().defect.gold_question in gold.questions
        assert len(gold.events) == 3
        assert gold.preop_note_claims
        assert gold.distractors == [d.description for d in make_design().distractors]

    def test_resumable_generation_skips_existing(self, tmp_path, fake_chat):
        persona = make_persona("u1", 63, "Female")
        generate_case(persona, index=1, chat=fake_chat, out_root=tmp_path)
        first_calls = len(fake_chat.calls)
        generate_case(persona, index=1, chat=fake_chat, out_root=tmp_path)
        assert len(fake_chat.calls) == first_calls  # nothing regenerated

    def test_partial_bundle_completes_missing_pieces_only(self, tmp_path, fake_chat):
        persona = make_persona("u1", 63, "Female")
        case_dir = generate_case(persona, index=1, chat=fake_chat, out_root=tmp_path)
        (case_dir / "scripts/postop-interview.json").unlink()
        (case_dir / "gold/gold.json").unlink()
        before = len(fake_chat.calls)
        generate_case(persona, index=1, chat=fake_chat, out_root=tmp_path)
        # design/preop/intraop reused from disk; only postop + gold re-asked
        assert len(fake_chat.calls) == before + 2

    def test_design_reloaded_from_disk_matches(self, tmp_path, fake_chat):
        persona = make_persona("u1", 63, "Female")
        case_dir = generate_case(persona, index=1, chat=fake_chat, out_root=tmp_path)
        stored = CaseDesign.model_validate_json((case_dir / "design.json").read_text())
        assert stored == make_design()


class TestWriteBundle:
    def test_interview_json_is_diarized_turn_list(self, tmp_path):
        persona = make_persona("u1", 63, "Female")
        write_bundle(
            tmp_path / "sg-0001",
            design=make_design(),
            persona=persona,
            preop=make_interview(),
            intraop=make_intraop(),
            postop=make_interview(),
            gold_artifacts=make_gold(),
        )
        data = json.loads((tmp_path / "sg-0001/scripts/preop-interview.json").read_text())
        assert data["turns"][0]["speaker"] == "PROVIDER"
