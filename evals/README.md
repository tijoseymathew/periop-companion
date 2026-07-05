# Evaluation reports

`report.json` is produced by `uv run python scripts/run_eval.py` — it runs the
pipeline over the generated cases, scores each against its gold with the LLM
judge, and aggregates the §6 metrics.

## Baseline run (v0.1)

The committed `report.json` is an initial single-case baseline (sg-0002). It
did its job: it surfaced two concrete issues, one now fixed and one tracked.

| Metric | sg-0002 | Read as |
|---|---|---|
| preop_provenance_coverage | 1.00 | every pre-op claim carries a citation |
| preop_provenance_precision | 0.76 | 76% of cited pre-op claims the verifier entails |
| handoff_provenance_coverage | 1.00 | handoff fully cited (inherited) |
| preop_claim_recall | 0.60 | 60% of gold pre-op claims present |
| handoff_claim_recall | 0.67 | |
| distractor_leakage | 1.00 | **finding**: distractors leaked into the note |
| handoff_hallucination_rate | 0.50 | unverified handoff claims (post-op note/handoff verification is partial) |
| gap_f1 | 0.00 | **finding**: generated questions didn't match the single gold question under the judge |
| extraction_f1 | 0.00 | **bug (fixed)**: voice-note clock times were dropped, so events got `00:00`; also gold decomposes agent/dose separately from the extractor |

### Findings

1. **Clock-time plumbing (fixed)** — `transcript_from_voice_notes` dropped each
   note's dictation time; the extractor then invented `00:00` from segment
   offsets. Now the clock time is preserved in the segment text. Re-run to
   refresh `extraction_f1`.
2. **Gold vs extraction granularity (tracked)** — gold splits `propofol`
   (agent) and `120 mg` (dose) into separate events; the extractor emits a
   combined `propofol 120`. `extraction_f1` needs a shared convention or a
   looser drug-name+time match. Tracked in `docs/progress.md`.
3. **Distractor leakage** — resolved history (e.g. old pneumonia) surfaced in
   the note. This is the relevance-judgment signal the metric exists to catch;
   the note-writer prompt's "do not include resolved/irrelevant history"
   instruction needs strengthening (or a dedicated relevance filter).

The point of the harness is to make these measurable and drive them down; this
baseline is the starting point, not the target.
