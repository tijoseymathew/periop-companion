---
name: periop-run-evaluation
description: Evaluate the PeriOp Companion pipeline against gold labels - run scripts/run_eval.py (resumable, cached) to score provenance coverage/precision, hallucination rate, claim recall, gap-analysis precision/recall, distractor leakage, and extraction F1 over the synthetic case bundles; read and extend the eval journal in evals/README.md; run the NAT-native evaluator and profiler; and run the targeted A/B scripts. Use when asked to run the eval, benchmark the pipeline, score a change, check metrics, or profile latency in periop-companion. Trigger keywords - eval, evaluation, benchmark, metrics, report.json, LLM judge, gap recall, provenance coverage, extraction F1, NAT eval, profiler.
license: Apache-2.0
---

# Run the Evaluation

Score the pipeline against each case bundle's `gold/gold.json`: run the real
ADK pipeline over the case, then compute set metrics with an LLM-judge match
predicate. The harness lives in `src/periop/evals/` (`harness.py` scores one
case, `aggregate` means across cases, `judge.py` is the Nano-9B yes/no judge,
`metrics.py` the metric definitions). Results land in `evals/report.json`;
**`evals/README.md` is the running eval journal** — read it first, it records
every metric's noise band and known artifacts.

## Prerequisites

- `uv sync` completed; `NGC_API_KEY` in `.env`. Evaluation runs the **live**
  pipeline (Super-49B + Nano-9B) — there is no stub eval.
- Budget honestly: a full 30-case run takes **hours** and one structured-output
  flake (`IssueAnticipator … after 3 attempts`) hits ~1-in-6 cases per full
  run — re-running the failed cases clears it; scoring resumes from cache.

## Step 1: Scope the run

```bash
uv run python scripts/run_eval.py --only sg-0001        # one case first, always
uv run python scripts/run_eval.py                       # all cases with gold, cached
uv run python scripts/run_eval.py --rerun               # ignore cache, regenerate
```

The runner is **resumable**: without `--rerun` it scores cached pipeline
outputs, so a partial run continues instead of restarting, and re-scoring
after a judge/metric change is cheap. `--rerun` is the expensive flag —
reserve it for pipeline changes that invalidate outputs.

## Step 2: Read the report

`evals/report.json` holds per-case scores plus the aggregate. The headline
metrics and their current reads (see the journal for full history):

- `gap_recall` — the defect-catch signal, the gate metric (0.90 on the
  committed 30-case run).
- `preop/handoff_provenance_coverage` — at the 1.000 ceiling by construction;
  a drop means a structural regression, investigate immediately.
- `handoff_hallucination_rate`, `distractor_leakage` — lower is better.
- `preop/handoff_claim_recall`, `gap_precision`/`gap_f1`, `extraction_f1` —
  judge-based, **noisy at n=1** (per-case swings of ±0.3–0.5 on extraction);
  never conclude from a single resample. The journal documents the bands.

## Step 3: Record what you ran

Append findings to `evals/README.md` the way every prior entry does: date
heading, config (model tiers, thinking on/off, verify on/off), the
prev/new/Δ metric table, and a verdict line that separates signal from noise.
An eval that isn't journaled didn't happen.

## Step 4 (as needed): Targeted and NAT-native runs

- **A/B extraction** (Nano vs Nano→Super verify):
  `uv run python scripts/measure_extraction_ab.py [--only sg-0001 …]` — the
  measured reason `PERIOP_EXTRACT_VERIFY` defaults off.
- **Gap-catch only:** `uv run python scripts/measure_gap_catch.py`.
- **ASR A/B** (word-boosting on/off, clinical-term KER):
  `uv run python scripts/eval_asr.py [case_ids …]` — needs rendered audio.
- **NAT-native evaluator:** the same custom metrics are registered as NAT
  evaluators in `configs/eval_config.yml` (`nat eval`); `scripts/run_eval.py`
  is the reference scorer the NAT config is kept in sync with.
- **Latency profile:** `configs/profile_config.yml` + the NAT profiler consume
  the `LLM_START/LLM_END` steps → `evals/profile/` bottleneck report.

## Common mistakes to avoid

- **Do not start with a full run.** `--only` one case proves config and key
  before you spend hours.
- **Do not use `--rerun` to re-score.** Scoring changes (judge, metrics) work
  from cache; `--rerun` regenerates every pipeline output at full model cost.
- **Do not read single-case deltas as signal.** The judge metrics have
  documented noise bands; compare aggregates and direction-counts (↑/↓/=)
  like the journal does.
- **Do not average away a coverage drop.** Provenance coverage is a
  by-construction ceiling — any value below 1.000 is a structural bug, not a
  quality dip.
- **Do not treat the flake as failure.** Known ~1-in-6 structured-output
  retry exhaustion on IssueAnticipator: regenerate the failed cases and
  re-score from cache, and say so in the journal entry.
- **Do not overwrite `evals/report.json` without journaling.** The committed
  report is a named, dated run; the README entry is what makes it citable.
- **Do not kill a streaming eval run** — hours for 30 cases is normal.
