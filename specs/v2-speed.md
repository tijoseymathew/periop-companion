# PeriOp Companion — v2 Speed Specification

**A live, API-driven e2e benchmark (real audio uploads, self-hosted NIMs) put one case at ~68 minutes wall clock, 96.6% of it inside seven Super-49B calls that decode at 7.7 tok/s and spend most of those tokens on `<think>` reasoning the pipeline immediately strips. This spec removes the latency the application controls: reasoning-tier thinking tokens, a synchronous 8-minute LLM call inside a document-upload request, a strictly sequential per-claim verifier, and two independent post-op writer calls that run back-to-back.**

Version: 0.1 (draft for review)
Status: Companion to [specs/v2.md](v2.md) (case lifecycle, write API) and [specs/v2-nat.md](v2-nat.md) (NAT-traced live runs). Supersedes none of them — endpoints, schemas, SSE vocabulary, and ledger semantics are unchanged; this spec only changes *when* and *how concurrently* the existing agents run, and how many tokens the reasoning tier emits.
Deployment-side throughput (the 7.7 tok/s itself) is out of scope here — it is specified separately in the NIM stack's repo (`~/projects/dev-rel-expt/REASONING_THROUGHPUT_SPEC.md`), because it changes serving flags, not application code. The two specs compose: this one cuts tokens and adds concurrency; that one makes concurrency pay and adds speculative decoding.
Framing unchanged: reference/demonstration project, synthetic data only, no PHI, not a medical device.

---

## 1. The problem, precisely

Measured 2026-07-07 on the reference self-hosted deployment (all four NIMs co-tenant on one DGX Spark GB10; reasoning = Super-49B NVFP4, fast = Nano-9B with `/no_think`). Method: drive one fresh case through the live API exactly as a provider would — create case, upload sg-0001's four record documents, approve questions, upload the real wavs (pre-op interview 112 s, intra-op memos 26 s, post-op interview 62 s), run and sign off all three stages, acknowledge the handoff — timestamping every HTTP request and every SSE event, then cross-referencing per-call durations and token counts from the Langfuse trace (the W8 wiring).

**Total: ~68 minutes for one case.** Where it went:

| Component | Time | Share |
|---|---|---|
| 7 Super-49B calls (writers, analysts, extract-verify) | 3,935 s | **96.6%** |
| 62 Nano-9B calls (claim verification, extraction first pass) | 118 s | 2.9% |
| ASR — all three recordings, local Parakeet | ~2.5 s | ~0.1% |
| Audio upload + ffmpeg normalization (3 uploads) | ~0.13 s | ~0% |
| Everything else (API, store, SSE plumbing, sign-offs) | ~15 s | ~0.4% |

Per-call, from the Langfuse trace (completion tokens include the stripped `<think>` stream):

| Call | Duration | Tokens in → out | Decode |
|---|---|---|---|
| GapAnalyst (intake, inside the op-plan upload request) | **488.0 s** | *(untraced — see below)* | — |
| PreOpNoteWriter | 349.0 s | 1,958 → 2,712 | 7.8 tok/s |
| EventExtractor Super verify pass | 60.5 s | 1,649 → 469 | 7.8 tok/s |
| IntraOpRecordWriter | **957.7 s** | 1,521 → **7,357** | 7.7 tok/s |
| IssueAnticipator | 598.8 s | 2,820 → 4,591 | 7.7 tok/s |
| HandoffComposer | **1,008.3 s** | 1,486 → **7,738** | 7.7 tok/s |
| PostAnesthesiaEvaluator | 473.1 s | 2,284 → 3,644 | 7.7 tok/s |
| Nano-9B (62 calls: verifier ~1.5–2 s × 61, extractor first pass 20.3 s) | 118 s total | 26,132 → 3,111 | 26.4 tok/s |

Four observations, each of which becomes a workstream:

1. **Thinking tokens dominate.** Every Super call decodes at a flat ~7.7 tok/s (the box's memory-bandwidth roof for this model — see the dev-rel-expt spec), so latency is proportional to completion tokens, and completion is dominated by `<think>` reasoning that `periop.nim.strip_reasoning` discards. Validated live: the identical PreOpNoteWriter call with a `/no_think` system prefix ran in **129.6 s vs 349.0 s (2.7×)** and produced a comparable claim-structured note (17 vs 19 claims, provenance intact). The fast tier already made exactly this decision (`fast_chat()` injects `/no_think`, `nim.py`); the reasoning tier never got the option.
2. **The intake GapAnalyst blocks a document upload for 8 minutes.** `workflow.py`'s `add_document` awaits `runner.analyze_gaps` on a threadpool *inside the request* — the op-plan upload returned 201 after 488 s. Any real proxy or browser times out long before that. Worse, this is the one LLM call that runs *outside* the NAT `Runner` (it predates W8's bridge), so it is also **invisible in Langfuse** — the live path's biggest single call is the one unobserved call left.
3. **ClaimVerifier is strictly sequential.** One Nano call per claim in a `for` loop (`claim_verifier.py`), ~1.5–2 s each: 28 s for the 19-claim pre-op note, 49 s for post-op's 27 claims. Independent verdicts, no shared state — an embarrassingly parallel loop served one at a time.
4. **Post-op's two Super calls are independent but sequential.** `HandoffComposer` composes from *existing* pre-op/intra-op claims; `PostAnesthesiaEvaluator` reads only `render_sources(case)` — neither reads the other's output, yet they run back-to-back (1,008 s + 473 s). Intra-op's pair is **not** parallel: `IssueAnticipator` renders the intra-op record's claims into its prompt (`issue_anticipator.py`), a real data dependency this spec respects.

---

## 2. Scope

### In scope
- **W9a — thinking off by default on the reasoning tier**, mirroring the fast tier's existing mechanism, with an env escape hatch and an eval-gated rollout (the quality question is answerable with the harness we already have).
- **W9b — intake gap analysis off the request path**: document uploads return when the document is durable; the GapAnalyst runs as a tracked background generation *inside the NAT session* (closing the observability hole from §1.2).
- **W9c — parallel ClaimVerifier**: bounded fan-out over claims, with NAT/emit context propagated into the worker threads so verification stays traced.
- **W9d — overlap post-op's independent Super calls** (HandoffComposer ∥ PostAnesthesiaEvaluator). Intra-op stays sequential by default; loosening its dependency is an eval experiment, not a default.

### Out of scope
- Raising the 7.7 tok/s itself (KV-cap/concurrency, speculative decoding, serving flags) — that is the dev-rel-expt spec. This spec's concurrency workstreams (W9c/W9d) *benefit* from it but do not require it: the fast tier already serves 34× concurrency, and the reasoning NIM batches two streams within its current KV budget.
- Swapping models or tiers (Nano-as-writer, hosted reasoning endpoint). Those are eval experiments with the existing A/B machinery, not plumbing changes; nothing here forecloses them.
- Streaming reasoning-tier tokens into the browser, changing the SSE vocabulary, or any UI redesign. Providers see the same progress log; the lines just arrive sooner (and, in W9d, may interleave — which the append-only log renders correctly today, `StagePanel.tsx`).
- Changing ledger semantics, provenance, schemas, or gates. The lifecycle conformance test (v2 §7) must pass untouched.

---

## 3. Design

### 3.1 W9a — `/no_think` on the reasoning tier, gated on the evals

Mirror `fast_chat()`'s existing pattern in `periop.nim.reasoning_chat`:

```python
def reasoning_chat(**kwargs: Any) -> NimChat:
    cfg = tier_config("reasoning")
    kwargs.setdefault("model", cfg.model)
    kwargs.setdefault("base_url", cfg.base_url)
    # Reasoning latency is proportional to completion tokens at the
    # self-hosted decode rate, and thinking is most of the completion
    # (2,712→~1,000 tokens on the pre-op note). PERIOP_REASONING_THINKING=1
    # restores it for A/B runs.
    if not os.environ.get("PERIOP_REASONING_THINKING"):
        kwargs.setdefault("system_prefix", "/no_think")
    return NimChat(**kwargs)
```

Notes:
- Super-49B v1.5 honors the `/no_think` system toggle — validated live against the deployed NIM (§1.1), and `strip_reasoning` already tolerates both tagged and untagged replies, so no parsing change is needed.
- **The default does not flip until the eval harness says it may.** Run the existing gold-set evaluation (`scripts/run_eval.py` / `nat eval`) twice — thinking on vs off — and compare provenance precision/coverage, claim recall vs gold, hallucinated-claim rate, and gap-analysis P/R. Acceptance: no metric degrades beyond noise (the same judgment standard the Nano-vs-Super extraction A/B used). The committed `evals/report.json` gains the off-mode row either way — if quality *does* degrade, the finding is committed and the default stays thinking-on with the env flag inverted.
- One flag for one tier: this deliberately does **not** touch `PERIOP_FAST_THINKING` or add per-agent overrides. If the evals show exactly one agent needs thinking (plausible for GapAnalyst's conflict-finding), that agent can construct its own chat with `system_prefix=None` — a one-line, per-callsite decision to make *then*, not machinery to build now.

### 3.2 W9b — gap analysis leaves the request path (and enters the NAT session)

Today (`workflow.py` `add_document`): save document → if op-plan + ≥1 record present and no questions yet → `await run_in_threadpool(runner.analyze_gaps, case)` → save → 201. The document-durability property ("an LLM outage must never swallow a paste") is right; the synchronous LLM call is not.

**New behavior:** `add_document` saves the document and returns 201 immediately. When the intake condition first becomes true, it *launches* gap analysis as a background generation and stamps its state on the case.

- **State, additive** (same posture as v2's `workflow` block): `case.workflow.stages["preop"].gap_analysis: "pending" | "running" | "complete" | "failed"` plus `gap_analysis_error: str | None`. Pre-v2 and existing case JSONs load unchanged (default `None` → field absent → UI shows nothing new).
- **Execution:** the same worker-thread-with-own-event-loop shape as stage runs (`stage_runs.py`), running `analyze_gaps` inside the shared NAT session via the v2-nat §3 bridge — a sibling entry to `periop_stage_run` (or a `mode` field on its input). This is what makes the 488 s call finally appear in Langfuse next to everything else. It acquires the same `RUN_LOCK` (one generation at a time per server, v2 §5.2, unchanged); if a stage run holds the lock, gap analysis waits in the worker, not in the provider's upload request.
- **Progress to the provider:** no new SSE endpoint. The intake screen already refetches the case; it polls `GET /api/cases/{id}` while `gap_analysis` is `pending`/`running` and renders "Preparing interview questions…" until `open_questions` is non-empty or the state is `failed` (with `gap_analysis_error` shown in words). This is a small UI change to an existing screen, not a new channel.
- **Retry, both implicit and explicit:** the current "adding the next record retries automatically" behavior is preserved (a new upload with state `failed` relaunches). Add `POST /api/cases/{id}/questions/analyze` for an explicit retry/regenerate so a provider whose last upload failed isn't forced to upload a dummy document — it 409s when questions already exist and are approved (regenerating approved questions is a reopen-shaped decision, out of scope).
- **Gates hold naturally:** the pre-op run gate already requires `questions_approved_at`; questions cannot be approved before they exist. Sharpen the 409 message when `gap_analysis` is `running`: "interview questions are still being prepared — review them when they arrive."

### 3.3 W9c — ClaimVerifier fans out

`ClaimVerifier.verify` becomes a bounded pool over the same per-claim call:

```python
def verify(self, case, artifact_id, forward_looking=False):
    artifact = case.get_artifact(artifact_id)
    ctx = contextvars.copy_context()
    with ThreadPoolExecutor(max_workers=VERIFIER_CONCURRENCY) as pool:
        futures = {
            pool.submit(ctx.run, self._verify_one, case, claim, forward_looking): claim
            for claim in artifact.claims
        }
        for future in as_completed(futures):
            future.result()   # re-raise the first failure, same as today
```

- **Verdicts land on distinct `Claim` objects** — no shared mutable state between workers; claim order in the artifact is untouched because workers mutate in place rather than append. The ledger is byte-identical to the sequential version given the same verdicts, which is exactly what the conformance test checks.
- **Context propagation is the one real trap.** `traced_llm_call` reaches NAT's intermediate-step stream through contextvars; a bare `ThreadPoolExecutor` does not propagate them, so a naive pool would make verification *silently un-traced* — repeating §1.2's bug at 62-call scale. `contextvars.copy_context().run` per task (above) is the fix, and §5 pins it with a test.
- **Concurrency default 4**, `PERIOP_VERIFIER_CONCURRENCY` to tune (0/1 = sequential). The Nano NIM serves ~34× concurrency at 16k context on the reference box, so 4 is conservative; the point of the env var is the *hosted* endpoint, where rate limits — not capacity — set the ceiling.
- The `NimChat`/OpenAI client is thread-safe (httpx pool underneath); each call already constructs its own message list.
- Expected effect at defaults: 28 s → ~8 s (pre-op), 49 s → ~13 s (post-op); ~90 s of the 118 s Nano total collapses to ~25 s.

### 3.4 W9d — post-op's two writers run concurrently

In `run_postop_stage` (`stages.py`), `HandoffComposer.compose(case)` and `PostAnesthesiaEvaluator.write(case)` execute concurrently (two threads, join both), then ClaimVerifier verifies both artifacts as today.

- **Independence is established, not assumed:** `PostAnesthesiaEvaluator.write` reads only `render_sources(case)`; `HandoffComposer.compose` reads the pre-op/intra-op artifacts, which are signed off before the stage can run (§ the run gate). Neither reads the other's artifact. The only shared mutation is `case.add_artifact` — serialize it by having each agent *return* its artifact and the stage append both in the current order (handoff first), so artifact order in the ledger is deterministic and conformance-stable.
- **Intra-op stays sequential.** `IssueAnticipator` renders `record:intra-op`'s claims into its prompt — a real input, not an accident of ordering. Cutting that input (anticipating from events + sources alone) is a quality question for the eval harness; if a future A/B shows parity, the same two-thread shape applies. Not a default in this spec.
- **SSE:** both `agent_start` events fire up front; `agent_end`/`artifact_complete` arrive in completion order. The event queue is already thread-safe (`queue.Queue`), the vocabulary is unchanged, and the UI's append-only log renders interleavings correctly as-is. The **stub runner keeps emitting sequentially** so Playwright e2e stays deterministic — the stub fabricates instant artifacts; there is nothing to overlap.
- **Both calls share one GPU**, so wall-clock gain is sub-additive: the NIM batches the two decodes and per-stream rate drops (bandwidth is shared), but aggregate throughput rises — batch-2 measured gains on this class of box are ~1.5–1.8× aggregate. Bounded expectation at current decode rates: post-op ~1,538 s → ~950–1,100 s; after W9a shrinks both completions, proportionally less absolute but the same shape. Measure on a live run per milestone rather than promising — arithmetic says the full spec is worth roughly ~68 min → ~18–25 min end-to-end (thinking-off ≈ ÷2.7 on Super completions, post-op overlap, verifier fan-out, intake off the critical path); the dev-rel-expt levers stack on top of that.

---

## 4. What must not change

- **The ledger.** The lifecycle conformance test (v2 §7) passes untouched: parallel verification and the post-op overlap must produce the identical artifact list, claim order, provenance, and verification states the sequential code produces with the same scripted chats.
- **The SSE vocabulary and gate messages** (ui.md §7, v2 §6.7) — new 409 texts are allowed (§3.2), new event types are not.
- **Document durability before any model runs** (v2's posture) — W9b strengthens it: the upload no longer even shares a request with a model call.
- **Observability parity** (v2-nat's whole point) — W9b and W9c both *add* traced calls; nothing may remove one. A run after W9 has more Langfuse coverage than before (the intake call joins), never less.

---

## 5. Testing

Same discipline as the rest of the repo — tests first, hermetic, no network in CI:

- **W9a:** unit test that `reasoning_chat()` injects the `/no_think` prefix by default and honors `PERIOP_REASONING_THINKING=1` (mirror of the existing fast-tier tests). The quality gate itself is an eval run, recorded in `evals/report.json`, not a pytest.
- **W9b:** API tests with the scripted runner — upload sequence returns 201 immediately with `gap_analysis: "running"`; questions appear and state becomes `complete` without any request blocking on it; a runner that raises marks `failed` with the message, and the next upload (and the explicit `POST …/questions/analyze`) retries; pre-op run gate 409s with the "still being prepared" message while running. Plus the v2-nat-style bracket assertion: the intake analysis emits `WORKFLOW_START`/`WORKFLOW_END` — the test that makes §1.2's hole impossible to reintroduce.
- **W9c:** with a scripted chat, verify a many-claim artifact and assert every claim got a verdict, claim order is unchanged, and — under a subscribed intermediate-step stream — one `LLM_START`/`LLM_END` pair per claim arrived (the contextvar-propagation pin). A failure-injection case: one claim's call raises → `verify` raises, no deadlock, other verdicts irrelevant (same contract as today's loop).
- **W9d:** scripted-chat post-op run using two chats with controlled completion order — assert both artifacts present, handoff first in the ledger regardless of which finished first, and the SSE stream contains both agent pairs. Conformance test rerun is the real assertion.
- **Existing suites stay green untouched:** lifecycle conformance, workflow API, Playwright e2e (stub runner unchanged and still sequential/instant).

---

## 6. Milestones

Numbered to continue `docs/progress-v2.md`'s sequence (v2-nat finished at W8d).

| # | Milestone | Exit criterion |
|---|---|---|
| W9a | `/no_think` default on the reasoning tier + env escape; eval A/B run | Both eval rows in `evals/report.json`; default flips only if no metric regresses past noise; note-writer latency ≈ ÷2.7 confirmed on the reference box |
| W9b | Intake gap analysis backgrounded, stated on the case, NAT-traced; explicit re-analyze endpoint | Op-plan upload returns in <1 s; questions arrive asynchronously with state transitions tested; the intake call appears in Langfuse |
| W9c | ClaimVerifier bounded fan-out with context propagation | Per-stage verification time ≈ ÷(concurrency) with parity ledgers; traced-steps-per-claim test green |
| W9d | Post-op writers concurrent; deterministic artifact order | Conformance test green; post-op stage wall clock < the longer of its two calls + verify on a live run |

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Thinking-off degrades note quality in ways the metrics miss | The gate is the same harness every prior model decision used (Nano-vs-Super, word boosting); the env flag makes reverting a deploy-time toggle, not a code change; per-agent re-enablement is a one-line escape (§3.1) |
| `/no_think` behaves differently on the hosted endpoint than the self-hosted NIM | The prefix is a documented Nemotron control, not a serving-stack quirk — but W9a's eval A/B runs against whichever endpoint the environment configures, so the gate travels with the deployment |
| Backgrounded gap analysis races a stage run or a second upload | Same `RUN_LOCK` as stage runs — one generation in flight per server, unchanged; state transitions are saved through the same `CaseStore` writes as today |
| A provider approves questions while a re-analysis is somehow queued | `POST …/questions/analyze` 409s once questions are approved; the implicit retry only fires from `failed` (§3.2) |
| Thread-pool verification silently loses NAT tracing (contextvars don't cross `ThreadPoolExecutor`) | `copy_context().run` per task, pinned by the traced-steps-per-claim test (§5) — the failure mode is a test failure, not a quiet observability regression |
| Parallel Super calls overrun the reasoning NIM's KV budget (6 GiB cap on the reference box) | Two streams at periop prompt sizes fit the current cap; the dev-rel-expt spec raises it with measured headroom. Degradation mode is queuing at the NIM (slower, correct), not failure |
| Interleaved SSE events confuse the UI or e2e | UI is an append-only log keyed by agent name (renders interleavings today); stub runner stays sequential so Playwright fixtures don't change; a vitest covers interleaved order parsing |
| Conformance drift from concurrent artifact appends | Agents return artifacts; the stage appends in fixed order (§3.4); the conformance test is the backstop and runs in CI |
| Speedups asserted but never re-measured (no committed benchmark) | Each milestone's exit criterion includes one live boot with a timed run, per the W7 "boot live once per milestone" lesson — the numbers land in `docs/progress-v2.md` entries rather than a committed script |
