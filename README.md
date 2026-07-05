# PeriOp Companion

An agentic peri-operative documentation assistant for anesthesia providers,
built on the NVIDIA Ambient Provider blueprint, orchestrated with **Google
ADK**, instrumented and evaluated with the **NVIDIA NeMo Agent Toolkit (NAT)**,
and grounded in Singapore demographics via **Nemotron-Personas-Singapore**.

**Every claim in every generated note carries provenance** to either a source
record chunk or a timestamped, diarized audio segment. Clinicians will not
trust — and sovereign-health regulators will not accept — generated notes that
cannot show their work.

> Reference/demonstration project. All data is **synthetic, no PHI**.
> Documentation-support tool only; **not a medical device** and not a clinical
> decision-making system.

See [specs/v1.md](specs/v1.md) for the full specification and
[docs/progress.md](docs/progress.md) for build status.

## The problem in one sentence

Three phases (pre-op, intra-op, post-op), scattered truth (documents + audio),
and trust that requires provenance.

## What it does

PeriOp Companion follows one patient through all three phases, generating
stage-appropriate documentation where each statement is traceable:

- **Pre-op** — ingests prior records, runs a **GapAnalyst** that flags what to
  clarify (missing / stale / conflicting, each citing the triggering chunk),
  transcribes the diarized interview, writes a claim-structured
  **pre-anesthesia note** aligning each generated question to the interview
  segments that answered it, and **verifies** every claim against its cited
  spans.
- **Intra-op** — transcribes the anesthetist's voice notes, extracts structured
  events (**Nemotron Nano first pass → Super verification**), writes the
  chronological record, and anticipates post-op issues with provenance spanning
  *both* stages.
- **Post-op** — composes a **PACU handoff** from existing claims only (the
  `HandoffComposer` may select/order/rephrase but never introduce a new claim —
  provenance is inherited), plus a post-anesthesia evaluation note.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Review UI (adapted ambient-provider React app / NAT UI)    │  ← last / optional
├─────────────────────────────────────────────────────────────┤
│  NeMo Agent Toolkit — observability & evaluation            │
│  • nat run / serve / eval   • OTel traces   • token/latency │
│  • custom provenance evaluators (evals/)                    │
├─────────────────────────────────────────────────────────────┤
│  Google ADK — agent orchestration                           │
│  • stages as SequentialAgent    • session state = the Case  │
├─────────────────────────────────────────────────────────────┤
│  NVIDIA NIMs (hosted via build.nvidia.com by default)       │
│  • ASR: Parakeet 1.1B + Silero VAD + Sortformer diarization │
│  • Reasoning: llama-3.3-nemotron-super-49b-v1.5             │
│  • Fast: nemotron-nano-9b-v2   • TTS: Magpie (synth only)   │
├─────────────────────────────────────────────────────────────┤
│  Storage: local JSON case store + audio artifacts           │
└─────────────────────────────────────────────────────────────┘
```

**Design rule:** ADK owns orchestration, NAT owns observability and evaluation.
See [docs/provenance-design.md](docs/provenance-design.md) for how provenance is
made structural, and [docs/attribution.md](docs/attribution.md) for what was
reused from the blueprint versus built.

## Quickstart

```bash
uv sync                 # Python 3.12 environment
uv run pytest           # run the test suite (no network)
```

Live runs need an NVIDIA API key (`NGC_API_KEY` in `.env`). No GPU required —
the default path uses hosted NIMs on build.nvidia.com.

```bash
# smoke-test the model tiers
uv run python scripts/smoke_llm.py

# generate synthetic case bundles (resumable; re-run after rate limits)
uv run python scripts/fetch_personas.py
uv run python scripts/generate_cases.py --n 5

# run one case end-to-end and print every claim with provenance
uv run python -m periop.cli.run_case sg-0001

# or drive it through NAT (ADK pipeline + profiler/traces)
uv run nat run --config_file configs/workflow.yml --input sg-0001

# evaluate against gold
uv run python scripts/run_eval.py

# render the HTML review page for processed cases (offline)
uv run python scripts/render_review.py sg-0002
```

### Self-hosted NIMs (no API key, no rate limits)

The same code runs against locally deployed NIMs — endpoint selection is
environment-driven (`PERIOP_*_BASE_URL` variables, see `src/periop/nim.py`
and spec §8.1). With all four NIMs on one GPU box:

```bash
set -a; source configs/selfhosted.env; set +a   # edit host/ports to taste
uv run python scripts/smoke_llm.py               # same commands as above
```

Reference deployment (all four NIMs co-tenant on a single DGX Spark GB10,
120 GB unified memory) is documented in `docs/selfhosted.md`.

## Provenance, made tangible

Each claim renders with its status and cited span — for audio, the speaker and
`(t0, t1)` so a reviewer knows which clip to play:

```
✓ (supported) Metformin discontinued approximately one year ago per patient report.
    ↳ [doc:med-list#c002] [Current Medications] "Metformin 500mg twice daily."
    ↳ [audio:preop-interview#s004] (PATIENT, 37.6-43.6s) "…but metformin, stopped
       already one year plus."
    ↳ [audio:preop-interview#s006] (PATIENT, 47.6-56.0s) "…HbA1c last check was
       6.2%, so doctor say can stop metformin."
```

The records still list metformin as current; the GapAnalyst catches the
conflict, and the note states the interview truth and cites it.

The same ledger renders as a self-contained HTML review page
([`data/cases/_out/sg-0002.html`](data/cases/_out/sg-0002.html), no server
needed): claims grouped by artifact with unsupported/conflicting ones
visually flagged, each expandable to its cited spans, and every citation
linking into a source-registry section — audio citations carry speaker and
time range, the anchor for clip playback once the TTS→ASR path lands.

## Synthetic data & sovereign-AI grounding

No real patients. Synthetic patients are sampled from
Nemotron-Personas-Singapore (stratified across age band × sex), each assigned a
surgery, comorbidity bundle, medication list, a **deliberate documentation
defect** (missing allergy / stale med list / record-patient conflict), and
**distractor history** (resolved/irrelevant items). The defect makes the
GapAnalyst evaluable (gold = "these questions should have been asked"); the
distractors make relevance judgment evaluable (they must not surface in notes).

## Evaluation

Custom metrics in [`src/periop/evals/`](src/periop/evals/): provenance
precision/coverage, claim recall vs gold, hallucinated-claim rate,
gap-analysis P/R, distractor leakage, structured-extraction F1, clinical-term
KER. A/B experiments: word boosting on/off, **Nano vs Super for extraction**,
constrained vs free-generation handoff. See
[`evals/report.json`](evals/) for the committed run.

## Profiling (NAT-traced live run)

`nat eval --config_file configs/profile_config.yml` runs the full pipeline
with the NAT profiler collecting every LLM call (NimChat emits
LLM_START/LLM_END intermediate steps with token usage, since the ADK plugin
only hooks litellm). Committed reports from one full case (sg-0001, hosted
NIMs on build.nvidia.com) live in [`evals/profile/`](evals/profile/):

| | Nemotron Super 49B (reasoning) | Nemotron Nano 9B (fast) |
|---|---|---|
| Calls | 7 | 44 |
| Role | note generation, gap analysis, event verification | per-claim verification, extraction first pass |
| Avg latency / call | 85.4 s | 8.1 s |
| p95 latency | 171.5 s | 17.3 s |
| Tokens (prompt + completion) | 12,833 + 16,251 | 17,717 + 15,814 |

Full case wall-clock: ~16 min, sequential. The bottleneck report
(`workflow_profiling_report.txt`) confirms the model-tiering story from
spec §8: Super's reasoning latency dominates (bottleneck score 85.4 vs 8.1),
while Nano absorbs 86% of the calls at ~10× lower per-call latency — which is
exactly why verification and the extraction first pass run on the fast tier.

## Status

M0–M5 implemented (schemas, three-stage ADK/NAT pipeline, synthetic-data
pipeline, all agents, eval harness, HTML review UI, NAT-profiled live run).
Remaining: broader eval dataset (30 cases) and the TTS→ASR audio path. Live
NIM paths (LLM tiers, full case runs, traced profiling) are exercised with an
NGC key; the ASR/TTS speech NIMs use documented hosted NVCF endpoints (see
[docs/attribution.md](docs/attribution.md)).
