"""Case chatbot: search helper, ADK tool loop, and the ordering tools' gates.

The runtime is exercised with a scripted ``complete_chat`` double — each
entry is one OpenAI-shaped assistant message (text or tool_calls) — so the
tests drive the real ADK agent, the real ``ToolChatModel`` translation, and
the real tools against a real on-disk case and equipment ledger, with only
the NIM scripted.
"""

import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from periop.agents.case_chat import CaseChatRuntime, search_case_texts
from periop.equipment import EquipmentStore
from periop.schemas import (
    ArtifactRecord,
    AudioSegment,
    Case,
    Chunk,
    Claim,
    Provider,
    Source,
    SourceType,
    StageName,
    StageStatus,
    Workflow,
)
from periop.store import CaseStore


def make_case(case_id: str = "sg-0001", live: bool = True) -> Case:
    case = Case(
        case_id=case_id,
        sources=[
            Source(
                source_id="doc:gp-summary",
                type=SourceType.DOCUMENT,
                chunks=[
                    Chunk(chunk_id="c001", text="On aspirin 100mg daily.", section="Medications"),
                    Chunk(chunk_id="c002", text="Type 2 diabetes on metformin.", section="History"),
                ],
            ),
            Source(
                source_id="audio:preop-interview",
                type=SourceType.AUDIO,
                segments=[
                    AudioSegment(
                        seg_id="s017", t0=214.3, t1=221.8, speaker="PATIENT",
                        text="I stopped the aspirin last Tuesday.",
                    )
                ],
            ),
        ],
        artifacts=[
            ArtifactRecord(
                artifact_id="note:pre-anesthesia-eval",
                claims=[
                    Claim(
                        claim_id="c-001",
                        text="Aspirin was discontinued 6 days prior to surgery.",
                        provenance=["audio:preop-interview#s017"],
                    )
                ],
            )
        ],
    )
    if live:
        case.workflow = Workflow(
            created_by=Provider(provider_id="p-lim", name="Dr A. Lim", role="consultant"),
            created_at=datetime.now(timezone.utc),
        )
    return case


def tool_call_reply(name: str, args: dict, call_id: str = "call-1"):
    return SimpleNamespace(
        content=None,
        tool_calls=[
            SimpleNamespace(
                id=call_id,
                function=SimpleNamespace(name=name, arguments=json.dumps(args)),
            )
        ],
    )


def text_reply(text: str):
    return SimpleNamespace(content=text, tool_calls=None)


class ScriptedToolChat:
    """``complete_chat`` double: pops one scripted assistant message per call."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def complete_chat(self, messages, tools=None, **kwargs):
        self.calls.append({"messages": messages, "tools": tools})
        return self.script.pop(0)


@pytest.fixture
def out_dir(tmp_path):
    return tmp_path / "_out"


def runtime_with(out_dir, script) -> tuple[CaseChatRuntime, ScriptedToolChat]:
    chat = ScriptedToolChat(script)
    return CaseChatRuntime(out_dir, chat_factory=lambda: chat), chat


class TestSearchCaseTexts:
    def test_finds_chunks_segments_and_claims(self):
        hits = search_case_texts(make_case(), "aspirin stopped")
        refs = [h["ref"] for h in hits]
        assert "audio:preop-interview#s017" in refs
        assert "doc:gp-summary#c001" in refs
        assert "note:pre-anesthesia-eval#c-001" in refs

    def test_best_match_first(self):
        hits = search_case_texts(make_case(), "stopped aspirin last tuesday")
        assert hits[0]["ref"] == "audio:preop-interview#s017"
        assert hits[0]["kind"] == "transcript"
        assert hits[0]["speaker"] == "PATIENT"

    def test_no_match_is_empty(self):
        assert search_case_texts(make_case(), "penicillin sensitivity") == []

    def test_inflection_does_not_hide_facts(self):
        case = make_case()
        case.sources[0].chunks.append(
            Chunk(chunk_id="c003", text="No known drug allergies.", section="Allergies")
        )
        assert [h["ref"] for h in search_case_texts(case, "allergy")] == [
            "doc:gp-summary#c003"
        ]
        # and the reverse: a plural query finds the singular text
        assert search_case_texts(case, "diabetes metformin tablets")[0]["ref"] == (
            "doc:gp-summary#c002"
        )


class TestChatToolLoop:
    def test_search_then_answer(self, out_dir):
        CaseStore(out_dir).save(make_case())
        runtime, chat = runtime_with(
            out_dir,
            [
                tool_call_reply("search_case", {"query": "aspirin"}),
                text_reply("The patient stopped aspirin last Tuesday (pre-op interview)."),
            ],
        )
        events = []
        reply = runtime.send(
            "sg-0001", "Is the patient on aspirin?", "p-lim",
            lambda e, d: events.append((e, d)),
        )
        assert "stopped aspirin last Tuesday" in reply

        # the model was offered the case tools, OpenAI-shaped
        tool_names = {t["function"]["name"] for t in chat.calls[0]["tools"]}
        assert {"search_case", "read_source", "reserve_equipment"} <= tool_names

        # the tool round-trip surfaced as progress events with real results
        kinds = [e for e, _ in events]
        assert kinds == ["tool_call", "tool_result"]
        result = events[1][1]["result"]
        refs = [r["ref"] for r in result["results"]]
        assert "doc:gp-summary#c001" in refs

        # the second model call saw the tool response
        roles = [m["role"] for m in chat.calls[1]["messages"]]
        assert "tool" in roles

    def test_multi_turn_history_accumulates(self, out_dir):
        CaseStore(out_dir).save(make_case())
        runtime, chat = runtime_with(
            out_dir, [text_reply("Hello."), text_reply("Again.")]
        )
        runtime.send("sg-0001", "hi", "p-lim", lambda e, d: None)
        runtime.send("sg-0001", "hi again", "p-lim", lambda e, d: None)
        history = runtime.history("sg-0001")
        assert [m["role"] for m in history] == ["user", "assistant", "user", "assistant"]
        # the second turn's model call carried the first turn's transcript
        user_texts = [
            m["content"] for m in chat.calls[1]["messages"] if m["role"] == "user"
        ]
        assert any("hi" == t for t in user_texts)

    def test_history_empty_before_first_turn(self, out_dir):
        runtime, _ = runtime_with(out_dir, [])
        assert runtime.history("sg-0001") == []


class TestOrderingTools:
    def test_reserve_assigns_stock_to_the_case(self, out_dir):
        CaseStore(out_dir).save(make_case())
        runtime, _ = runtime_with(
            out_dir,
            [
                tool_call_reply("reserve_equipment", {"item_id": "ett-7.0", "quantity": 2}),
                text_reply("Reserved 2 endotracheal tubes 7.0 for this case."),
            ],
        )
        events = []
        runtime.send(
            "sg-0001", "Please order two size 7 ET tubes", "p-tan",
            lambda e, d: events.append((e, d)),
        )
        held = EquipmentStore(out_dir).case_reservations("sg-0001")
        assert [(r.item_id, r.qty, r.by) for r in held] == [("ett-7.0", 2, "p-tan")]
        assert events[1][1]["result"]["reserved"]["name"] == "Endotracheal tube 7.0 mm"

    def test_demo_case_cannot_order(self, out_dir):
        CaseStore(out_dir).save(make_case(live=False))
        runtime, _ = runtime_with(
            out_dir,
            [
                tool_call_reply("reserve_equipment", {"item_id": "ett-7.0", "quantity": 1}),
                text_reply("Ordering is disabled on this demo case."),
            ],
        )
        events = []
        runtime.send("sg-0001", "order an ET tube", "p-lim", lambda e, d: events.append((e, d)))
        assert "demo case" in events[1][1]["result"]["error"]
        assert EquipmentStore(out_dir).case_reservations("sg-0001") == []

    def test_ordering_closes_after_preop_signoff(self, out_dir):
        case = make_case()
        case.workflow.stages[StageName.PREOP].status = StageStatus.SIGNED_OFF
        CaseStore(out_dir).save(case)
        runtime, _ = runtime_with(
            out_dir,
            [
                tool_call_reply("reserve_equipment", {"item_id": "ett-7.0", "quantity": 1}),
                text_reply("Ordering closed."),
            ],
        )
        events = []
        runtime.send("sg-0001", "order an ET tube", "p-lim", lambda e, d: events.append((e, d)))
        assert "signed off" in events[1][1]["result"]["error"]
        assert EquipmentStore(out_dir).case_reservations("sg-0001") == []

    def test_out_of_stock_reported_not_raised(self, out_dir):
        CaseStore(out_dir).save(make_case())
        EquipmentStore(out_dir).reserve("bis-monitor", "sg-9999", 2, "p-lim")
        runtime, _ = runtime_with(
            out_dir,
            [
                tool_call_reply("reserve_equipment", {"item_id": "bis-monitor", "quantity": 1}),
                text_reply("The BIS monitors are all assigned."),
            ],
        )
        events = []
        reply = runtime.send(
            "sg-0001", "order a BIS monitor", "p-lim", lambda e, d: events.append((e, d))
        )
        assert "only 0" in events[1][1]["result"]["error"]
        assert reply == "The BIS monitors are all assigned."
