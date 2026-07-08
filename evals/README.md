# Evaluation reports

`report.json` is produced by `uv run python scripts/run_eval.py` — it runs the
pipeline over the generated cases, scores each against its gold with the LLM
judge, and aggregates the §6 metrics. The committed `report.json` is one
thinking-off run on the current default configuration (see the A/B below).

## v2-speed W9a — `/no_think` on the reasoning tier (A/B)

[specs/v2-speed.md](../specs/v2-speed.md) §3.1 makes thinking **off** the default
on the reasoning tier (Super-49B), gated on this eval: the default flips only if
no quality metric regresses past noise. To isolate the flag from every other
change since the v0.1 baseline, all rows below are the **same current code** on
sg-0002 — only `PERIOP_REASONING_THINKING` differs. Measured 2026-07-08 against
the reference self-hosted deployment (Super-49B NVFP4 @ :8000, Nano-9B @ :8001).

Two thinking-off runs are shown because they landed far apart — that spread is
the headline finding (below), not a footnote.

| Metric | thinking **on** | **off** run 1 | **off** run 2 | stable? |
|---|---|---|---|---|
| preop_provenance_coverage | 1.00 | 1.00 | 1.00 | ✓ |
| preop_provenance_precision | 0.80 | 0.76 | 0.53 | ✗ |
| handoff_provenance_coverage | 1.00 | 1.00 | 1.00 | ✓ |
| preop_claim_recall | 0.40 | 0.80 | 0.40 | ✗ |
| handoff_claim_recall | 0.00 | 0.33 | 0.00 | ✗ |
| gap_f1 | 0.00 | 0.00 | 0.00 | ✓ (0, finding 2) |
| distractor_leakage (lower better) | 0.33 | 0.33 | 1.00 | ✗ |
| handoff_hallucination_rate (lower better) | 0.00 | 0.00 | 0.00 | ✓ |
| extraction_f1 | 0.55 | 0.55 | 0.55 | ✓ |
| **wall clock (full sg-0002 pipeline)** | **53m 48s** | **10m 58s** | **10m 24s** | — |

**Verdict: the default flips to thinking-off — on the robust result (speed), not
a quality win.** The one thing this eval measures cleanly is latency:
thinking-off runs the full sg-0002 pipeline in ~11 min vs ~54 min, a **~4.9×
speedup** (better than the ÷2.7 the spec predicted for the note-writer leg alone,
because every Super-49B call in the run benefits and W9c/W9d overlap on top). The
speed result is stable across runs; the quality result is not.

**The quality gate is underpowered at n=1 — that is the real finding.** Two
thinking-off runs disagree as much as on-vs-off does: `preop_claim_recall`
swung 0.40↔0.80, `distractor_leakage` 0.33↔1.00, `preop_provenance_precision`
0.53↔0.80. These are the small-denominator, judge-dependent metrics (a 5-claim
gold set, one gold question, an LLM judge at temperature > 0); the thinking-on
sample sits *inside* the thinking-off envelope on every one of them. So "no
metric regresses past noise" is satisfied only because the noise band is wide
enough to swallow any real effect — this single case cannot detect a quality
difference between the tiers in either direction. What *is* stable across all
three runs (provenance coverage 1.00, hallucination 0.00, extraction_f1 0.55,
gap_f1 0.00) is unchanged by the flag.

The env escape hatch (`PERIOP_REASONING_THINKING=1`) makes reverting a
deploy-time toggle, and a single agent that turns out to need reasoning can
construct its own chat with `system_prefix=None` (spec §3.1) — so flipping the
default is low-regret even on this thin evidence.

**To turn this into a real quality gate** the harness needs more cases (all five
sg-000x carry gold) and, ideally, a temperature-0 judge/pipeline so the A/B is
deterministic. At n=1 with sampling noise this size, treat the quality columns as
indicative, not decisive.

## Baseline run (v0.1)

The prior committed `report.json` was an initial single-case baseline (sg-0002)
on the **old implementation**. It did its job: it surfaced concrete issues, since
addressed. The A/B above supersedes it as the current record; the table here is
kept for provenance. Because these deltas mix the `/no_think` change with every
other pipeline change since (the clock-time fix, prompt tweaks, W9b–W9d) *and*
with the run-to-run noise documented above, read them as history, not as an
isolated measurement of anything.

| Metric | sg-0002 (v0.1) | current (thinking-off, range over 2 runs) |
|---|---|---|
| preop_provenance_coverage | 1.00 | 1.00 |
| preop_provenance_precision | 0.76 | 0.53 – 0.76 |
| handoff_provenance_coverage | 1.00 | 1.00 |
| preop_claim_recall | 0.60 | 0.40 – 0.80 |
| handoff_claim_recall | 0.67 | 0.00 – 0.33 |
| distractor_leakage | 1.00 | 0.33 – 1.00 |
| handoff_hallucination_rate | 0.50 | 0.00 |
| gap_f1 | 0.00 | 0.00 (finding 2, still tracked) |
| extraction_f1 | 0.00 | 0.55 (finding 1 fixed) |

### Findings

1. **Clock-time plumbing (fixed)** — `transcript_from_voice_notes` dropped each
   note's dictation time; the extractor then invented `00:00` from segment
   offsets. The clock time is now preserved in the segment text, and
   `extraction_f1` has moved 0.00 → 0.55 (stable across all three current runs).
2. **Gold vs extraction granularity (tracked)** — gold splits `propofol`
   (agent) and `120 mg` (dose) into separate events; the extractor emits a
   combined `propofol 120`. `extraction_f1` needs a shared convention or a
   looser drug-name+time match, and `gap_f1` stays 0.00 for the analogous
   question-granularity reason. Tracked in `docs/progress.md`.
3. **Single-case noise (new, blocks a real quality gate)** — at n=1 the
   judge-dependent, small-denominator metrics (claim recall, provenance
   precision, distractor leakage) vary run-to-run by more than the on/off
   effect. Scaling the eval to the full five-case gold set and/or pinning
   temperature to 0 is the prerequisite for any decisive quality comparison.

The point of the harness is to make these measurable and drive them down; on one
case the quality metrics are noisy, so read movements of 1–2 claims as noise, not
signal.
