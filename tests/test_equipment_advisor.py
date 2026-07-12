"""EquipmentAdvisor: the PreOpNoteWriter's equipment-suggestion tool loop.

Exercised with a scripted ``complete_chat`` double — each entry one
OpenAI-shaped assistant message — so the tests drive the real ADK agent, the
real ``ToolChatModel`` translation, and the real ``suggest_equipment`` tool,
with only the NIM scripted (same pattern as ``test_case_chat``).
"""

import json
from types import SimpleNamespace

from google.adk.agents import LoopAgent, SequentialAgent

from periop.adk.runtime import run_agent
from periop.adk.stages import preop_note_step
from periop.agents.equipment_advisor import MAX_SUGGESTIONS, equipment_advisor_step
from periop.schemas import (
    ArtifactRecord,
    Case,
    Chunk,
    Claim,
    EquipmentSuggestion,
    Source,
    SourceType,
)


def tool_call(name: str, args: dict, call_id: str = "call-1"):
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


def make_case() -> Case:
    return Case(
        case_id="sg-0001",
        sources=[
            Source(
                source_id="doc:op-plan",
                type=SourceType.DOCUMENT,
                chunks=[
                    Chunk(
                        chunk_id="c001",
                        text="Laparoscopic cholecystectomy under general anaesthesia.",
                    )
                ],
            )
        ],
        artifacts=[
            ArtifactRecord(
                artifact_id="note:pre-anesthesia-eval",
                claims=[
                    Claim(
                        claim_id="c-001",
                        text="Mallampati III with limited neck extension.",
                        provenance=["doc:op-plan#c001"],
                    )
                ],
            )
        ],
    )


def run_advisor(case: Case, script) -> tuple[Case, ScriptedToolChat, list]:
    chat = ScriptedToolChat(script)
    events: list[tuple[str, dict]] = []
    result, _ = run_agent(
        equipment_advisor_step(chat), case, emit_fn=lambda e, d: events.append((e, d))
    )
    return result, chat, events


class TestSuggestEquipment:
    def test_suggestions_land_on_the_case(self):
        result, chat, events = run_advisor(
            make_case(),
            [
                tool_call(
                    "suggest_equipment",
                    {"item_id": "video-laryngoscope", "reason": "Mallampati III airway."},
                ),
                tool_call(
                    "suggest_equipment",
                    {"item_id": "ett-7.0", "reason": "General anaesthesia planned."},
                    call_id="call-2",
                ),
                text_reply("Suggested a video laryngoscope and a 7.0 ETT."),
            ],
        )
        assert [s.item_id for s in result.equipment_suggestions] == [
            "video-laryngoscope",
            "ett-7.0",
        ]
        # names ride denormalized from the catalog
        assert result.equipment_suggestions[0].name == "Video laryngoscope"
        assert result.equipment_suggestions[0].reason == "Mallampati III airway."

        # the SSE bracket around the tool loop
        assert ("agent_start", {"stage": "preop", "agent": "EquipmentAdvisor"}) in events
        end = next(d for e, d in events if e == "agent_end")
        assert end["summary"] == "2 equipment suggestions"
        assert any("Video laryngoscope" in line for line in end["preview"])

    def test_instruction_carries_catalog_and_case(self):
        _, chat, _ = run_advisor(make_case(), [text_reply("Nothing needed.")])
        system = chat.calls[0]["messages"][0]
        assert system["role"] == "system"
        assert "video-laryngoscope" in system["content"]  # the store list
        assert "Mallampati III" in system["content"]  # the fresh note
        assert "Laparoscopic cholecystectomy" in system["content"]  # the op plan
        tools = chat.calls[0]["tools"]
        assert [t["function"]["name"] for t in tools] == ["suggest_equipment"]

    def test_unknown_item_is_rejected(self):
        result, chat, _ = run_advisor(
            make_case(),
            [
                tool_call("suggest_equipment", {"item_id": "ecmo", "reason": "why not"}),
                text_reply("Understood."),
            ],
        )
        assert result.equipment_suggestions == []
        # the error came back through the tool loop for the model to read
        tool_msgs = [m for m in chat.calls[1]["messages"] if m["role"] == "tool"]
        assert "no such equipment item" in tool_msgs[0]["content"]

    def test_cap_at_three_suggestions(self):
        items = ["ett-7.0", "bougie", "fluid-warmer", "bis-monitor"]
        script = [
            tool_call("suggest_equipment", {"item_id": i, "reason": "r"}, call_id=f"c{n}")
            for n, i in enumerate(items)
        ] + [text_reply("Done.")]
        result, chat, _ = run_advisor(make_case(), script)
        assert len(result.equipment_suggestions) == MAX_SUGGESTIONS
        tool_msgs = [m for m in chat.calls[-1]["messages"] if m["role"] == "tool"]
        assert any(f"already {MAX_SUGGESTIONS}" in m["content"] for m in tool_msgs)

    def test_duplicate_item_updates_the_reason(self):
        result, _, _ = run_advisor(
            make_case(),
            [
                tool_call("suggest_equipment", {"item_id": "bougie", "reason": "first"}),
                tool_call(
                    "suggest_equipment",
                    {"item_id": "bougie", "reason": "second"},
                    call_id="call-2",
                ),
                text_reply("Done."),
            ],
        )
        assert len(result.equipment_suggestions) == 1
        assert result.equipment_suggestions[0].reason == "second"

    def test_rerun_resets_stale_suggestions(self):
        case = make_case()
        case.equipment_suggestions = [
            EquipmentSuggestion(item_id="cvc-kit", name="stale", reason="old run")
        ]
        result, _, _ = run_advisor(
            case,
            [
                tool_call("suggest_equipment", {"item_id": "ett-7.0", "reason": "GA."}),
                text_reply("Done."),
            ],
        )
        assert [s.item_id for s in result.equipment_suggestions] == ["ett-7.0"]


class TestStepWiring:
    def test_structured_only_chat_gets_just_the_note(self):
        # scripted structured doubles can't drive a tool loop — the step
        # must stay the plain note LoopAgent, exactly as before
        assert isinstance(preop_note_step(object()), LoopAgent)

    def test_tool_capable_chat_gets_the_advisor(self):
        step = preop_note_step(object(), tool_chat=ScriptedToolChat([]))
        assert isinstance(step, SequentialAgent)
        assert [a.name for a in step.sub_agents] == ["preop_note", "equipment_advisor"]
