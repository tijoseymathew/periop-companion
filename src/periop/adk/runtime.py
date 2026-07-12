"""Shared runtime for the ADK pipeline: session-state keys, the SSE emit
bridge, and runner helpers.

The Case rides in session state under ``CASE_KEY`` (spec §3.1: session state
= the Case object). Progress events for the UI (ui.md §7) flow through a
contextvar rather than session state — an emit callback is per-request
plumbing, not case data, and contextvars propagate through the asyncio tasks
ADK spawns (including ``ParallelAgent`` branches and ``asyncio.to_thread``).
"""

from __future__ import annotations

import asyncio
import contextvars
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from typing import Any, Callable, Mapping

from google.adk.agents import BaseAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from periop.schemas import Case

CASE_KEY = "case"

_EMIT: ContextVar[Callable[[str, dict], None] | None] = ContextVar(
    "periop_adk_emit", default=None
)


def emit(event: str, data: dict) -> None:
    """Send a progress event to the current run's SSE stream, if any."""
    fn = _EMIT.get()
    if fn is not None:
        fn(event, data)


def get_case(state: Mapping[str, Any]) -> Case:
    return Case.model_validate(state[CASE_KEY])


def case_delta(case: Case) -> dict[str, Any]:
    return {CASE_KEY: case.model_dump(mode="json")}


def sync_case(target: Case, source: Case) -> Case:
    """Copy ``source``'s fields onto ``target`` in place.

    The runner round-trips the Case through session state, so callers that
    passed a Case object in (the stage functions' contract) get their own
    instance mutated, exactly like the pre-ADK implementation.
    """
    for name in Case.model_fields:
        setattr(target, name, getattr(source, name))
    return target


async def run_agent_async(
    agent: BaseAgent,
    case: Case,
    extra_state: Mapping[str, Any] | None = None,
) -> tuple[Case, dict[str, Any]]:
    """Run one agent (a step, a stage, or the whole pipeline) over a Case."""
    runner = InMemoryRunner(agent=agent, app_name="periop")
    session = await runner.session_service.create_session(
        app_name="periop",
        user_id="periop",
        state={CASE_KEY: case.model_dump(mode="json"), **dict(extra_state or {})},
    )
    async for _ in runner.run_async(
        user_id="periop",
        session_id=session.id,
        new_message=types.Content(role="user", parts=[types.Part(text="run")]),
    ):
        pass
    final = await runner.session_service.get_session(
        app_name="periop", user_id="periop", session_id=session.id
    )
    return get_case(final.state), dict(final.state)


def _unwrap(exc: BaseException) -> BaseException:
    """Reduce a TaskGroup ExceptionGroup to its first leaf.

    A failed ``ParallelAgent`` branch surfaces as an ExceptionGroup; callers
    of the synchronous seam (stage functions, tests) expect the underlying
    error, e.g. the reasoning NIM's RuntimeError.
    """
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return exc


def _run_to_completion(coro) -> Any:
    try:
        return asyncio.run(coro)
    except BaseExceptionGroup as eg:
        raise _unwrap(eg) from eg


def run_agent(
    agent: BaseAgent,
    case: Case,
    emit_fn: Callable[[str, dict], None] | None = None,
    extra_state: Mapping[str, Any] | None = None,
) -> tuple[Case, dict[str, Any]]:
    """Synchronous seam over :func:`run_agent_async` for the stage functions.

    Normally called from a loop-less thread (the NAT function runs the stage
    in ``asyncio.to_thread``, spec v2-nat §3.1) and runs the pipeline right
    there. Still safe under a running event loop (sync callers inside a
    coroutine, e.g. tests): the pipeline then moves to a one-off worker
    thread with the caller's context copied. Either way ``traced_llm_call``
    reaches NAT's step stream — off-loop pushes marshal to the bound export
    loop (periop.nat.telemetry).
    """
    token = _EMIT.set(emit_fn) if emit_fn is not None else None
    try:
        coro = run_agent_async(agent, case, extra_state=extra_state)
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return _run_to_completion(coro)
        ctx = contextvars.copy_context()
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(ctx.run, _run_to_completion, coro).result()
    finally:
        if token is not None:
            _EMIT.reset(token)
