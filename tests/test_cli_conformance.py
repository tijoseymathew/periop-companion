"""CLI lifecycle conformance (v2 §7, CLI edition): the terminal front end is
a re-plumbing, not a fork, of the batch pipeline.

The full three-provider walk of test_lifecycle_conformance, but every step is
a ``periop`` command against a served app whose runner is the real agents
driven by the deterministic scripted chat — and the resulting ledger must
match ``run_case_stages`` for the same bundle. Because the CLI drives the
same endpoints as the browser, this pins CLI == API == batch with one seam.
"""

import json
import shutil

import pytest

from periop.agents.stages import run_case_stages
from periop.api.app import create_app
from periop.cli.client import serve_app
from periop.cli.main import main
from periop.schemas import Case
from periop.store import CaseStore
from tests.test_full_stages import ScriptedChat
from tests.test_lifecycle_conformance import ScriptedChatRunner, bundle_dir  # noqa: F401
from tests.test_workflow_api import PROVIDERS


def walk_cli(tmp_path, bundle_dir, capsys) -> Case:
    """Drive one case through the entire provider workflow via the CLI."""
    case_root = tmp_path / "cli"
    out_dir = case_root / "_out"
    providers = tmp_path / "providers.json"
    providers.write_text(json.dumps(PROVIDERS))
    app = create_app(
        out_dir=out_dir,
        case_dir=case_root,
        providers_path=providers,
        runner=ScriptedChatRunner(),
    )

    def cli(*argv: str) -> str:
        code = main(["--api-url", base_url, *argv])
        out, err = capsys.readouterr()
        assert code == 0, err
        return out

    with serve_app(app) as base_url:
        # Dr A (pre-op clinic): create the case and paste the records
        case_id = cli("create", "Walkthrough", "--provider", "p-lim").strip()
        for md in sorted((bundle_dir / "records").glob("*.md")):
            cli("add-document", case_id, md.stem, str(md), "--provider", "p-lim")
        cli("approve-questions", case_id, "--provider", "p-lim")

        # the bundle's scripted encounters stand in for live recordings
        shutil.copytree(bundle_dir / "scripts", case_root / case_id / "scripts")

        # three different providers, one patient (v2 §11)
        for stage, provider in (
            ("preop", "p-lim"), ("intraop", "p-tan"), ("postop", "p-rahman"),
        ):
            cli("run", case_id, stage, "--provider", provider)
            cli("signoff", case_id, stage, "--provider", provider)
        cli("ack-handoff", case_id, "--provider", "p-rahman")

    return CaseStore(out_dir).load(case_id)


class TestCliConformance:
    def test_cli_walk_reproduces_batch_ledger(self, tmp_path, bundle_dir, capsys):
        walked = walk_cli(tmp_path, bundle_dir, capsys)
        batch = run_case_stages(
            Case(case_id="sg-0001"), bundle_dir, chat=ScriptedChat(), fast_chat=ScriptedChat()
        )

        assert walked.artifacts == batch.artifacts
        assert walked.intraop_events == batch.intraop_events
        assert walked.anticipated_issues == batch.anticipated_issues
        assert [q.question for q in walked.open_questions] == [
            q.question for q in batch.open_questions
        ]
        strip = {"captured_at", "provided_by"}
        assert [s.model_dump(exclude=strip) for s in walked.sources] == [
            s.model_dump(exclude=strip) for s in batch.sources
        ]

    def test_cli_walk_ends_fully_signed_off_and_acknowledged(
        self, tmp_path, bundle_dir, capsys
    ):
        walked = walk_cli(tmp_path, bundle_dir, capsys)
        stages = walked.workflow.stages
        assert all(s.status == "signed_off" for s in stages.values())
        assert stages["preop"].signed_off_by == "p-lim"
        assert stages["intraop"].signed_off_by == "p-tan"
        assert stages["postop"].signed_off_by == "p-rahman"
        assert stages["postop"].handoff_acknowledged_by == "p-rahman"
