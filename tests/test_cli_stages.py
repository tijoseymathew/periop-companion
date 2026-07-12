"""Workflow CLI stage commands: add-audio, run (SSE progress), signoff,
reopen, ack-handoff.

`run` renders the ui.md §7 SSE vocabulary as progress lines and — because it
drives the same stage-run endpoint as the browser — executes inside the
shared NAT ``Runner`` (v2-nat §3.2), pinned here by the nat_bridge log
bracket exactly as in test_workflow_api.
"""

import logging

from tests.test_cli_intake import OP_PLAN, intake_to_questions
from tests.test_cli_main import api, run_cli  # noqa: F401
from tests.test_workflow_api import make_wav


def preop_ready(api, capsys, tmp_path) -> str:
    """Intake + approved questions + recorded interview: ready to generate."""
    case_id = intake_to_questions(api, capsys)
    run_cli(api, "approve-questions", case_id, "--provider", "p-lim", capsys=capsys)
    wav = tmp_path / "interview.wav"
    wav.write_bytes(make_wav())
    code, _, err = run_cli(
        api, "add-audio", case_id, "preop-interview", str(wav),
        "--provider", "p-lim", capsys=capsys,
    )
    assert code == 0, err
    return case_id


class TestAddAudio:
    def test_uploads_and_reports_the_stage_ready(self, api, capsys, tmp_path):
        case_id = intake_to_questions(api, capsys)
        wav = tmp_path / "a.wav"
        wav.write_bytes(make_wav())
        code, out, _ = run_cli(
            api, "add-audio", case_id, "preop-interview", str(wav),
            "--provider", "p-lim", capsys=capsys,
        )
        assert code == 0
        assert "preop-interview" in out
        _, store, _ = api
        assert store.load(case_id).workflow.stages["preop"].inputs_recorded_at

    def test_interview_replacement_needs_confirm(self, api, capsys, tmp_path):
        case_id = preop_ready(api, capsys, tmp_path)
        wav = tmp_path / "b.wav"
        wav.write_bytes(make_wav())
        code, _, err = run_cli(
            api, "add-audio", case_id, "preop-interview", str(wav),
            "--provider", "p-lim", capsys=capsys,
        )
        assert code == 1
        assert "already recorded" in err
        code, _, _ = run_cli(
            api, "add-audio", case_id, "preop-interview", str(wav), "--confirm",
            "--provider", "p-lim", capsys=capsys,
        )
        assert code == 0


class TestRun:
    def test_streams_progress_and_lands_awaiting_review(self, api, capsys, tmp_path):
        case_id = preop_ready(api, capsys, tmp_path)
        code, out, _ = run_cli(
            api, "run", case_id, "preop", "--provider", "p-lim", capsys=capsys
        )
        assert code == 0
        # SSE progress rendered as lines, not a spinner (v2 §2)
        assert "PreOpNoteWriter" in out
        assert "note:pre-anesthesia-eval" in out
        assert f"periop signoff {case_id} preop" in out
        _, store, _ = api
        case = store.load(case_id)
        assert case.workflow.stages["preop"].status == "awaiting_review"
        assert case.get_artifact("note:pre-anesthesia-eval") is not None

    def test_gate_failures_surface_the_next_action(self, api, capsys):
        case_id = intake_to_questions(api, capsys)  # questions not approved
        code, _, err = run_cli(
            api, "run", case_id, "preop", "--provider", "p-lim", capsys=capsys
        )
        assert code == 1
        assert "approve the clarification questions" in err

    def test_runs_inside_the_shared_nat_runner(self, api, capsys, tmp_path, caplog):
        case_id = preop_ready(api, capsys, tmp_path)
        with caplog.at_level(logging.INFO, logger="periop.api.nat_bridge"):
            code, _, _ = run_cli(
                api, "run", case_id, "preop", "--provider", "p-lim", capsys=capsys
            )
        assert code == 0
        msg = next(
            (r.getMessage() for r in caplog.records if "WORKFLOW_START" in r.getMessage()),
            None,
        )
        assert msg is not None, "stage run never crossed the NAT bridge"
        assert msg.index("WORKFLOW_START") < msg.index("WORKFLOW_END")


def signed_off_preop(api, capsys, tmp_path) -> str:
    case_id = preop_ready(api, capsys, tmp_path)
    run_cli(api, "run", case_id, "preop", "--provider", "p-lim", capsys=capsys)
    code, _, err = run_cli(
        api, "signoff", case_id, "preop", "--provider", "p-lim", capsys=capsys
    )
    assert code == 0, err
    return case_id


class TestSignoffReopen:
    def test_signoff_stamps_the_stage(self, api, capsys, tmp_path):
        case_id = signed_off_preop(api, capsys, tmp_path)
        _, store, _ = api
        state = store.load(case_id).workflow.stages["preop"]
        assert state.status == "signed_off"
        assert state.signed_off_by == "p-lim"

    def test_signoff_without_artifacts_exits_1(self, api, capsys, tmp_path):
        case_id = preop_ready(api, capsys, tmp_path)
        code, _, err = run_cli(
            api, "signoff", case_id, "preop", "--provider", "p-lim", capsys=capsys
        )
        assert code == 1
        assert "generate the preop output first" in err

    def test_reopen_returns_the_stage_to_review(self, api, capsys, tmp_path):
        case_id = signed_off_preop(api, capsys, tmp_path)
        code, out, _ = run_cli(
            api, "reopen", case_id, "preop", "--provider", "p-tan", capsys=capsys
        )
        assert code == 0
        _, store, _ = api
        state = store.load(case_id).workflow.stages["preop"]
        assert state.status == "awaiting_review"
        assert state.reopens[0].reopened_by == "p-tan"


class TestFullWalkAndAck:
    def test_three_providers_to_acknowledged_handoff(self, api, capsys, tmp_path):
        case_id = signed_off_preop(api, capsys, tmp_path)

        def stage(kind: str, stage: str, provider: str) -> None:
            wav = tmp_path / f"{kind}.wav"
            wav.write_bytes(make_wav())
            code, _, err = run_cli(
                api, "add-audio", case_id, kind, str(wav),
                "--provider", provider, capsys=capsys,
            )
            assert code == 0, err
            code, _, err = run_cli(
                api, "run", case_id, stage, "--provider", provider, capsys=capsys
            )
            assert code == 0, err
            code, _, err = run_cli(
                api, "signoff", case_id, stage, "--provider", provider, capsys=capsys
            )
            assert code == 0, err

        stage("intraop-notes", "intraop", "p-tan")
        stage("postop-interview", "postop", "p-rahman")
        code, out, _ = run_cli(
            api, "ack-handoff", case_id, "--provider", "p-rahman", capsys=capsys
        )
        assert code == 0
        _, store, _ = api
        stages = store.load(case_id).workflow.stages
        assert all(s.status == "signed_off" for s in stages.values())
        assert stages["postop"].handoff_acknowledged_by == "p-rahman"
