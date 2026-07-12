# ADK-native orchestration

The original implementation wrapped three monolithic Python stage functions in
custom `BaseAgent`s — ADK was a pass-through shell around code that did its
own sequencing, its own LLM calls, and its own retries. This rewrite makes the
orchestration layer *actually* ADK (spec §3.1: "stage pipelines as
SequentialAgent/LlmAgent compositions, session state = the Case"). The
`periop.adk` package is the implementation; `periop.agents` keeps the prompts,
output schemas, and apply logic, plus thin facades so standalone callers and
the existing test seams are unchanged.

## The composition

```
periop_pipeline (SequentialAgent)
├── preop_stage (SequentialAgent)
│   ├── record_ingestor          custom agent   chunk records → sources
│   ├── gap_analyst              LoopAgent      [writer LlmAgent → validator]
│   │                                           skipped when questions exist (v2 §4.1)
│   ├── interview_transcriber    custom agent   diarized audio source
│   ├── preop_note               LoopAgent      [writer LlmAgent → validator]
│   └── preop_verifier           ClaimVerifierAgent fan-out (fast tier)
├── intraop_stage (SequentialAgent)
│   ├── voice_note_transcriber   custom agent
│   ├── event_first_pass         LoopAgent      Nano first pass (spec §8 tiering)
│   ├── event_verify             LoopAgent      Super verification
│   ├── intraop_record           LoopAgent
│   ├── issue_anticipator        LoopAgent
│   └── intraop_verifier         ClaimVerifierAgent × 2 (record, issues)
└── postop_stage (SequentialAgent)
    ├── postop_transcriber       custom agent
    ├── postop_writers (ParallelAgent)          independent by design (v2-speed §3.4)
    │   ├── handoff              LoopAgent      composes from existing claims only
    │   └── postop_eval          LoopAgent
    ├── postop_ledger            custom agent   commits both artifacts handoff-first
    └── postop_verifier          ClaimVerifierAgent × 2
```

## The structured step (`periop.adk.steps.structured_step`)

Every LLM agent of the spec is one generate→validate `LoopAgent`:

- The **writer** is an `LlmAgent` whose `before_model_callback` renders the
  step's user message from the Case in session state and appends the same
  JSON-Schema instruction block `NimChat.complete_structured` used — live
  prompts are byte-identical to the pre-ADK pipeline. `include_contents="none"`
  plus an explicit system instruction keeps the session transcript and ADK's
  identity boilerplate out of the request.
- The **validator** is a custom agent that parses the reply (same
  candidate-scanning JSON extraction as before), runs the step's `apply_fn`
  (citation filtering, ledger writes — hallucinated citations are dropped,
  spec §4.1), and escalates out of the loop on success. On failure it records
  the validation error in state; the next loop iteration's writer prompt
  carries the rejected reply + error as corrective feedback. Exhausting
  `max_iterations` raises, exactly like `complete_structured` did.

## Models

`periop.adk.model.ChatModel` is a `BaseLlm` adapter over the project's chat
protocol, so `LlmAgent` steps drive the same endpoint-resolved (`PERIOP_*`
vars), `/no_think`-configured, NAT-traced `NimChat` tiers as before. Test
doubles that only implement `complete_structured` (the historical stub seam)
are honored by a fallback that serializes their pydantic result back to JSON
text — both paths exercise the same validator and apply logic.

## Claim verification (`periop.adk.verifier.ClaimVerifierAgent`)

Verdicts are independent, so the agent builds one verdict step per claim
(each with its own state keys) and runs them in dynamically-built
`ParallelAgent` batches of `PERIOP_VERIFIER_CONCURRENCY` (default 4; `0`/`1`
= sequential for rate-limited hosted endpoints). Ledger order and statuses
are identical to the sequential version.

## Seams kept

- `run_preop_stage` / `run_intraop_stage` / `run_postop_stage` /
  `run_case_stages` keep their Case → Case signatures (the write API, CLI,
  and conformance tests call them) but now drive the ADK stage agents via
  `periop.adk.runtime.run_agent` — a sync bridge that is safe under a running
  event loop (the NAT function's deliberately-blocking contract, v2-nat §3.1)
  and unwraps `ParallelAgent` ExceptionGroups to the underlying error.
- SSE progress (ui.md §7) flows through a contextvar bridge: step callbacks
  emit the same `agent_start` / `agent_end` / `artifact_complete` protocol,
  in the same order, as the old stage functions.
- Facade classes (`GapAnalyst`, `PreOpNoteWriter`, `EventExtractor`, …) run
  single-step ADK pipelines, so intake gap analysis and the A/B eval arms
  execute through the same agents as the full pipeline.
