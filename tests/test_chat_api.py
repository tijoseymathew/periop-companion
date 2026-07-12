"""Chat + equipment endpoints (SSE turn stream, history, stock view feed)."""

import pytest
from fastapi.testclient import TestClient

from periop.api.app import create_app
from periop.api.runner import StubChatRuntime
from periop.equipment import CATALOG, EquipmentStore
from periop.schemas import Case, Chunk, Source, SourceType
from periop.store import CaseStore


def make_case(case_id: str) -> Case:
    return Case(
        case_id=case_id,
        sources=[
            Source(
                source_id="doc:gp-summary",
                type=SourceType.DOCUMENT,
                chunks=[Chunk(chunk_id="c001", text="On aspirin 100mg daily.", section="Medications")],
            )
        ],
    )


@pytest.fixture
def client(tmp_path):
    out_dir = tmp_path / "_out"
    CaseStore(out_dir).save(make_case("sg-0001"))
    app = create_app(
        out_dir=out_dir, case_dir=tmp_path, chat_runtime=StubChatRuntime(out_dir)
    )
    return TestClient(app)


def sse_events(text: str) -> list[tuple[str, str]]:
    events = []
    for block in text.split("\n\n"):
        event = data = None
        for line in block.split("\n"):
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = line[6:]
        if event:
            events.append((event, data or ""))
    return events


class TestEquipmentEndpoint:
    def test_full_catalog_with_availability(self, client):
        items = client.get("/api/equipment").json()
        assert len(items) == len(CATALOG)
        assert all(i["available"] == i["total"] for i in items)

    def test_reservations_surface_per_item(self, client, tmp_path):
        EquipmentStore(tmp_path / "_out").reserve("ett-7.0", "sg-0001", 2, "p-lim")
        item = next(i for i in client.get("/api/equipment").json() if i["item_id"] == "ett-7.0")
        assert item["reserved"] == 2
        assert item["available"] == item["total"] - 2
        assert item["reservations"][0]["case_id"] == "sg-0001"


class TestChatEndpoints:
    def test_turn_streams_tools_then_reply(self, client):
        resp = client.post(
            "/api/cases/sg-0001/chat",
            json={"message": "what about aspirin?", "provider_id": "p-lim"},
        )
        assert resp.status_code == 200
        kinds = [e for e, _ in sse_events(resp.text)]
        assert kinds == ["tool_call", "tool_result", "reply"]
        assert "aspirin" in resp.text

    def test_history_round_trips(self, client):
        client.post(
            "/api/cases/sg-0001/chat",
            json={"message": "what about aspirin?", "provider_id": "p-lim"},
        )
        history = client.get("/api/cases/sg-0001/chat").json()
        assert [m["role"] for m in history] == ["user", "assistant"]
        assert history[0]["text"] == "what about aspirin?"

    def test_reserve_message_updates_the_ledger(self, client, tmp_path):
        client.post(
            "/api/cases/sg-0001/chat",
            json={"message": "please order an ET tube", "provider_id": "p-tan"},
        )
        held = EquipmentStore(tmp_path / "_out").case_reservations("sg-0001")
        assert [(r.item_id, r.by) for r in held] == [("ett-7.0", "p-tan")]

    def test_unknown_case_404(self, client):
        assert client.get("/api/cases/nope/chat").status_code == 404
        resp = client.post(
            "/api/cases/nope/chat", json={"message": "hi", "provider_id": "p-lim"}
        )
        assert resp.status_code == 404

    def test_unknown_provider_404(self, client):
        resp = client.post(
            "/api/cases/sg-0001/chat", json={"message": "hi", "provider_id": "p-nobody"}
        )
        assert resp.status_code == 404

    def test_blank_message_422(self, client):
        resp = client.post(
            "/api/cases/sg-0001/chat", json={"message": "   ", "provider_id": "p-lim"}
        )
        assert resp.status_code == 422

    def test_empty_history_for_untouched_case(self, client):
        assert client.get("/api/cases/sg-0001/chat").json() == []
