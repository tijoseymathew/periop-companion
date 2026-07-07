"""Lifecycle conformance (spec v2 §7): the workflow layer is a re-plumbing,
not a fork, of the batch pipeline.

A scripted API client walks a synthetic bundle through the full provider
workflow — create → upload the bundle's own records → approve questions →
provide the interview/memo transcripts → run each stage → sign off — and the
resulting ledger must match what `run_case_stages` produces for the same
bundle with the same scripted chats.
"""

import shutil

import pytest
from fastapi.testclient import TestClient

from periop.agents.gap_analyst import GapAnalyst
from periop.agents.preop_stage import run_preop_stage
from periop.agents.stages import run_case_stages, run_intraop_stage, run_postop_stage
from periop.api.app import create_app
from periop.schemas import Case
from periop.store import CaseStore
from periop.synthgen.bundle import write_bundle
from tests.test_case_designer import make_design
from tests.test_full_stages import ScriptedChat
from tests.test_personas import make_persona
from tests.test_scripts_gen import make_gold, make_interview, make_intraop
from tests.test_workflow_api import PROVIDERS


class ScriptedChatRunner:
    """The real agents driven by the deterministic scripted chat."""

    def analyze_gaps(self, case):
        GapAnalyst(chat=ScriptedChat()).analyze(case)

    def run_stage(self, case, stage, case_dir, emit):
        chat = ScriptedChat()
        if stage == "preop":
            return run_preop_stage(case, case_dir, chat=chat, verifier_chat=chat, emit=emit)
        if stage == "intraop":
            return run_intraop_stage(case, case_dir, chat=chat, fast_chat=chat, emit=emit)
        return run_postop_stage(case, case_dir, chat=chat, fast_chat=chat, emit=emit)


@pytest.fixture
def bundle_dir(tmp_path):
    d = tmp_path / "bundle" / "sg-0001"
    write_bundle(
        d,
        design=make_design(),
        persona=make_persona("u1", 63, "Female"),
        preop=make_interview("I stopped the aspirin six days ago, doctor."),
        intraop=make_intraop(),
        postop=make_interview("No pain and no nausea, doctor."),
        gold_artifacts=make_gold(),
    )
    return d


def walk_workflow(tmp_path, bundle_dir) -> Case:
    """Drive one case through the entire provider workflow via the API."""
    case_root = tmp_path / "api"
    out_dir = case_root / "_out"
    providers = tmp_path / "providers.json"
    import json

    providers.write_text(json.dumps(PROVIDERS))
    # lifespan-entered: stage runs execute inside the NAT session (v2-nat §3.2)
    with TestClient(
        create_app(
            out_dir=out_dir,
            case_dir=case_root,
            providers_path=providers,
            runner=ScriptedChatRunner(),
        )
    ) as client:
        return _walk(client, case_root, bundle_dir, out_dir)


def _walk(client, case_root, bundle_dir, out_dir) -> Case:
    # Dr A (pre-op clinic): create the case and paste the records
    case_id = client.post(
        "/api/cases", json={"label": "Walkthrough", "provider_id": "p-lim"}
    ).json()["case_id"]
    for md in sorted((bundle_dir / "records").glob("*.md")):
        resp = client.post(
            f"/api/cases/{case_id}/sources/document",
            json={"doc_type": md.stem, "text": md.read_text(), "provider_id": "p-lim"},
        )
        assert resp.status_code == 201, resp.text

    # questions arrived from the GapAnalyst; approve them unchanged
    case = Case.model_validate(client.get(f"/api/cases/{case_id}").json())
    assert case.open_questions, "GapAnalyst should have run at intake"
    reviewed = [
        {**q.model_dump(mode="json"), "review": "approved"} for q in case.open_questions
    ]
    assert (
        client.put(
            f"/api/cases/{case_id}/questions",
            json={"questions": reviewed, "provider_id": "p-lim"},
        ).status_code
        == 200
    )

    # the bundle's scripted encounters stand in for live recordings
    shutil.copytree(bundle_dir / "scripts", case_root / case_id / "scripts")

    def run_and_sign(stage: str, provider: str) -> None:
        resp = client.post(
            f"/api/cases/{case_id}/stages/{stage}/run", json={"provider_id": provider}
        )
        assert resp.status_code == 200, resp.text
        assert "event: complete" in resp.text, resp.text
        resp = client.post(
            f"/api/cases/{case_id}/stages/{stage}/signoff", json={"provider_id": provider}
        )
        assert resp.status_code == 200, resp.text

    # three different providers, one patient (v2 §11)
    run_and_sign("preop", "p-lim")
    run_and_sign("intraop", "p-tan")
    run_and_sign("postop", "p-rahman")
    assert (
        client.post(
            f"/api/cases/{case_id}/handoff/ack", json={"provider_id": "p-rahman"}
        ).status_code
        == 200
    )
    return CaseStore(out_dir).load(case_id)


class TestLifecycleConformance:
    def test_workflow_walk_reproduces_batch_ledger(self, tmp_path, bundle_dir):
        walked = walk_workflow(tmp_path, bundle_dir)
        batch = run_case_stages(
            Case(case_id="sg-0001"), bundle_dir, chat=ScriptedChat(), fast_chat=ScriptedChat()
        )

        # the ledger — artifacts, claims, provenance, verification states —
        # must be identical
        assert walked.artifacts == batch.artifacts
        assert walked.intraop_events == batch.intraop_events
        assert walked.anticipated_issues == batch.anticipated_issues
        assert [q.question for q in walked.open_questions] == [
            q.question for q in batch.open_questions
        ]
        # sources match modulo live-capture attribution metadata
        strip = {"captured_at", "provided_by"}
        assert [s.model_dump(exclude=strip) for s in walked.sources] == [
            s.model_dump(exclude=strip) for s in batch.sources
        ]

    def test_walk_ends_fully_signed_off_and_acknowledged(self, tmp_path, bundle_dir):
        walked = walk_workflow(tmp_path, bundle_dir)
        stages = walked.workflow.stages
        assert all(s.status == "signed_off" for s in stages.values())
        assert stages["preop"].signed_off_by == "p-lim"
        assert stages["intraop"].signed_off_by == "p-tan"
        assert stages["postop"].signed_off_by == "p-rahman"
        assert stages["postop"].handoff_acknowledged_by == "p-rahman"
