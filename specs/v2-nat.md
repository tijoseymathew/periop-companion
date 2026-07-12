# PeriOp Companion — NAT-Traced Live Runs Specification

**The batch pipeline (`nat run/serve/eval`) has been NAT-observed since M0. The live provider workflow shipped in [specs/v2.md](v2.md) is not — every stage a provider triggers from the browser runs entirely outside NAT's exporter/profiler machinery. This spec closes that gap: the same live stage runs the worklist drives get traced, profiled, and exported exactly like a batch `nat eval` row.**

Version: 0.1 (draft for review)
Status: Companion to [specs/v1.md](v1.md) (pipeline + NAT wiring), [specs/ui.md](ui.md) (review UI), and [specs/v2.md](v2.md) (case lifecycle, write API). Supersedes none of them — v2's endpoints, schemas, and UX are unchanged; this spec only changes what happens *inside* `POST /api/cases/{id}/stages/{stage}/run` between "gate checked" and "artifact saved."
Framing unchanged: reference/demonstration project, synthetic data only, no PHI, not a medical device.

---

## 1. The gap, precisely

v1 §3.1 states the design rule the whole project repeats: **"ADK owns orchestration, NAT owns observability and evaluation."** v2 §7 explicitly carries this forward: *"SSE run events remain UI-facing only; NAT/OTel tracing is still the observability source of truth."* That sentence is aspirational today, not true.

What is actually wired, read directly from the code:

- `periop.nat.register.periop_pipeline` (`src/periop/nat/register.py`) is a NAT function that loads a case by id, runs all three stages via `run_case`, and saves it. `nat run --config_file configs/workflow.yml --input sg-0001` and `nat eval --config_file configs/profile_config.yml` both drive execution through this function, so every LLM call inside it is wrapped by `periop.nat.telemetry.traced_llm_call`, which pushes `LLM_START`/`LLM_END` intermediate steps onto `Context.get().intermediate_step_manager`. This is the path the README's profiler report (`evals/profile/`) and `nat eval`'s scoring come from.
- The v2 write API (`src/periop/api/routers/stage_runs.py`) never touches this. `POST /stages/{stage}/run` acquires the run lock, spins a worker thread, and calls `request.app.state.runner.run_stage(case, stage, case_dir, emit)` — `LivePipelineRunner.run_stage` (`src/periop/api/runner.py`) — which calls `run_preop_stage` / `run_intraop_stage` / `run_postop_stage` directly. No `Workflow.run()`, no `Runner`, no NAT function invocation anywhere in this path.
- That distinction matters mechanically, not just stylistically: `nat.runtime.runner.Runner.result()` only opens `async with self._exporter_manager.start(context_state=...)` around the call to the entry function (`nat/runtime/runner.py:204`). Exporters — profiler, OTel, whatever — are subscribed to the intermediate-step stream **only inside that block**. `telemetry.py`'s own docstring says the quiet part outright: *"outside a NAT run the event stream has no subscribers and emission is a harmless no-op."* Every `traced_llm_call` invoked from a live stage run today is exactly that: a no-op.

So: a case walked through the browser — the actual product, the thing in the README's three-provider demo — produces zero NAT traces, zero profiler data, and is invisible to whatever OTel/Phoenix exporter the project ever points at. Only synthetic cases driven by `nat run`/`nat eval` are observed. That inverts the priority a documentation-support tool for clinicians should have: the live path is the one whose latency, cost, and failure modes matter most, and it's the one with no instrumentation.

A second, smaller gap: the README and `docs/provenance-design.md` already claim OTel export ("NAT OTel traces record which agent, prompt, and model produced each artifact"). `pyproject.toml` installs `nvidia-nat[adk,eval,profiler]` — no `opentelemetry` extra, and no config file sets `general.telemetry.tracing`. Today the only real consumer of the intermediate-step stream is the profiler *during `nat eval`*. The OTel claim is true of the toolkit's capability, not of this repo's configuration.

NAT ships a first-class Langfuse exporter for exactly this: `general.telemetry.tracing.<name>._type: langfuse`, installed via the `opentelemetry` extra (`pip install "nvidia-nat[opentelemetry]"` — Langfuse rides on NAT's generic OTLP support, it isn't a separate package), documented and exercised in NAT's own `examples/observability/simple_calculator_observability` example. That's the concrete exporter this spec wires in (§3.5), replacing the console-exporter placeholder from the first draft.

---

## 2. Scope

### In scope
- Every live stage run triggered from the worklist (`preop` / `intraop` / `postop`) executes inside a real NAT `Runner` context, so the existing `traced_llm_call` instrumentation starts landing somewhere instead of nowhere.
- One new NAT function, registered alongside `periop_pipeline`, sized to a single stage + case id — the granularity the write API actually calls at.
- A dedicated NAT config (`configs/api.yml`) for the API server process, with `general.telemetry.tracing` pointing at Langfuse, closing the "OTel claim" gap from §1.
- **Observability is opt-in by environment, not by config file.** If `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` are all set, live and batch runs alike get traced to Langfuse. If any is missing, the process logs one warning at startup and runs with zero telemetry exporters — never a crash, never a degraded/retry loop. This is the same degradation-ladder posture the rest of the spec set already uses (v1 §10's diarization fallback, v2 §6.7's "errors say what to do") applied to the ops plane: a demo reviewer who hasn't set up a Langfuse project should never see the app break because of it.
- Parity artifact: a Langfuse trace (or, absent credentials, a profiler report — whichever the environment supports) generated from a **live, API-driven** case run, proving the live and batch paths are now equally observed.
- No change to the UI-facing SSE event vocabulary (ui.md §7) — providers see exactly what they see today. NAT's intermediate-step stream is a second, parallel channel, not a replacement.

### Out of scope
- Per-user NAT workflows, auth, or anything that would need `SessionManager`'s per-user builder machinery — the API remains the no-auth, one-provider-picker demo tool of v2 §2.
- Changing what gets traced inside the agents themselves (Nano/Super calls, ASR, TTS) — `telemetry.py` already covers every NimChat call; this spec only makes that instrumentation reachable.
- Replacing `periop.api`'s FastAPI app with `nat serve`'s generic front end. `nat serve` still works standalone for CLI-driven demos (`configs/workflow.yml`) but the provider-facing product keeps its own routers (worklist, sources, claim reviews) — NAT is embedded as a library, not swapped in as the server.

---

## 3. Design: a NAT session lives inside the API server

### 3.1 One more NAT function, sized to a stage

`periop_pipeline` runs all three stages for a case id — the right shape for `nat run`/`nat eval` over a synthetic bundle, wrong shape for a provider tapping "Generate pre-op note" once. Add a sibling function in `periop.nat.register`:

```python
class PeriopStageRunConfig(FunctionBaseConfig, name="periop_stage_run"):
    case_dir: str = Field(default="data/cases")

@register_function(config_type=PeriopStageRunConfig)
async def periop_stage_run(config: PeriopStageRunConfig, _builder: Builder):
    store = CaseStore(Path(config.case_dir) / "_out")

    async def _run(input: StageRunInput) -> str:
        case = store.load(input.case_id)
        case_dir = Path(config.case_dir) / input.case_id
        emit = _LIVE_EMIT.get()          # contextvar, set by the API just for this call
        case = await asyncio.to_thread(
            LivePipelineRunner().run_stage, case, input.stage, case_dir, emit
        )
        store.save(case)
        return f"case {case.case_id} stage {input.stage}: {len(case.artifacts)} artifacts"

    yield FunctionInfo.from_fn(_run, description="Run one stage of one live case")
```

`StageRunInput` is a two-field pydantic model (`case_id`, `stage`); `_LIVE_EMIT` is a module-level `contextvars.ContextVar[Callable[[str, dict], None]]`. This is the one piece of plumbing worth calling out: the existing UI-facing SSE `emit` callback (ui.md §7 vocabulary — `agent_start`, `agent_end`, `artifact_complete`) has to reach code running *inside* a NAT-registered function, and NAT functions are built once from config with no per-request closure. A contextvar set immediately before entering the NAT `Runner` and read inside `_run` solves this cleanly, because contextvars propagate through the same task/coroutine chain the `Runner` executes in — no new transport needed, and the UI SSE stream is untouched by the change.

### 3.2 One long-lived NAT session per API process

At FastAPI startup (`periop.api.app`'s lifespan), build the workflow once and keep it open for the process's life, mirroring what `nat.runtime.loader.load_workflow` already does for the CLI:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    config = load_config("configs/api.yml")
    apply_optional_telemetry(config)          # §3.5 — mutates config.general.telemetry in place
    async with WorkflowBuilder.from_config(config=config) as builder:
        app.state.nat_sessions = await SessionManager.create(config=config, shared_builder=builder)
        yield
        await app.state.nat_sessions.shutdown()
```

`configs/api.yml` mirrors `configs/workflow.yml` but points at the new function. It deliberately carries **no** telemetry block — exporter credentials are a deployment secret, not something to commit, and whether tracing is on at all is an environment decision (§3.5), not a config-file decision:

```yaml
workflow:
  _type: periop_stage_run
  case_dir: data/cases
```

### 3.3 Bridging the worker thread

`stage_runs.py` runs the stage on a background `threading.Thread` today because the agent calls are synchronous (blocking HTTP to the NIMs) and must not freeze the FastAPI event loop (this is exactly the bug W7b fixed for gap analysis — see `progress-v2.md` W7b). The NAT `Runner` is async, so the worker thread now needs its own event loop around the NAT call:

```python
def work():
    async def go():
        _LIVE_EMIT.set(lambda e, d: events.put((e, d)))
        async with app.state.nat_sessions.run(StageRunInput(case_id=case_id, stage=stage)) as runner:
            return await runner.result(to_type=str)
    try:
        asyncio.run(go())
        outcome["ok"] = True
    except Exception as e:
        outcome["error"] = str(e)
    finally:
        events.put(None)
```

This is a sanctioned pattern, not a workaround: `Runner.__aenter__` explicitly restores a `saved_context` captured "from the workflow build phase," with the comment *"HTTP requests in nat serve run in different async contexts"* (`nat/runtime/runner.py:110-115`) — NAT was built assuming exactly this shape (one shared workflow, many independent per-request event loops/contexts), so nothing here fights the toolkit.

### 3.4 What actually gets observed

Once a stage run executes inside `runner.result()`, for free (no change to `agents/`, `telemetry.py`, or the ADK stage functions):
- `WORKFLOW_START`/`WORKFLOW_END` bracket the stage, tagged with `workflow_run_id` and `workflow_trace_id`.
- Every `traced_llm_call` inside `run_preop_stage` etc. (GapAnalyst, PreOpNoteWriter, ClaimVerifier, EventExtractor, HandoffComposer — whichever the stage touches) emits real `LLM_START`/`LLM_END` steps with token usage, consumed by Langfuse when it's configured (§3.5) — or by nothing, quietly, when it isn't.
- The NAT profiler (already installed via the `profiler` extra) keeps working off the same intermediate-step stream regardless of whether Langfuse is wired, the same way it's pointed at `nat eval` runs today.

The UI-facing SSE stream (`agent_start`/`agent_end`/`artifact_complete`, ui.md §7) is untouched — it's the `_LIVE_EMIT` callback, a plain Python closure, independent of NAT's own event stream. Providers see the same progress screen; NAT sees a properly bracketed run underneath it.

### 3.5 Langfuse, wired only when the environment says so

Add the `opentelemetry` extra (`nvidia-nat[adk,eval,profiler,opentelemetry]`) — this is what actually provides the `langfuse` exporter type; there is no separate `nvidia-nat-langfuse` package. NAT's own `examples/observability/simple_calculator_observability/configs/config-langfuse.yml` is the reference:

```yaml
general:
  telemetry:
    tracing:
      langfuse:
        _type: langfuse
        endpoint: http://localhost:3000/api/public/otel/v1/traces
```

The exporter itself reads its Basic-Auth credentials from the environment (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`) rather than from YAML — the YAML only ever carries the (non-secret) endpoint. That still leaves the endpoint hardcoded per-deployment, and gives no way to say "trace only if credentials exist." Both are solved with one small helper, `periop.nat.observability.apply_optional_telemetry(config)`, called right after `load_config` in both the API lifespan (§3.2) and — for parity — the CLI/eval entry points:

```python
# src/periop/nat/observability.py
import logging

logger = logging.getLogger(__name__)

REQUIRED_VARS = ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL")

def apply_optional_telemetry(config: Config) -> None:
    """Wire the Langfuse tracing exporter iff all required env vars are set.

    Never raises: missing credentials degrade to "no observability", exactly
    like every other optional integration in this project (v1 §10's
    diarization fallback, v2 §6.7's "errors say what to do").
    """
    missing = [v for v in REQUIRED_VARS if not os.environ.get(v)]
    if missing:
        logger.warning(
            "Langfuse tracing disabled — missing env var(s): %s. "
            "Set all three to trace NAT runs; the app runs normally without them.",
            ", ".join(missing),
        )
        return

    base_url = os.environ["LANGFUSE_BASE_URL"].rstrip("/")
    config.general.telemetry.tracing["langfuse"] = LangfuseTelemetryExporterConfig(
        endpoint=f"{base_url}/api/public/otel/v1/traces",
    )
```

This is the one place the "optional observability" requirement lives. Everything downstream — the NAT `Runner`, the exporter manager, `traced_llm_call` — behaves identically whether or not Langfuse is wired; an empty `tracing` dict is exactly what happens today (§1), it just now happens by informed default instead of by oversight.

`configs/eval_config.yml`/`configs/profile_config.yml` (the batch path) should call the same helper — one credential check, one warning message, one exporter destination for both batch and live runs, which is the actual point of this spec.

---

## 4. What this changes for evaluation — and what it must not

- Nothing about `nat eval`, the gold-artifact dataset, or the custom evaluators in `periop.evals` changes. This spec is additive to the observability plane only.
- The lifecycle conformance test (v2 §7) still asserts the live API path reproduces the batch pipeline's *ledger*. This spec doesn't touch ledger content — add a parallel, narrower assertion (§6) that the live path also reproduces the batch path's *NAT wiring*, i.e., that a live stage run and a `nat run` of the same stage both bracket their LLM calls with a `WORKFLOW_START`/`WORKFLOW_END` pair.

---

## 5. Testing

Same discipline as the rest of the repo — tests first, no network in CI:

- **`tests/test_nat_workflow.py` gains a stage-level counterpart**: build `configs/api.yml`-shaped config in `stub: true` mode (matching the existing fixture pattern), invoke `periop_stage_run` with a `StageRunInput`, and assert the result. This proves the function registers and runs without a live NIM.
- **New: NAT context propagation from the API.** Using the stub `LivePipelineRunner`-equivalent (or the existing `StubPipelineRunner` wired through the same NAT function instead of bypassing it), subscribe to `Context.get().intermediate_step_manager`'s event stream during a stage run triggered through the FastAPI test client, and assert a `WORKFLOW_START` precedes a `WORKFLOW_END` — this is the one new assertion that actually pins §1's gap shut. Without it, a future refactor could silently reintroduce the direct-call bypass.
- **`test_nat_workflow.py`'s existing non-stub test stays as the batch-path reference** — no change; it's the thing the new stage-level test must not diverge from (same reasoning as v2 §7's conformance test: one seam, two entry points, asserted equal).
- **`tests/test_nat_observability.py` (new, hermetic, no network)**: exercises `apply_optional_telemetry` directly against a bare `Config`.
  - All three env vars unset (the CI default) → `config.general.telemetry.tracing` stays empty and one `logging.WARNING` record is emitted (`caplog`), naming the missing vars — proves the "just a warning" contract.
  - Only one or two of the three set → same: empty tracing dict, warning names exactly the missing ones. Partial credentials must not half-configure an exporter that'll fail at request time.
  - All three set (dummy values, e.g. `LANGFUSE_BASE_URL=http://localhost:3000`) → `config.general.telemetry.tracing["langfuse"]` is populated with the derived endpoint; no network call is made by this test — constructing the exporter config is pure, the actual HTTP export only happens inside a live `Runner` run, which this test doesn't perform.
- Langfuse-connected smoke stays in `scripts/` (e.g. `scripts/smoke_live_trace.py`: boot the API with real credentials, POST a stage run against a seeded case, confirm a trace lands in Langfuse) — live-NIM- and live-credential-shaped checks never run in CI, matching every other live smoke in this repo.

---

## 6. Milestones

Numbered to continue `progress-v2.md`'s sequence (v2 build finished at W7c).

| # | Milestone | Exit criterion |
|---|---|---|
| W8a | `periop_stage_run` NAT function + `configs/api.yml`; stub-mode test green | `nat run --config_file configs/api.yml --input '{"case_id": "sg-0001", "stage": "preop"}'` runs one stage standalone |
| W8b | API lifespan builds/holds the shared `SessionManager`; `stage_runs.py`'s worker thread runs the stage inside a NAT `Runner` via the `_LIVE_EMIT` contextvar bridge | A live stage run through the browser produces `WORKFLOW_START`/`WORKFLOW_END` steps (asserted per §5); UI SSE rendering unchanged (existing Playwright specs stay green untouched) |
| W8c | `apply_optional_telemetry` helper + `opentelemetry` extra added; wired into the API lifespan and the eval/profile CLI entry points; `tests/test_nat_observability.py` green | With no env vars set, the app boots and runs normally, logging exactly one warning; with all three set, a live case run and a `nat eval` run both export to the same Langfuse project |
| W8d | Parity artifact: a Langfuse trace from a live API-driven case (screenshot or exported JSON), committed next to `evals/profile/` | README shows the live path's Langfuse trace alongside the existing batch profiler report, closing the loop on §1 |

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Running a shared NAT `Workflow` from a worker-thread event loop different from the one it was built on | This is NAT's documented per-request pattern (`Runner.__aenter__`'s saved-context restore exists precisely for "HTTP requests... run in different async contexts"); mirror `nat serve`'s own usage rather than inventing a new one |
| `_LIVE_EMIT` contextvar leaks across concurrent requests | Moot at MVP scope: v2 §5.2 already limits the API to one pipeline run at a time (`RUN_LOCK`), so there is never more than one live stage run — and thus one `_LIVE_EMIT` value — in flight |
| Adding the `opentelemetry` extra drags in dependencies not otherwise needed | It's the one extra that provides Langfuse (§3.5) — no separate `nvidia-nat-langfuse` package exists to install instead; the extra is only exercised at runtime if credentials are present, so environments that never set them pay the install cost but not a runtime one |
| Missing/partial Langfuse env vars silently degrade observability and nobody notices | `apply_optional_telemetry` always logs a `WARNING` naming exactly which var(s) are missing (§3.5, tested in §5) — it never fails silently and never fails loud (no exception), matching this project's existing "errors say what to do" posture applied to ops rather than the UI |
| Langfuse credentials committed by accident | They only ever come from environment variables, never from a config file (§3.2/§3.5 deliberately keep `configs/api.yml` telemetry-free) — same posture as `NGC_API_KEY` already in `.env` |
| This spec's stage-level NAT function drifts from `periop_pipeline`'s batch semantics (e.g. case-loading edge cases) | Both call the same `run_case`/`run_*_stage` functions from `periop.pipeline`/`periop.agents.stages` — no logic fork, same guarantee v2 §3 already leans on for the write API vs. CLI |
| Langfuse export is noisy or slow on every provider click | Exporters subscribe asynchronously to the intermediate-step stream (NAT's own design); worst case is added log/network volume, not added request latency — verify with one live boot per W8's convention (`progress-v2.md` W7 lesson: always boot live once per milestone, not just the stub walk) |
