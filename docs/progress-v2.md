# Build progress — v2 provider workflow

Resumable checklist for building [specs/v2.md](../specs/v2.md) (case lifecycle,
write API, capture UI) on the `v2` branch. Same conventions as
[progress.md](progress.md): every item lands as one or more commits with tests
written first (red) then implementation (green); if a session is interrupted,
resume from the first unchecked item.

- Python: `uv run pytest` · UI units: `cd ui && npm test` · E2E: `cd ui && npm run test:e2e`
- ffmpeg is optional on dev machines: audio-normalization tests skip gracefully
  without it; wav uploads work ffmpeg-free.
- Live NIM smoke checks stay in `scripts/`, never CI.

## W0 — Schema + store

- [x] `Provider`, `StageState`, `Workflow` models; `Case.workflow` optional so
      every existing case JSON loads unchanged (a case without `workflow` is
      immutable demo data)
- [x] `open_questions` upgraded to `OpenQuestion` objects (question, reason,
      provenance, review, edited_text) with coercion from the legacy plain-string
      form; GapAnalyst stores full questions, PreOpNoteWriter aligns against the
      reviewed list, UI zod schema accepts both forms
- [x] `Source.captured_at` / `provided_by` (optional)
- [x] `CaseStore.save` atomic (temp file + rename)

## W1 — Intake

- [x] `GET /api/providers` roster from `data/providers.json`
- [x] `POST /api/cases` — skeleton case with `workflow` block; write-guard: every
      write endpoint 409s on demo cases
- [x] `POST /api/cases/{id}/sources/document` — paste/upload → records/ file →
      chunked source; ~5 MB cap; traversal rejection; GapAnalyst auto-run (via
      injectable runner) once op plan + ≥1 record exist
- [x] `PUT /api/cases/{id}/questions` — approve/dismiss/edit persisted, gate stamped

## W2 — Audio + stage runs

- [x] `POST /api/cases/{id}/sources/audio` — normalize to 16 kHz mono wav under
      `data/cases/{id}/audio/`; intra-op kind appends memos; others
      replace-with-confirmation; ~50 MB cap
- [x] `POST /api/cases/{id}/stages/{stage}/run` — gate + input validation,
      single-run lock, SSE per ui.md §7, invokes the matching stage runner
- [x] `POST .../stages/{stage}/signoff` · `.../reopen` · `POST .../handoff/ack`

## W3 — UI

- [x] Worklist sidebar (stage + status in words, performed-by, conflict
      indicator, filters) + provider picker + New case; demo cases read-only
- [x] Stage rail (Pre-op / Intra-op / Post-op stepper) above the center pane
- [x] Intake form + question review screens (center pane, pre-artifact)
- [x] Recorder (MediaRecorder + upload fallback), intra-op memo capture
- [x] Stage panels: one primary action per state (unit-tested), one-sentence
      status copy, SSE progress rendering
- [x] Sign-off screen (unsupported/conflicting counts + jump list), intra-op
      orientation view, handoff acknowledge

## W4 — Conformance + e2e

- [x] Lifecycle conformance test: API walk of a synthetic case reproduces the
      batch pipeline's ledger (stub chats)
- [x] Playwright e2e: full three-provider lifecycle against the real API with a
      stubbed instant runner (`PERIOP_STUB_RUNNER=1`)

## W5 — Polish

- [x] README v2 section; UX pass against spec §6 checklist; docs finalized

## W6 — Stretch (spec §2 stretch list)

- [x] W6a-api: per-claim review actions (mark reviewed / flag) persisted as
      sidecar state (`_out/<case_id>.review.json`, atomic write; the case
      ledger itself stays untouched); `GET`/`PUT` endpoints, demo cases 409
- [x] W6a-ui: review/flag buttons on claim rows; sign-off screen counts
      reviewed/flagged and flagged claims join the jump list
- [x] W6b: "my cases" worklist filter (any stage performed/signed off by me,
      or created by me)
- [x] W6c: department dashboard view (cases by stage × status, awaiting-review
      queue, conflict totals — derived from the case summaries client-side)
- [x] W6d: tablet-width layout — below `lg` the provenance rail hides and the
      worklist becomes a toggleable drawer, so the intra-op capture screen is
      a single big column; tablet-viewport Playwright spec
- [x] W6e-api: streaming intra-op ASR — WebSocket
      `/api/cases/{id}/sources/audio/stream` taking 16 kHz PCM16 frames,
      feed/finish transcriber seam (fake in tests/e2e, Riva streaming adapter
      live), PCM appended to the memo wav ffmpeg-free, final segments
      registered on `audio:intraop-notes` with wav-offset times
- [x] W6e-ui: live dictation on the intra-op capture screen (mic → PCM
      downsample → WS, live partial/final transcript, memo recorder as the
      fallback); streaming e2e with fake media device
- [x] W6f: live streaming smoke script (`scripts/smoke_stream_asr.py`),
      README stretch section, demo recording
      (`docs/images/provider-workflow-demo.webm`, captured from the hermetic
      lifecycle e2e with `PW_VIDEO=1`), docs finalized

All spec §2 stretch items are shipped; the v2 build is complete.

## W7 — Live-server hardening (found by running the real server live)

The hermetic e2e (`PERIOP_STUB_RUNNER=1`) and script-level NIM smokes never
booted `python -m periop.api` in live mode, so two live-only defects survived
W0–W6. Lesson recorded: every milestone that touches the serving path ends
with a live-mode boot + one real submission, not just the stub walk.

- [x] W7a: `create_app` loads `.env` (cwd-resolved, never overriding real env)
      — uvicorn/`python -m periop.api` bypassed the CLI wrappers that call
      `load_dotenv`, so live runs died with a missing-key error at submit time;
      entry point also warns when a chat-tier URL points at the API's own port
      (the `.env` reasoning NIM and the API both default to :8000 — the server
      would deadlock calling itself)
- [x] W7b: gap analysis off the event loop — the GapAnalyst call in
      `POST /sources/document` ran synchronously inside the async handler,
      freezing every request (the whole UI) for the duration of a live LLM
      call; now `run_in_threadpool`, with the document saved *before* question
      prep (a model outage 502s with "the document was saved…" instead of
      swallowing the paste) and the next added record retrying automatically
- [x] W7c: the intake form says what is happening while it saves ("preparing
      interview questions can take a minute") instead of a silently dimmed
      button; vite dev proxy honors `PERIOP_API_PORT`

## W8 — NAT-traced live runs ([specs/v2-nat.md](../specs/v2-nat.md))

Close the observability gap: live stage runs from the browser execute inside a
real NAT `Runner` (traced/profiled/exported like a batch `nat eval` row), with
Langfuse export opt-in by environment (`LANGFUSE_PUBLIC_KEY` /
`LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` — all set → traced, any missing →
one startup warning, zero exporters, never a crash).

- [x] W8a: `periop_stage_run` NAT function (stage-sized sibling of
      `periop_pipeline`, never fabricates a case) + `configs/api.yml`
      (deliberately telemetry-free); JSON-string input converter so
      `nat run --config_file configs/api.yml --input
      '{"case_id": "sg-0001", "stage": "preop"}'` runs one stage standalone
      (stub-mode standalone run verified; the live-NIM standalone run is
      exercised against a scratch copy of the sg-0001 bundle so committed
      demo cases stay untouched — result recorded under W8d);
      `StageRunBridge`/`_LIVE_BRIDGE` contextvar seam for the API's runner +
      SSE emit (wired in W8b)
- [x] W8b: API lifespan builds/holds the shared NAT session
      (`load_workflow(configs/api.yml)`); `stage_runs.py`'s worker thread runs
      the stage inside a NAT `Runner` via `periop.api.nat_bridge` (own event
      loop per run — NAT's documented per-request pattern) with the
      contextvar bridge carrying runner + SSE emit; an API stage run logs its
      intermediate-step sequence and the new `TestNatWiring` asserts
      `WORKFLOW_START` precedes `WORKFLOW_END` (pins the direct-call bypass
      shut); success path reloads the case from the store before stamping
      awaiting-review (the NAT function saved its own copy — re-saving the
      handler's stale object would have clobbered the artifacts); UI SSE
      vocabulary unchanged (asserted + Playwright suite green untouched)
- [x] W8c: optional Langfuse tracing via the `opentelemetry` extra —
      registered component `_type: periop_langfuse`
      (`periop.nat.observability`) referenced by all four committed configs;
      env decides on/off (all three vars → stock Langfuse exporter, any
      missing → one warning + no-op exporter, asserted in
      `tests/test_nat_observability.py`); verified boot without credentials
      is healthy with exactly one warning; tests/e2e pin empty `LANGFUSE_*`
      so suites never export traces even when `.env` holds real credentials
      (unguarded, the suite exported stub traces and tripled its runtime)
- [x] W8d: parity artifact — `scripts/smoke_live_trace.py` boots the real
      server with live NIMs + real credentials, drives one pre-op stage run
      through `POST /stages/preop/run`, and fetches the trace back out of
      Langfuse; committed as `evals/traces/live-preop-trace.json`; README
      shows the live path's Langfuse trace alongside the batch profiler
      report. The W8a live standalone `nat run` also completed against a
      scratch sg-0001 bundle (~22 min on the local Super-49B).

The W7 lesson paid out again: the first live smoke produced a trace with the
workflow bracket and **zero LLM observations** — invisible to every hermetic
test. `periop_stage_run` ran the stage via `asyncio.to_thread`, so
`traced_llm_call` pushed steps from a thread with no running event loop and
the OTel exporter dropped every LLM span ("Cannot create export task"). The
batch path never had the bug because `periop_pipeline` blocks the loop
thread; the stage function now does the same (safe: the API gives each stage
run a private per-thread loop), pinned by
`test_stage_runs_on_the_event_loop_thread`.

## W9 — Speed ([specs/v2-speed.md](../specs/v2-speed.md))

Remove the latency the application controls: a live e2e benchmark put one
case at ~68 min, 96.6% of it inside seven Super-49B calls decoding at
7.7 tok/s, most of those tokens `<think>` reasoning the pipeline strips.
Serving-side throughput is the dev-rel-expt repo's spec; this workstream
only cuts tokens and adds concurrency. Each milestone's exit includes a
timed live boot (the W7 lesson) — numbers land in these entries as they
are measured.

- [x] W9a: `/no_think` default on the reasoning tier
      (`periop.nim.reasoning_chat`), mirroring the fast tier's mechanism;
      `PERIOP_REASONING_THINKING=1` restores thinking for A/B runs, and an
      agent that needs thinking back can pass `system_prefix=None` at its
      own callsite. Validated live before the change: the identical
      PreOpNoteWriter call ran 129.6 s vs 349.0 s (2.7×) with a comparable
      claim-structured note. The eval A/B gate (spec §3.1 — gold-set run
      thinking-on vs thinking-off, both rows into `evals/report.json`) is a
      live-endpoint step, still to run; if any metric regresses past noise
      the default flips back by inverting the env check, a deploy-time
      toggle.
- [x] W9b: intake gap analysis off the request path — document uploads
      return when the document is durable (the 488 s op-plan upload becomes
      instant); the GapAnalyst runs as a background generation *inside the
      shared NAT session* (`mode: "gap_analysis"` on `periop_stage_run`,
      closing §1.2's observability hole — a bracket test pins it like
      W8b's), stamped on the case as
      `workflow.stages.preop.gap_analysis: pending → running → complete |
      failed` (+ `gap_analysis_error`), serialized with stage runs by the
      same `RUN_LOCK`. Explicit `POST …/questions/analyze` retry (409 once
      questions are approved); the implicit next-upload retry preserved;
      approving questions 409s while a re-analysis is in flight; a boot-time
      sweep fails analyses stranded by a crash. The intake screen polls the
      case and narrates the wait; failures name the error and offer "Try
      again". Found while building: concurrent whole-object saves (the gap
      worker vs the next upload) collide on the store's temp file and eat
      each other's updates — `CaseStore.mutate` (read-modify-write under a
      process-wide lock, thread-unique temp names) now carries every write
      that can race, pinned by a two-writer store test and the conformance
      walk.
- [ ] W9c: ClaimVerifier bounded fan-out (`PERIOP_VERIFIER_CONCURRENCY`,
      default 4) with contextvar propagation into worker threads so
      verification stays traced.
- [ ] W9d: post-op's independent Super calls (HandoffComposer ∥
      PostAnesthesiaEvaluator) overlap; artifact order stays deterministic
      (handoff first). Intra-op stays sequential — IssueAnticipator reads
      the intra-op record's claims, a real dependency.

## UX review against spec §6 (W4 exit criterion)

1. **One primary action per case state** — `primaryAction()` in
   `ui/src/lib/workflow.ts` is the single state machine every screen asks;
   unit-tested across the whole lifecycle (`workflow.test.ts`), and the e2e
   walk completes the workflow using only the big buttons. Read-only demo
   cases render zero `data-primary-action` elements (asserted in
   `lifecycle.spec.ts`).
2. **The screen explains itself** — every capture screen opens with one
   sentence (`CAPTURE_SENTENCES` / `GENERATE_SENTENCES` in `StagePanel.tsx`);
   empty worklist-filter state and empty stages carry instructions.
3. **Speech first, typing last** — the case label is the only obligatory
   typing (the e2e walk types nothing else: everything is paste, upload, or
   click); question edits are optional.
4. **Clinical vocabulary** — "Pre-op evaluation", "PACU handoff", "sign off",
   status words like "awaiting review" (`STATUS_WORDS`); no "pipeline",
   "artifact", or "claim extraction" in provider-facing copy. The review
   workspace keeps "claims" deliberately (load-bearing there).
5. **Legible at arm's length** — primary buttons are min-h 44–56 px with text
   labels; no icon-only actions (icons always accompany text); the record
   button is the largest control on its screen.
6. **Nothing to configure** — the provider picker is the only setup, one
   select in the header, persisted locally; no settings screen exists.
7. **Errors say what to do** — recorder failures keep the audio and offer
   Retry ("kept on this device"); microphone refusal points at the upload
   fallback; API gate 409s name the next action and are surfaced verbatim;
   unit-tested in `Recorder.test.tsx` and `tests/test_workflow_api.py`.
8. **The worklist answers "what needs me"** — label, headline stage + status
   in words, who acted last, conflict glyphs, stage/status filters
   (`Worklist.test.tsx`, `workflow.test.ts`).

## Design deviations from the spec (documented, deliberate)

- The post-op stage runs as one generation (handoff + post-anaesthesia note)
  gated on the post-op interview, matching the batch pipeline's
  `run_postop_stage` — the spec's §4.3 sketches the handoff generating before
  the interview. Keeping one runner preserves the lifecycle-conformance
  guarantee; splitting it is a candidate follow-up.
- Regeneration after reopen is not offered: reopen returns a stage to
  review/sign-off with prior artifacts kept (§4.5's "rather than silently
  regenerated" reading). Changing inputs after generation requires a new case.
- v2-nat §3.5 sketches an `apply_optional_telemetry(config)` helper called
  "after `load_config`" in every entry point. The API lifespan could do that,
  but the batch path is NAT's own CLI (`nat run` / `nat eval`) with no hook
  between config load and workflow build — the helper could never reach it
  without wrapper scripts. Implemented instead as a registered NAT component
  (`_type: periop_langfuse`) that performs the identical env check at
  exporter-build time: one credential check, one warning, one destination for
  batch and live alike, which is the requirement the helper was drafted to
  meet. The committed YAML block is non-secret and inert without credentials,
  preserving §3.2's "whether tracing is on is an environment decision."
