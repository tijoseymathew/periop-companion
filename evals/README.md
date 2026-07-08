# Evaluation reports

`report.json` is produced by `uv run python scripts/run_eval.py` — it runs the
pipeline over the generated cases, scores each against its gold with the LLM
judge, and aggregates the §6 metrics. The committed `report.json` is one
thinking-off run on the current default configuration, scored with the fixed
question judge (finding 4 below).

## 2026-07-09 — gap_f1 was structurally zero: judge bug, fixed

Every run in every table below scored `gap_f1 = 0.00`. That was not the
pipeline: the judge asked whether two texts "express the same clinical fact",
which is right for claims but systematically answers NO for *questions* —
a generated question semantically identical to the gold probe ("can you
confirm you are still taking all the medications listed … and have not
started or stopped any?" vs gold "have you stopped or changed any medications
in the past year?") judged NO 5/5. The gap metric could never score, no
matter what the GapAnalyst did.

The judge now has a question-mode prompt (`LlmJudge.matches_questions`) that
asks the directional question the metric means: *would a full answer to the
generated question give the interviewer what the gold probe seeks?* A
symmetric "same issue" phrasing was tried first and produced one false
positive ("any update on your GERD since omeprazole was discontinued?"
matched the med-change probe on the shared discontinued-drug detail); the
directional prompt rejects it. Validated 18/18 on generated-question pairs
across all five case golds, deterministic 2/2 per pair. Both judge modes now
run at temperature 0, removing the judge's own run-to-run noise (part of
finding 3).

With the metric un-pinned, the honest picture on sg-0002 (thinking-off):
the GapAnalyst catches the planted stale-med defect in **~1 of 5 samples**
(gap_recall 1.0 when it asks a med-reconciliation question, 0.0 otherwise —
the committed report is a miss run). Two structural notes for reading the
numbers: gold carries a single probe per case while the analyst asks ~5
questions, so gap_precision is capped at ~0.2 and gap_f1 at ~0.33 even on a
perfect catch — **gap_recall is the defect-catch signal to watch**. The
intermittent catch is a real pipeline quality finding, previously invisible;
it is exactly the demo moment [specs/v1.md](../specs/v1.md) §11 stakes out
("show the GapAnalyst catch the planted defect"), so it likely wants a
GapAnalyst prompt nudge (med-list reconciliation) gated on this
now-functional metric.

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
| gap_f1 | 0.00 | 0.00 | 0.00 | ✓ (0, but see finding 4 — judge could not score questions) |
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
three runs (provenance coverage 1.00, hallucination 0.00, extraction_f1 0.55)
is unchanged by the flag. (gap_f1 was also "stably" 0.00 across all three —
that stability was an artifact of the judge bug in finding 4, not a
measurement.)

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
| gap_f1 | 0.00 | 0.00 (judge bug, finding 4 — fixed 2026-07-09) |
| extraction_f1 | 0.00 | 0.55 (finding 1 fixed) |

### Findings

1. **Clock-time plumbing (fixed)** — `transcript_from_voice_notes` dropped each
   note's dictation time; the extractor then invented `00:00` from segment
   offsets. The clock time is now preserved in the segment text, and
   `extraction_f1` has moved 0.00 → 0.55 (stable across all three current runs).
2. **Gold vs extraction granularity (tracked)** — gold splits `propofol`
   (agent) and `120 mg` (dose) into separate events; the extractor emits a
   combined `propofol 120`. `extraction_f1` needs a shared convention or a
   looser drug-name+time match. (This finding previously also blamed
   "question granularity" for gap_f1 = 0 — that attribution was wrong; see
   finding 4.) Tracked in `docs/progress.md`.
3. **Single-case noise (partially addressed, still blocks a real quality
   gate)** — at n=1 the judge-dependent, small-denominator metrics (claim
   recall, provenance precision, distractor leakage) vary run-to-run by more
   than the on/off effect. The judge now runs at temperature 0 (2026-07-09),
   so re-scoring the *same* artifacts is deterministic; the pipeline's own
   sampling noise remains, and scaling to the full five-case gold set is
   still the prerequisite for any decisive quality comparison.
4. **Question judge could not score questions (fixed 2026-07-09)** — the
   single "same clinical fact" judge prompt answers NO for equivalent
   *questions*, pinning gap_precision/recall/f1 at 0 in every run above,
   independent of pipeline behavior. Fixed with a directional question-mode
   prompt (see the dated section at the top). First honest readings: the
   GapAnalyst catches sg-0002's planted defect in ~1 of 5 samples —
   gap_recall is now a live pipeline-quality signal, and its improvement
   belongs to the pipeline, not the harness.

The point of the harness is to make these measurable and drive them down; on one
case the quality metrics are noisy, so read movements of 1–2 claims as noise, not
signal.
