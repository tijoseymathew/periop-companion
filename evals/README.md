# Evaluation reports

`report.json` is produced by `uv run python scripts/run_eval.py` — it runs the
pipeline over the generated cases, scores each against its gold with the LLM
judge, and aggregates the §6 metrics. The committed `report.json` is one
thinking-off run of the **ADK-native pipeline over all 30 cases** (below),
scored with the fixed question judge (finding 4).

## 2026-07-11 — ADK-native pipeline × 30-case dataset: first full-scale run

Two things changed at once relative to every table below, deliberately: the
pipeline is the ADK-native composition (`src/periop/adk/`, this branch) and
the dataset is the full ~30-case scale-up that `docs/progress.md` and finding
3 had been calling for. sg-0001..0005 are the original committed bundles;
sg-0006..0030 were generated fresh for this run (the old sg-0006+ directories
held only gitignored TTS wavs — their scripts/records/gold had never been
committed — so those bundles are new, and the stale wavs in other worktrees
no longer match these scripts; re-render before any ASR eval on cases 6–30).
n=1 per case, thinking-off default, live Super-49B/Nano-9B.

### Aggregate (n = 30 cases, one pipeline run each)

| Metric | mean | reading |
|---|---|---|
| preop_provenance_coverage | 1.000 | stable at ceiling, as always |
| preop_provenance_precision | 0.829 | in line with the 0.53–0.84 spread seen at n=1 |
| handoff_provenance_coverage | 1.000 | ceiling |
| preop_claim_recall | 0.630 | now a real average, not a 1-case draw |
| handoff_claim_recall | 0.423 | weakest recall metric |
| gap_recall (judge-flagged) | 0.667 | 20/30 — but see the audit below |
| gap_precision / gap_f1 | 0.125 / 0.210 | not gates (one gold probe vs ~6 questions) |
| distractor_leakage | 0.622 | **worst signal — channel identified below** |
| handoff_hallucination_rate | 0.107 | mean is fine; 3 outliers ≥ 0.43, cause identified |
| extraction_f1 | 0.526 | matches the 0.49–0.58 band from single-case runs |

Per-case rows are in `report.json` (`per_case`). The five shared cases land
inside the noise envelope of the pre-ADK single-case runs on every metric, so
nothing here suggests the ADK rewrite moved quality in either direction — the
value of this run is the n=30 denominators, which finally make the
judge-dependent metrics readable as averages.

### Gap catches audited: judge-flagged 20/30, audited-true ≈ 12–17

Every one of the 20 `gap_recall = 1.00` matches was re-derived and hand-read
(each case's kept questions re-judged against its gold probe at temperature
0 — deterministic, same verdicts as the run):

- **12 clear true catches** — explicit medication-reconciliation or
  undocumented-allergy questions that a patient's full answer would resolve
  (e.g. sg-0025: "are you still taking all the listed medications (Metformin,
  Lisinopril, Amlodipine, Dutasteride, Aspirin, Omeprazole)…?").
- **5 directional-marginal** (sg-0008, sg-0013, sg-0014, sg-0023, sg-0030) —
  a full answer plausibly-but-not-certainly surfaces the defect (e.g. "any
  medications *not listed* in your records?" catching a stale-aspirin defect
  only via the replacement drug).
- **3 false positives**: sg-0002 is the *known* GERD/omeprazole judge-FP
  family again ("why was omeprazole discontinued in 2020?" ≠ current med
  changes); two new FP shapes — sg-0019 ("any *other* meds in addition to
  the listed ones?" cannot reveal that a **listed** med was stopped) and
  sg-0009 ("any *drug* allergies not recorded?" matched a **latex**-allergy
  probe).

So the honest defect-catch rate of the ADK pipeline at n=30 is **~0.40–0.57
audited-true** (12–17/30), against 0.667 judge-flagged. The judge's error
direction is still false-positive-only, now with three known FP shapes. The
10 clean misses (sg-0003/07/12/15/16/17/20/21/22/28) plus the marginals are
the target for the GapAnalyst prompt experiment finding 4 proposed.

### Distractor leakage 0.622: the channel is unfiltered history recitation

Reading the leaked claims directly (sg-0009/13/23/24 among others), the leak
has one shape — resolved/remote history recited as past-medical-history
boilerplate — through three channels:

1. **note:post-anesthesia-eval** leaks in essentially every leaked case: it
   recites the full record history ("past medical history includes resolved
   pneumonia, healed fractured wrist, GERD (discontinued Omeprazole)") — one
   claim can match all three gold distractors. It has **no relevance-filter
   rule** in its prompt.
2. **note:pacu-handoff** carries the same recitation forward. Also
   unfiltered.
3. **note:pre-anesthesia-eval** — the one artifact that *has* the filter —
   leaks anyway, in the most instructive way: "Past History: Fractured right
   wrist (15 years ago, fully healed) — **not relevant to anesthetic plan**"
   (sg-0013). The justification-in-claim rule taught the writer to *annotate*
   irrelevance instead of *omitting* the item; the leakage metric (rightly)
   counts a mentioned distractor as leaked regardless of the disclaimer.

The fix candidates are prompt-level: omit-don't-annotate in the pre-op note
rule, and extend the filter to the handoff and post-anesthesia-eval writers.

### Handoff hallucination outliers: entailment-mode verdicts on forward-looking claims

Mean 0.107 hides three outliers (sg-0013 0.58, sg-0010 0.45, sg-0017 0.43).
Reading their handoff claims: the "unsupported" verdicts are almost entirely
the forward-looking "monitor for PONV / airway watch / glycemic control"
recommendations the handoff carries from anticipated issues. Anticipated
issues themselves are verified in the forward-looking inference mode (added
2026-07 precisely for this), but the handoff artifact is verified with
`forward_looking=False`, so identical claim content flips to "unsupported"
when it appears in the handoff. This is mostly a verifier-wiring artifact,
not new hallucination — the fix is to verify the handoff's monitoring
recommendations in inference mode (or cite the anticipated-issues artifact).

### Dataset scale-up notes (synthgen behavior at 25 fresh cases)

- Generation is robust but not clean-pass: 21/24 bundles on the first pass,
  ~8–10 min/case. sg-0021/0022 passed on plain re-runs (sampling luck).
- **sg-0020 exposed a `reveals_truth` failure mode**: its sampled defect
  truth was a full five-drug enumeration, and the check requires ≥half of the
  truth's distinctive words to be spoken by the patient — effectively
  demanding the patient recite the whole regimen; it failed deterministically
  across 3 attempts. Wiping the case and letting the designer re-sample
  produced a focused truth (Ranitidine→Omeprazole switch) that passed
  immediately. If enumeration-style truths recur, either the designer should
  be told to keep `truth` to the *delta*, or `reveals_truth` should score
  only the record↔truth diff.
- One pipeline-side flake at eval time: sg-0028's IssueAnticipator failed
  structured output 3× in one run, passed on re-run.

**Reading `gap_recall` for a single case:** still one Bernoulli draw per
case (the pre-ADK measurement below found ~15% per-sample catch on sg-0002
with 40 samples of the old implementation). At n=30 the *mean* is finally a
usable catch-rate estimate, but per-case 0/1 values remain noise.

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

**gap_recall is the metric of interest; gap_f1 is not a gate.** Each gold
case carries exactly *one* probe — the question that would surface the
planted defect — while the GapAnalyst legitimately asks ~5. The gold does not
enumerate every reasonable question, only the one that must be present, so
every additional good question counts against gap_precision. Precision is
therefore capped at ~1/5 and gap_f1 at ~1/3 *even on a perfect catch*:
a low f1 here reflects the shape of the gold, not pipeline quality.
gap_recall is effectively binary per case — did any generated question cover
the probe — and is the number that maps to the demo moment
[specs/v1.md](../specs/v1.md) §11 stakes out ("show the GapAnalyst catch the
planted defect"). f1/precision stay in `report.json` for continuity but read
as derived noise around the recall bit. `run_eval.py` prints gap_recall.

### Defect-catch measurement (2026-07-09)

gap_recall in one eval run is a single Bernoulli draw, so the catch rate was
measured directly: **40 fresh GapAnalyst samples** on sg-0002 (thinking-off
default, two batches of 10 + 30), each sample's kept questions judged against
the gold probe, every MATCH verdict then audited by hand
(`scripts/measure_gap_catch.py` repeats this):

| | catches / 40 samples | rate | 95% CI (Wilson) |
|---|---|---|---|
| question judge flagged | 12 | 30% | 18–45% |
| **manual audit (true catches)** | **6** | **15%** | **7–29%** |
| judge false positives | 6 | 15% | 7–29% |

**The Bernoulli hypothesis holds: audited catch rate ~15% (95% CI 7–29%),
every individual sample landing 0 or 1** — 6 of 40 draws caught the planted
defect, 34 missed. The single committed `report.json` (a full-pipeline run) is
one such draw and happens to be an audited-true catch (1.00); a prior
full-pipeline run was a miss (0.00) — the two full-eval draws bracket the
sampler exactly as expected.

Two stable regularities in the 40 samples:
- **True catches are genuine full-regimen reconciliation questions** — "are
  you still on the same medications as listed (Metformin, Perindopril,
  Indapamide, Atorvastatin, Amlodipine), and have there been any changes?" A
  patient answering that surfaces the planted Amlodipine discontinuation.
- **Every false positive is the same GERD/omeprazole family** — "any update
  on your GERD since omeprazole was discontinued in 2020?" The analyst asks
  this in most samples (the records document that discontinuation) and some
  phrasings slip past the judge's passing-mention clause. Judge FP rate is as
  stable as the true-catch rate, so judge-flagged (30%) ≈ true (15%) + this
  one FP family (15%).

The intermittent ~15% catch is a real pipeline quality finding, previously
invisible behind the judge bug; it likely wants a GapAnalyst prompt nudge
(explicit med-list reconciliation) gated on this now-functional metric.

**Judge choice + known error direction.** On a 20-pair audit suite built from
the samples above, Nano-9B with the directional prompt is wrong on 2/20 —
both false positives in that one GERD family, zero false negatives. The
alternatives are worse in the direction that matters more here: Super-49B
thinking-off is wrong on 5/20 and thinking-on on 6/20, all over-strict false
*negatives* (rejecting even "have there been any changes to your medications
recently?"), and thinking-on took 27 minutes for 20 pairs. So the fast-tier
judge stays. Since its errors are false positives only, a run reporting
gap_recall 1.00 deserves a glance at *which* question matched; the committed
report's catch is audited-true (the analyst asked "can you confirm you are
still taking all the medications listed … any changes in dosage or
frequency?").

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
| gap_recall (defect caught) | n/a | n/a | n/a | judge bug — unscoreable when run, finding 4 |
| gap_f1 (not a gate — see note) | n/a | n/a | n/a | judge bug — unscoreable when run, finding 4 |
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
is unchanged by the flag. (The gap rows read `n/a`, not `0.00`: under the
finding-4 judge bug the harness *did* emit 0.00 on every one of these runs,
but that was the judge failing to score any question pair, not a measurement
of the pipeline — so those cells are marked unscoreable rather than shown as a
zero. The gap metric only became real after the 2026-07-09 fix; for the
post-fix benchmark see below.)

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
| gap_recall / gap_f1 | n/a | n/a (judge bug, finding 4 — fixed 2026-07-09; post-fix catch rate ~15% below) |
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
   GapAnalyst catches sg-0002's planted defect in ~15% of samples (6/40
   audited; measured in the defect-catch section above) — gap_recall is now a
   live pipeline-quality signal, and its improvement belongs to the pipeline,
   not the harness.

The point of the harness is to make these measurable and drive them down; on one
case the quality metrics are noisy, so read movements of 1–2 claims as noise, not
signal.
