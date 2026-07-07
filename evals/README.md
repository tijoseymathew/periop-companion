# Evaluation reports

Two committed reports, both produced against the self-hosted NIM stack —
deployable locally and fully sovereign (see `docs/selfhosted.md`):

- **`report.json`** — `uv run python scripts/run_eval.py`: runs the full
  three-stage pipeline over every case in `data/cases/`, scores each against
  its gold bundle with the LLM judge (deterministic, greedy decoding), and
  aggregates the spec §6 metrics. Resumable and shardable (`--only`); cached
  pipeline outputs live in `data/cases/_out/`.
- **`asr_report.json`** — `uv run python scripts/eval_asr.py`: live Parakeet
  gRPC transcription of every TTS-rendered wav — the word-boosting KER A/B on
  intra-op notes plus diarization accuracy vs the TTS gold timing manifests.

## 30-case run (v0.2, 2026-07-07)

| Metric | Mean | Read as |
|---|---|---|
| preop_provenance_coverage | 1.000 | every pre-op claim carries ≥1 citation |
| preop_provenance_precision | 0.865 | 86.5% of cited claims entailed by their spans (verifier) |
| handoff_provenance_coverage | 1.000 | handoff fully cited (inherited by construction) |
| preop_claim_recall | 0.641 | share of gold pre-op claims present in the note |
| handoff_claim_recall | 0.460 | |
| handoff_hallucination_rate | 0.160 | unverified handoff claims |
| extraction_f1 | 0.515 | intra-op events vs gold (category + 5-min bucket + value) |
| distractor_leakage | 0.756 | cases where ≥1 resolved/irrelevant history item surfaced |
| gap_recall / precision / f1 | 0.100 / 0.016 / 0.028 | see finding 1 — the headline result |

### ASR (all 30 cases)

- **Word boosting works**: clinical-term KER on the lexicon-dense intra-op
  notes is **0.109 boosted vs 0.564 unboosted** — the spec §6 A/B, run live
  through Parakeet with/without the anesthesia lexicon.
- **Diarization**: time-weighted speaker attribution vs the TTS gold
  manifests averages **0.981** over 60 interviews. One outlier: sg-0005's
  post-op interview scores 0.0 — a wholesale provider/patient label swap
  (14 ASR vs 13 gold segments), exactly the degradation mode the spec risk
  table anticipates; the role-mapping heuristic needs an anchor for
  interviews the patient opens.

### Findings

1. **The GapAnalyst rarely asks about the planted defect** (gap_recall 0.10).
   Two distinct causes, separable by defect kind:
   - *missing_allergy* (18 cases): questions mentioning the defect subject
     appear in only 4/18 question lists. Absent information has no record
     chunk to trigger on, and the analyst's citations-must-resolve filter
     drops questions it can't anchor — so "is anything missing?" questions
     never survive. Follow-up: allow absence questions anchored to the
     section that *should* contain the information (med list, allergy
     section), and prompt for a completeness pass explicitly.
   - *stale_med_list* (12 cases): the defect's medication is probed in 10/12
     lists at keyword level, but the question often targets a *different*
     concern than the gold's med-reconciliation intent (verified manually:
     the judge's rejections are mostly correct). A standing "any medication
     changes since the record?" question would close most of the gap.
   - gap_precision (0.016) is low **by construction**: gold contains only the
     defect-driven question(s) (typically one) while the analyst generates
     ~7 clinically sensible questions; precision penalizes thoroughness.
     Recall is the signal to optimize.
2. **Distractor leakage remains high** (0.756 of cases leak ≥1 resolved item)
   despite the relevance-filter prompt rule (8ecb4bd). The rule reduced but
   did not fix leakage; a dedicated relevance-filter pass over emitted claims
   (cheap, fast-tier) is the next step.
3. **The constrained HandoffComposer holds up**: hallucination rate 0.160
   with full inherited provenance coverage — the architecture's core
   hallucination-control claim working as designed.
4. **Extraction granularity**: extraction_f1 0.515 with the relaxed
   (category, time-bucket, value-token) match; residual misses are mostly
   gold splitting agent/dose events that the extractor emits combined.

### Judge design notes

- Claim/fact matching uses an entailment prompt; **question matching uses a
  separate intent prompt** ("do these probe the same information gap?") —
  fact entailment misreads questions, which assert nothing, and read as an
  all-zero gap metric before the split.
- All judge calls decode greedily (temperature 0); at the default sampling
  temperature borderline verdicts flipped between scoring runs.
- The judge runs on the fast tier with reasoning disabled (`/no_think`);
  spot-check confirmed identical verdicts to reasoning-on at ~60x less
  latency. SME spot-validation of judge verdicts is still an open follow-up.
