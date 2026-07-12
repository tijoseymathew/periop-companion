"""Case chatbot: an ADK ``LlmAgent`` on the fast tier with case tools.

One agent, one long-lived in-memory runner per API process. Each case gets
its own ADK session (session_id = case_id) so conversations are multi-turn
for the life of the server. The agent answers questions by searching and
reading the case's registered sources (documents + transcripts) and stage
notes, and — while the case is in pre-op — orders anaesthesia equipment from
the fixed store (``periop.equipment``), marking items assigned to the case.

Tools are closures over the runtime so they resolve the case and the
equipment ledger from disk on every call: the chatbot always sees the same
state the rest of the API serves.
"""

from __future__ import annotations

import asyncio
import re
import threading
from difflib import SequenceMatcher
from typing import Any, Callable

from google.adk.agents import LlmAgent
from google.adk.agents.run_config import RunConfig
from google.adk.runners import InMemoryRunner
from google.adk.tools import ToolContext
from google.genai import types

from periop.adk.model import ToolChatModel
from periop.equipment import CATALOG_BY_ID, EquipmentStore
from periop.schemas import Case, StageName, StageStatus
from periop.store import CaseStore

APP_NAME = "periop-chat"
USER_ID = "periop"

#: hard ceiling on one turn's tool loop — a confused model must not spin
MAX_LLM_CALLS_PER_TURN = 12

SYSTEM_INSTRUCTION = """\
You are the PeriOp Companion case assistant, helping an anaesthesia provider
with one peri-operative case. Answer questions strictly from the case record:
use search_case to find relevant passages, read_source to read a whole
document or transcript, and list_sources to see what exists. Search first,
without asking permission — never claim the record lacks something you
haven't looked for. Quote or paraphrase what the record says and mention
where it came from (the document or transcript and, when useful, the
speaker). If a search comes back empty, try once more with different words
before answering. If the record doesn't answer the question, say so plainly
— never invent clinical facts.

You can also manage anaesthesia equipment for this case while it is in
pre-op: list_equipment shows the store and what's available,
reserve_equipment assigns items to this case, release_equipment returns
them, and case_equipment shows what this case already holds. Confirm what
was reserved (item, quantity) after ordering, and relay any error the store
returns (out of stock, ordering closed) instead of pretending it worked.

Keep answers short and concrete. This is a documentation aid, not a
clinical decision-making system: do not give treatment recommendations."""

_WORD = re.compile(r"[a-z0-9']+")
_STOP = {
    "the", "a", "an", "is", "are", "was", "were", "of", "for", "to", "in",
    "on", "at", "and", "or", "any", "what", "which", "who", "did", "does",
    "do", "has", "have", "had", "this", "that", "with", "about", "patient",
    "patient's", "case",
}


def _terms(query: str) -> list[str]:
    return [t for t in _WORD.findall(query.lower()) if t not in _STOP]


def _snippet(text: str, limit: int = 240) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


#: how alike a query term and a text word must be to count as a fuzzy match
_FUZZY_RATIO = 0.8


def _term_matches(term: str, lowered: str, words: list[str]) -> int:
    """Score one query term against a text: 2 exact-ish, 1 fuzzy, 0 no match.

    Exact-ish is a substring match with just enough stemming for clinical
    English — inflection must not hide facts: "allergy" has to find
    "allergies", "tubes" has to find "tube". Dropping a trailing y/s/e from
    longer terms ("allergi-", "tube-", "dos-") covers those without a
    stemmer dependency. Fuzzy is a per-word similarity ratio so misspellings
    ("asprin", "metfromin") still find the fact; short terms are exempt —
    almost everything is within one edit of a three-letter word.
    """
    if term in lowered:
        return 2
    if len(term) > 4 and term[-1] in "yse" and term[:-1] in lowered:
        return 2
    if len(term) >= 4:
        matcher = SequenceMatcher(b=term)
        for word in words:
            matcher.set_seq1(word)
            if matcher.ratio() >= _FUZZY_RATIO:
                return 1
    return 0


def search_case_texts(case: Case, query: str, limit: int = 8) -> list[dict[str, Any]]:
    """Fuzzy keyword search over chunks, transcript segments, and claims.

    Scores by distinct query terms present — an exact (substring) term
    counts double a fuzzy one, and a whole-query substring counts double
    again; ties keep registry order, which puts documents before the
    transcripts appended later. Deliberately dependency-free — the demo
    corpus is a handful of short sources, not a retrieval problem.
    """
    terms = _terms(query)
    phrase = query.strip().lower()
    hits: list[tuple[int, dict[str, Any]]] = []

    def consider(text: str, entry: dict[str, Any]) -> None:
        lowered = text.lower()
        words = _WORD.findall(lowered)
        score = sum(_term_matches(t, lowered, words) for t in terms)
        if phrase and len(terms) > 1 and phrase in lowered:
            score += 2 * len(terms)
        if score > 0:
            entry["text"] = _snippet(text)
            hits.append((score, entry))

    for source in case.sources:
        for chunk in source.chunks:
            consider(
                chunk.text,
                {
                    "ref": f"{source.source_id}#{chunk.chunk_id}",
                    "kind": "document",
                    "section": chunk.section,
                },
            )
        for seg in source.segments:
            consider(
                seg.text,
                {
                    "ref": f"{source.source_id}#{seg.seg_id}",
                    "kind": "transcript",
                    "speaker": seg.speaker,
                },
            )
    for artifact in case.artifacts:
        for claim in artifact.claims:
            consider(
                claim.text,
                {
                    "ref": f"{artifact.artifact_id}#{claim.claim_id}",
                    "kind": "generated note",
                    "status": claim.status.value,
                },
            )

    hits.sort(key=lambda pair: -pair[0])
    return [entry for _, entry in hits[:limit]]


class CaseChatRuntime:
    """Per-process chat runtime: one agent, one session per case.

    ``send`` is synchronous (the SSE router runs it on a worker thread) and
    serialized per case — two turns on one session must not interleave.
    History lives in the ADK in-memory session service and resets with the
    process; the case record itself is never written by the chat path except
    through the equipment ledger.
    """

    def __init__(self, out_dir, chat_factory: Callable[[], Any] | None = None) -> None:
        self.out_dir = out_dir
        self.equipment = EquipmentStore(out_dir)
        self._chat_factory = chat_factory
        self._runner: InMemoryRunner | None = None
        self._runner_lock = threading.Lock()
        self._case_locks: dict[str, threading.Lock] = {}
        self._active_provider: dict[str, str] = {}

    # ---- case + gating helpers ----------------------------------------------

    def _load_case(self, case_id: str) -> Case:
        return CaseStore(self.out_dir).load(case_id)

    @staticmethod
    def _ordering_block(case: Case) -> str | None:
        """Why ordering is closed for this case, or None while it's open."""
        if case.workflow is None:
            return "this is a seeded demo case — equipment ordering is disabled"
        if case.workflow.stages[StageName.PREOP].status is StageStatus.SIGNED_OFF:
            return (
                "pre-op is already signed off — equipment ordering is only "
                "available during the pre-op stage"
            )
        return None

    # ---- tools (closures so they see live disk state) ------------------------

    def _build_tools(self) -> list[Callable[..., Any]]:
        runtime = self

        def _case(tool_context: ToolContext) -> Case:
            return runtime._load_case(tool_context.state["case_id"])

        def list_sources(tool_context: ToolContext) -> dict[str, Any]:
            """List the case's documents, transcripts, and generated notes."""
            case = _case(tool_context)
            return {
                "sources": [
                    {
                        "source_id": s.source_id,
                        "type": s.type.value,
                        "chunks": len(s.chunks),
                        "segments": len(s.segments),
                        "sections": sorted(
                            {c.section for c in s.chunks if c.section}
                        ),
                    }
                    for s in case.sources
                ],
                "generated_notes": [a.artifact_id for a in case.artifacts],
            }

        def search_case(query: str, tool_context: ToolContext) -> dict[str, Any]:
            """Fuzzy-search the case's documents, transcripts, and notes.

            Matching tolerates inflections and misspellings, so search with
            the words you have.

            Args:
                query: words to look for, e.g. "aspirin stopped".
            """
            results = search_case_texts(_case(tool_context), query)
            if not results:
                return {"results": [], "note": "no passages matched — try other words"}
            return {"results": results}

        def read_source(source_id: str, tool_context: ToolContext) -> dict[str, Any]:
            """Read one document (chunks) or transcript (segments) in full.

            Args:
                source_id: a source_id from list_sources or a search ref's
                    part before '#', e.g. "doc:gp-summary".
            """
            case = _case(tool_context)
            source = case.get_source(source_id)
            if source is None:
                artifact = case.get_artifact(source_id)
                if artifact is not None:
                    return {
                        "artifact_id": artifact.artifact_id,
                        "claims": [
                            {"claim_id": c.claim_id, "text": c.text, "status": c.status.value}
                            for c in artifact.claims
                        ],
                    }
                return {"error": f"no such source: {source_id}"}
            if source.chunks:
                return {
                    "source_id": source.source_id,
                    "type": "document",
                    "chunks": [
                        {"chunk_id": c.chunk_id, "section": c.section, "text": c.text}
                        for c in source.chunks
                    ],
                }
            return {
                "source_id": source.source_id,
                "type": "transcript",
                "segments": [
                    {"seg_id": s.seg_id, "speaker": s.speaker, "t0": s.t0, "t1": s.t1, "text": s.text}
                    for s in source.segments
                ],
            }

        def list_equipment(tool_context: ToolContext, category: str = "") -> dict[str, Any]:
            """List the anaesthesia equipment store with live availability.

            Args:
                category: optional filter — airway, vascular access,
                    regional, infusion, or monitoring. Empty lists everything.
            """
            levels = runtime.equipment.stock_levels()
            if category:
                levels = [l for l in levels if l.category == category.strip().lower()]
                if not levels:
                    return {"error": f"no such category: {category}"}
            return {
                "items": [
                    {
                        "item_id": l.item_id,
                        "name": l.name,
                        "category": l.category,
                        "available": l.available,
                        "total": l.total,
                    }
                    for l in levels
                ]
            }

        def reserve_equipment(
            item_id: str, quantity: int, tool_context: ToolContext
        ) -> dict[str, Any]:
            """Reserve equipment for this case (pre-op only).

            Args:
                item_id: an item_id from list_equipment, e.g. "ett-7.0".
                quantity: how many units to assign to this case.
            """
            case_id = tool_context.state["case_id"]
            case = _case(tool_context)
            blocked = runtime._ordering_block(case)
            if blocked:
                return {"error": blocked}
            provider = runtime._active_provider.get(case_id, "unknown")
            try:
                reservation = runtime.equipment.reserve(
                    item_id, case_id, quantity, provider
                )
            except (KeyError, ValueError) as exc:
                return {"error": str(exc)}
            item = CATALOG_BY_ID[item_id]
            return {
                "reserved": {
                    "item_id": item_id,
                    "name": item.name,
                    "quantity": reservation.qty,
                    "case_id": case_id,
                    "by": provider,
                }
            }

        def release_equipment(
            item_id: str, tool_context: ToolContext, quantity: int = 0
        ) -> dict[str, Any]:
            """Return this case's hold on an item to the store (pre-op only).

            Args:
                item_id: an item_id from list_equipment.
                quantity: units to release; 0 releases the case's whole hold.
            """
            case_id = tool_context.state["case_id"]
            blocked = runtime._ordering_block(_case(tool_context))
            if blocked:
                return {"error": blocked}
            try:
                released = runtime.equipment.release(
                    item_id, case_id, quantity or None
                )
            except KeyError as exc:
                return {"error": str(exc)}
            if released == 0:
                return {"error": f"this case holds no {item_id}"}
            return {"released": {"item_id": item_id, "quantity": released}}

        def case_equipment(tool_context: ToolContext) -> dict[str, Any]:
            """List the equipment already assigned to this case."""
            held = runtime.equipment.case_reservations(tool_context.state["case_id"])
            return {
                "equipment": [
                    {
                        "item_id": r.item_id,
                        "name": CATALOG_BY_ID[r.item_id].name,
                        "quantity": r.qty,
                        "by": r.by,
                    }
                    for r in held
                ]
            }

        return [
            list_sources,
            search_case,
            read_source,
            list_equipment,
            reserve_equipment,
            release_equipment,
            case_equipment,
        ]

    # ---- runner ---------------------------------------------------------------

    def _make_chat(self) -> Any:
        if self._chat_factory is not None:
            return self._chat_factory()
        from periop.nim import fast_chat

        return fast_chat()

    def _ensure_runner(self) -> InMemoryRunner:
        with self._runner_lock:
            if self._runner is None:
                agent = LlmAgent(
                    name="case_assistant",
                    model=ToolChatModel(chat=self._make_chat()),
                    instruction=SYSTEM_INSTRUCTION,
                    tools=self._build_tools(),
                )
                self._runner = InMemoryRunner(agent=agent, app_name=APP_NAME)
            return self._runner

    async def _session(self, runner: InMemoryRunner, case_id: str):
        session = await runner.session_service.get_session(
            app_name=APP_NAME, user_id=USER_ID, session_id=case_id
        )
        if session is None:
            session = await runner.session_service.create_session(
                app_name=APP_NAME,
                user_id=USER_ID,
                session_id=case_id,
                state={"case_id": case_id},
            )
        return session

    # ---- public surface --------------------------------------------------------

    def history(self, case_id: str) -> list[dict[str, Any]]:
        """The conversation so far: user/assistant text turns only."""
        runner = self._runner
        if runner is None:
            return []
        session = asyncio.run(
            runner.session_service.get_session(
                app_name=APP_NAME, user_id=USER_ID, session_id=case_id
            )
        )
        if session is None:
            return []
        messages: list[dict[str, Any]] = []
        for event in session.events:
            if not event.content:
                continue
            text = "\n".join(p.text for p in event.content.parts or [] if p.text)
            if not text:
                continue
            role = "user" if event.author == "user" else "assistant"
            messages.append({"role": role, "text": text})
        return messages

    def send(
        self,
        case_id: str,
        message: str,
        provider_id: str,
        emit: Callable[[str, dict], None],
    ) -> str:
        """One chat turn; emits tool_call/tool_result progress, returns the reply."""
        lock = self._case_locks.setdefault(case_id, threading.Lock())
        with lock:
            self._active_provider[case_id] = provider_id
            return asyncio.run(self._send_async(case_id, message, emit))

    async def _send_async(
        self, case_id: str, message: str, emit: Callable[[str, dict], None]
    ) -> str:
        runner = self._ensure_runner()
        await self._session(runner, case_id)
        reply = ""
        async for event in runner.run_async(
            user_id=USER_ID,
            session_id=case_id,
            new_message=types.Content(role="user", parts=[types.Part(text=message)]),
            run_config=RunConfig(max_llm_calls=MAX_LLM_CALLS_PER_TURN),
        ):
            for call in event.get_function_calls():
                emit("tool_call", {"name": call.name, "args": dict(call.args or {})})
            for result in event.get_function_responses():
                emit("tool_result", {"name": result.name, "result": result.response})
            if event.content and event.content.role == "model":
                text = "\n".join(
                    p.text for p in event.content.parts or [] if p.text
                ).strip()
                if text:
                    reply = text
        return reply
