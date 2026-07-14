---
name: periop-modify-backend
description: Modify the PeriOp Companion backend safely - change agent prompts, add or rewire ADK pipeline steps (SequentialAgent/LoopAgent/ParallelAgent composition), add FastAPI endpoints, adjust NIM model tiers, and validate everything with the network-free pytest suite and the CLI == API == batch conformance tests. Use when asked to change an agent, edit a prompt, add a pipeline stage or step, add or modify an API route, tune claim verification, or debug backend behavior in periop-companion. Trigger keywords - backend, agent, prompt, ADK, pipeline, LoopAgent, structured_step, FastAPI, router, endpoint, claim verifier, NIM tier, periop.agents.
license: Apache-2.0
---

# Modify the PeriOp Companion Backend

Change agents, prompts, orchestration, and API surface without breaking the
product's two structural guarantees: **every claim carries provenance** and
**CLI == API == batch produce identical ledgers** (pinned by conformance
tests). Read `docs/architecture.md` (the map) and `docs/adk-orchestration.md`
(the mechanics) before non-trivial changes.

## Step 1: Know where things live

- **ADK orchestration** — `src/periop/adk/`:
  - `stages.py` — `build_case_pipeline`: the literal agent tree
    (`periop_pipeline` SequentialAgent → preop/intraop/postop stages).
  - `steps.py` — `structured_step`: the one reusable generate→validate
    `LoopAgent` cell every LLM node is built from (loop iterations ARE the
    structured-output retries, max 3; `skip_fn` short-circuits; SSE brackets
    via `announce_start`/`announce_end`).
  - `verifier.py` — `ClaimVerifierAgent`: per-claim verdict steps in
    `ParallelAgent` batches (`PERIOP_VERIFIER_CONCURRENCY`, default 4; `0`/`1`
    = sequential for rate-limited endpoints).
  - `model.py` — `ChatModel`/`ToolChatModel` BaseLlm adapters bridging NIM
    tiers into ADK.
  - `runtime.py` — `run_agent(agent, case, emit_fn)`: the synchronous
    Case → Case seam every non-ADK caller (API, CLI, evals) funnels through.
  - `deterministic.py` — non-LLM BaseAgents (RecordIngestor, Transcriber,
    Emit/AppendArtifacts) whose only effect is a `state_delta` on the Case.
- **Prompts, schemas, apply logic** — `src/periop/agents/` (one module per
  agent: `gap_analyst.py`, `preop_note.py`, `event_extractor.py`,
  `intraop_record.py`, `issue_anticipator.py`, `handoff.py`,
  `postop_eval.py`, `equipment_advisor.py`, `case_chat.py`). **Prompts live
  inline in these modules**, not in separate template files.
- **Model tiers** — `src/periop/nim.py`: endpoint resolution is pure env
  (`PERIOP_{TIER}_BASE_URL`); reasoning = Super-49B, fast = Nano-9B;
  `/no_think` injected by default (Super averages ~85 s/call with thinking vs
  ~8 s Nano — the measured latency bottleneck).
- **API** — `src/periop/api/`: routers in `routers/` (reads in `cases.py`,
  writes in `workflow.py`, SSE generation in `stage_runs.py`, dictation WS in
  `stream_asr.py`); `run_lock.py` (one generation at a time → second gets
  409); `nat_bridge.py` (one long-lived NAT Runner per process).
- **Data model** — `src/periop/schemas.py`: `Case`, `Claim`, `ProvenanceRef`,
  `Source`. `Case.add_artifact` refuses any claim whose provenance doesn't
  resolve — that refusal is the product.

## Step 2: Make the change

**Edit a prompt:** find the agent module in `src/periop/agents/`, edit the
inline prompt. The writer LlmAgent renders its user message from the Case in a
`before_model_callback` and appends a JSON-Schema instruction block — keep the
schema block mechanism intact; change the instructions, not the plumbing.

**Add or rewire a pipeline step:** compose a new `structured_step(...)` (or a
deterministic BaseAgent) into the right stage in `adk/stages.py`. Give it its
own state keys (parallel branches must never contend), a `skip_fn` if the step
is idempotent against existing Case data, and `artifact_state_key` /
announce strings so the SSE protocol stays consistent for the UI and CLI.

**Add an endpoint:** add to the matching router in `src/periop/api/routers/`.
Reads are lock-free; anything that generates must go through the run lock and
the NAT bridge like `stage_runs.py` does. Update the zod mirror
(`ui/src/lib/schema.ts`) if the response shape changes.

**Change model behavior:** prefer env knobs (`PERIOP_REASONING_MODEL`,
`PERIOP_*_BASE_URL`) over code. New agent → pick the tier deliberately:
reasoning for writers/analysis, fast for verification/extraction/tools.

## Step 3: Test — stub first, live last

```bash
uv run pytest                 # full suite, no network (stub path)
uv run pytest tests/test_lifecycle_conformance.py tests/test_cli_conformance.py
```

The conformance tests pin CLI == API == batch to byte-identical ledgers — if
your change breaks them, the three entry points have diverged; fix the shared
seam (`adk/runtime.py` facades), don't fork behavior per caller.

Smoke interactively without spending model time:

```bash
PERIOP_STUB_RUNNER=1 uv run python -m periop.api   # instant stage runs
```

Only then do a live run (needs `NGC_API_KEY` in `.env`; minutes per stage):
drive one case through the changed stage with the `periop` CLI or the UI and
read the claim ledger — flagged claims (`✗ conflicting`, `? unsupported`) are
findings to report, never hide.

## Common mistakes to avoid

- **Do not put orchestration logic in agent facades.** Sequencing, retries,
  and parallelism belong to the ADK tree (`stages.py`, `steps.py`); facades in
  `periop.agents` are prompts + schemas + apply logic only.
- **Do not bypass `run_agent`.** Every sync caller goes through the
  `adk/runtime.py` seam — calling agents directly forks the conformance
  contract and loses NAT tracing.
- **Do not emit artifacts with invented citations.** `add_artifact` will
  refuse them; the fix is to cite real chunks/segments or drop the claim —
  never to weaken the check.
- **Do not share state keys between parallel branches.** ClaimVerifier and the
  post-op writers rely on per-step keys; contention corrupts the Case.
- **Do not reorder ledger commits.** Post-op parks artifacts and
  `AppendArtifacts` commits handoff-first by design — ledger order must not
  depend on which parallel writer finished first.
- **Do not kill a streaming live run** — minutes per stage is normal; only
  treat it as failed on an explicit `error:`.
- **Do not test prompt changes live before the stub suite passes** — live NIM
  time is the expensive resource; pytest is free.
