"""EquipmentAdvisor: the PreOpNoteWriter's equipment-suggestion tool loop.

Extends the pre-op note step (spec §3.3 step 5) with a native ADK tool agent:
after the note is written, a fast-tier ``LlmAgent`` reads the case and calls
the ``suggest_equipment`` tool to recommend 1-3 items from the fixed theatre
store (``periop.equipment.CATALOG``) worth reserving for this case. The
suggestions land on ``Case.equipment_suggestions`` — recommendations only;
the provider confirms them at pre-op sign-off, where the ticked items are
reserved through the equipment ledger.
"""

from __future__ import annotations

from typing import Any

from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools import ToolContext
from google.genai import types

from periop.adk.model import ToolChatModel
from periop.adk.runtime import CASE_KEY, emit, get_case
from periop.agents.context import preview_texts
from periop.agents.preop_note import PREOP_NOTE_ID
from periop.equipment import CATALOG, CATALOG_BY_ID
from periop.schemas import Case, EquipmentSuggestion

MAX_SUGGESTIONS = 3


def _catalog_block() -> str:
    """The fixed store rendered for the instruction, grouped by type."""
    by_category: dict[str, list[str]] = {}
    for item in CATALOG:
        by_category.setdefault(item.category, []).append(f"  - {item.item_id}: {item.name}")
    return "\n".join(
        f"{category}:\n" + "\n".join(lines) for category, lines in by_category.items()
    )


SYSTEM_TEMPLATE = """\
You are the equipment advisor of an anaesthesia documentation assistant. A
pre-anaesthesia evaluation was just written for the case below. From the
theatre store, pick the 1 to 3 items most relevant to this case's anaesthetic
plan and suggest each by calling suggest_equipment(item_id, reason) — one
call per item, the reason one short sentence tied to a stated fact of this
case (the planned technique, airway findings, comorbidities). These are
recommendations a provider confirms at sign-off, not orders: nothing is
reserved by suggesting.

Rules:
- only item_ids from the store list below; never invent items
- suggest at least 1 and at most {max_suggestions} items — the few that
  matter, not everything plausible
- when you are done suggesting, reply with a one-line summary and make no
  further tool calls

The theatre store (item_id: name), by equipment type:
{catalog}

The case:
{case_block}
"""


def _case_block(case: Case) -> str:
    """What the advisor reads: the operative plan and the fresh pre-op note."""
    lines: list[str] = []
    plan = case.get_source("doc:op-plan")
    if plan is not None and plan.chunks:
        lines.append("Operative plan:")
        lines += [f"  {c.text}" for c in plan.chunks]
    note = case.get_artifact(PREOP_NOTE_ID)
    if note is not None and note.claims:
        lines.append("Pre-anaesthesia evaluation note:")
        lines += [f"  - {c.text}" for c in note.claims]
    if not lines:
        # a case with neither (shouldn't happen after the note step) still
        # gets a grounded prompt: the first document's chunks
        doc = next((s for s in case.sources if s.chunks), None)
        if doc is not None:
            lines.append(f"Record ({doc.source_id}):")
            lines += [f"  {c.text}" for c in doc.chunks]
    return "\n".join(lines) or "(no case record available)"


def _instruction(ctx: ReadonlyContext) -> str:
    return SYSTEM_TEMPLATE.format(
        max_suggestions=MAX_SUGGESTIONS,
        catalog=_catalog_block(),
        case_block=_case_block(get_case(ctx.state)),
    )


def suggest_equipment(item_id: str, reason: str, tool_context: ToolContext) -> dict[str, Any]:
    """Recommend one theatre-store item for this case.

    Args:
        item_id: an item_id from the store list in your instructions,
            e.g. "video-laryngoscope".
        reason: one short sentence tying the item to this case.
    """
    item = CATALOG_BY_ID.get(item_id)
    if item is None:
        return {
            "error": f"no such equipment item: {item_id} — use an item_id "
            "from the store list"
        }
    case = get_case(tool_context.state)
    existing = next(
        (s for s in case.equipment_suggestions if s.item_id == item_id), None
    )
    if existing is not None:
        existing.reason = reason
    elif len(case.equipment_suggestions) >= MAX_SUGGESTIONS:
        return {
            "error": f"already {MAX_SUGGESTIONS} suggestions — reply with "
            "your summary instead"
        }
    else:
        case.equipment_suggestions.append(
            EquipmentSuggestion(item_id=item_id, name=item.name, reason=reason)
        )
    tool_context.state[CASE_KEY] = case.model_dump(mode="json")
    return {
        "suggested": {
            "item_id": item_id,
            "name": item.name,
            "suggestions_so_far": len(case.equipment_suggestions),
        }
    }


def _before_agent(callback_context) -> types.Content | None:
    emit("agent_start", {"stage": "preop", "agent": "EquipmentAdvisor"})
    # a regenerated pre-op starts from a clean slate — stale suggestions
    # would otherwise pin the cap and mix eras
    case = get_case(callback_context.state)
    if case.equipment_suggestions:
        case.equipment_suggestions = []
        callback_context.state[CASE_KEY] = case.model_dump(mode="json")
    return None


def _after_agent(callback_context) -> types.Content | None:
    case = get_case(callback_context.state)
    emit("agent_end", {
        "stage": "preop",
        "agent": "EquipmentAdvisor",
        "summary": f"{len(case.equipment_suggestions)} equipment suggestions",
        "preview": preview_texts(
            [f"{s.name} — {s.reason}" for s in case.equipment_suggestions]
        ),
    })
    return None


def _before_model(callback_context, llm_request):
    # The pipeline session's own turns (the "run" kickoff, neighbouring
    # agents' events) read as noise here — live NIMs answer "I need the case
    # details" to them instead of acting. Keep only this loop's tool
    # exchange and open with an explicit directive user turn.
    tool_turns = [
        c
        for c in llm_request.contents or []
        if any(p.function_call or p.function_response for p in c.parts or [])
    ]
    llm_request.contents = [
        types.Content(
            role="user",
            parts=[
                types.Part(
                    text="Suggest the equipment for this case now: one "
                    "suggest_equipment call per item (1-3 items), then a "
                    "one-line summary."
                )
            ],
        ),
        *tool_turns,
    ]
    return None


def equipment_advisor_step(tool_chat: Any) -> LlmAgent:
    """The tool-loop agent; ``tool_chat`` must speak ``complete_chat``."""
    return LlmAgent(
        name="equipment_advisor",
        model=ToolChatModel(chat=tool_chat),
        instruction=_instruction,
        include_contents="none",
        tools=[suggest_equipment],
        before_agent_callback=_before_agent,
        after_agent_callback=_after_agent,
        before_model_callback=_before_model,
    )
