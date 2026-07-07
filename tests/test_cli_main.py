"""Workflow CLI read commands: providers, list (worklist), show.

Each test drives ``periop.cli.main.main`` against one hosted stub-mode app
(the C1 transport), so the CLI sees exactly what a provider's terminal sees —
real HTTP, the API's own gates and error copy.
"""

import json
import subprocess
import sys
from datetime import datetime, timezone

import pytest

from periop.api.app import create_app
from periop.api.runner import StubPipelineRunner
from periop.cli.client import serve_app
from periop.cli.main import main
from periop.schemas import (
    ArtifactRecord,
    Case,
    Chunk,
    Claim,
    ClaimStatus,
    OpenQuestion,
    Provider,
    Source,
    SourceType,
    StageStatus,
    Workflow,
)
from periop.store import CaseStore

PROVIDERS = [
    {"provider_id": "p-lim", "name": "Dr A. Lim", "role": "consultant"},
    {"provider_id": "p-tan", "name": "Dr B. Tan", "role": "registrar"},
    {"provider_id": "p-rahman", "name": "Dr C. Rahman", "role": "consultant"},
]


def make_demo_case(case_id: str = "sg-0001") -> Case:
    """A seeded synthetic case: reviewable everywhere, writable nowhere."""
    return Case(
        case_id=case_id,
        sources=[
            Source(
                source_id="doc:gp-summary",
                type=SourceType.DOCUMENT,
                chunks=[Chunk(chunk_id="ch0", text="Aspirin 100 mg daily.")],
            )
        ],
        artifacts=[
            ArtifactRecord(
                artifact_id="note:pre-anesthesia-eval",
                claims=[
                    Claim(
                        claim_id="c-001",
                        text="Records list aspirin as current.",
                        provenance=["doc:gp-summary#ch0"],
                        status=ClaimStatus.CONFLICTING,
                    )
                ],
            )
        ],
    )


def make_live_case(case_id: str = "hip-repair") -> Case:
    case = Case(
        case_id=case_id,
        label="Hip repair",
        workflow=Workflow(
            created_by=Provider(**PROVIDERS[0]),
            created_at=datetime.now(timezone.utc),
        ),
        open_questions=[
            OpenQuestion(question="Still taking aspirin?", reason="conflicting")
        ],
    )
    case.workflow.stages["preop"].status = StageStatus.SIGNED_OFF
    case.workflow.stages["preop"].signed_off_by = "p-lim"
    case.workflow.stages["intraop"].status = StageStatus.AWAITING_REVIEW
    case.workflow.stages["intraop"].performed_by = "p-tan"
    return case


@pytest.fixture
def api(tmp_path):
    """One hosted stub-mode app; yields (base_url, store, case_root)."""
    providers = tmp_path / "providers.json"
    providers.write_text(json.dumps(PROVIDERS))
    case_root = tmp_path / "cases"
    out_dir = case_root / "_out"
    app = create_app(
        out_dir=out_dir,
        case_dir=case_root,
        providers_path=providers,
        runner=StubPipelineRunner(),
    )
    with serve_app(app) as base_url:
        yield base_url, CaseStore(out_dir), case_root


def run_cli(api, *argv: str, capsys=None) -> tuple[int, str, str]:
    base_url, _, _ = api
    code = main(["--api-url", base_url, *argv])
    out, err = capsys.readouterr()
    return code, out, err


class TestProviders:
    def test_lists_the_roster(self, api, capsys):
        code, out, _ = run_cli(api, "providers", capsys=capsys)
        assert code == 0
        assert "p-lim" in out and "Dr A. Lim (consultant)" in out
        assert out.count("\n") == 3


class TestList:
    def test_worklist_shows_headline_stage_and_status_in_words(self, api, capsys):
        _, store, _ = api
        store.save(make_live_case())
        code, out, _ = run_cli(api, "list", capsys=capsys)
        assert code == 0
        # headline = first non-signed-off stage (v2 §4)
        assert "hip-repair" in out
        assert "Intra-op — awaiting review" in out
        assert "Hip repair" in out

    def test_demo_cases_are_marked_read_only(self, api, capsys):
        _, store, _ = api
        store.save(make_demo_case())
        code, out, _ = run_cli(api, "list", capsys=capsys)
        assert code == 0
        assert "sg-0001" in out
        assert "demo — read-only" in out
        assert "1 claim" in out and "1 flagged" in out

    def test_fully_signed_off_case_reads_closed(self, api, capsys):
        _, store, _ = api
        case = make_live_case("done")
        for state in case.workflow.stages.values():
            state.status = StageStatus.SIGNED_OFF
        store.save(case)
        code, out, _ = run_cli(api, "list", capsys=capsys)
        assert "closed" in out


class TestShow:
    def test_shows_stages_questions_and_provenance(self, api, capsys):
        _, store, _ = api
        live = make_live_case()
        live.sources = make_demo_case().sources
        live.artifacts = make_demo_case().artifacts
        store.save(live)
        code, out, _ = run_cli(api, "show", "hip-repair", capsys=capsys)
        assert code == 0
        assert "Pre-op" in out and "signed off by p-lim" in out
        assert "Intra-op" in out and "awaiting review" in out
        assert "Still taking aspirin?" in out and "conflicting" in out
        # the claim ledger renders with the exact cited span (cli.render)
        assert "note:pre-anesthesia-eval" in out
        assert 'Aspirin 100 mg daily.' in out

    def test_unknown_case_exits_1_with_the_api_detail(self, api, capsys):
        code, _, err = run_cli(api, "show", "nope", capsys=capsys)
        assert code == 1
        assert "no such case: nope" in err


class TestEntryPoints:
    def test_module_entry_point(self):
        proc = subprocess.run(
            [sys.executable, "-m", "periop.cli", "--help"],
            capture_output=True, text=True,
        )
        assert proc.returncode == 0
        assert "providers" in proc.stdout and "show" in proc.stdout

    def test_console_script_is_declared(self):
        from importlib.metadata import entry_points

        scripts = entry_points(group="console_scripts", name="periop")
        assert [ep.value for ep in scripts] == ["periop.cli.main:main"]
