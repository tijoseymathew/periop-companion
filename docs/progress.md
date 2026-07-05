# Build progress

Resumable checklist for building [specs/v1.md](../specs/v1.md). Each item lands as
one or more commits with passing tests. If a session is interrupted (rate limits),
resume from the first unchecked item. Conventions:

- Python env: `uv sync` (Python 3.12, pinned in `.python-version`).
- Run tests: `uv run pytest`.
- TDD: every feature commit contains its tests; tests were written first (red) then
  implementation (green).
- Manual smoke tests against live NIMs use `NGC_API_KEY` from `.env` and live in
  `scripts/` — they are never run in CI/pytest.

## M0 — Skeleton

- [x] Repo scaffolding: pyproject (uv), pytest wiring, package layout `src/periop/`
- [x] Schemas: `Case`, `Source` (document chunks / audio segments), `Claim`,
      `Artifact`, `Event`, provenance references (`source_id#anchor`)
- [x] Deterministic chunker: markdown/text → stable, citable chunk IDs
- [x] Case store: JSON persistence, append-only source registry
- [x] NIM client wrapper: OpenAI-compatible chat client for build.nvidia.com
      (reasoning + fast model tiers), mocked in tests
- [x] Live smoke test script (`scripts/smoke_llm.py`) verified with NGC key
- [x] ADK stage pipeline stubs (pre-op / intra-op / post-op) runnable end-to-end
      with stub tools
- [x] NAT wiring: register workflow, `nat run` executes a trivial 3-stage pass

## M1 — Synthetic data v1

- [x] Persona sampling from Nemotron-Personas-Singapore (or bundled sample)
- [x] CaseDesigner: profile → surgery + comorbidities + meds + planted defect
      + distractor history
- [x] Prior-records pack generator (GP summary, med list, old anesthetic record)
- [x] Scripted pre-op interview / intra-op voice notes / post-op interview (gold
      diarized transcripts)
- [x] Gold artifacts with claim/provenance annotations
- [ ] TTS rendering via Magpie TTS NIM (verify current model ID at build time)
- [x] 5 cases end-to-end (data/cases/sg-0001..0005)

## M2 — Pre-op stage

- [x] RecordIngestor tool (chunker + source registry)
- [x] GapAnalyst agent (questions w/ reason + provenance)
- [x] InterviewTranscriber — gold-transcript path (Parakeet NIM path pending TTS audio);
      fallback path for offline dev)
- [x] PreOpNoteWriter (claims-structured note) + question→answer alignment
- [x] ClaimVerifier (NLI-style supported/unsupported/conflicting)
- [x] Provenance links render in CLI

## M3 — Intra-op + post-op

- [x] VoiceNoteTranscriber — gold path + word-boosting lexicon (streaming Parakeet pending audio)
- [x] EventExtractor (nano first pass → super verification, strict JSON schema)
- [x] IntraOpRecordWriter
- [x] IssueAnticipator (cross-stage provenance)
- [x] HandoffComposer (constrained: select/order/rephrase existing claims only)
- [x] PostAnesthesiaEvaluator
- [x] Full case runs end-to-end (ADK-driven + CLI runner)

## M4 — Eval harness

- [x] Custom evaluators (periop.evals.metrics): provenance precision/coverage,
      claim recall vs gold, hallucinated-claim rate, gap-analysis P/R,
      distractor leakage, extraction F1, KER. LLM-judge matcher (evals.judge).
- [~] 30-case dataset — pipeline + resumable generator in place; 5 cases
      generated so far (scale up when rate limits allow).
- [x] A/B experiments: nano vs super extraction (evals.ab). Word-boosting and
      constrained-vs-free handoff wired via flags; full audio A/B pending TTS.
- [x] Eval runner (scripts/run_eval.py) → evals/report.json committed.
      NAT-native evaluator registration documented in configs/eval_config.yml.

## M5 — Polish

- [x] README with architecture diagram + quickstart
- [x] docs/provenance-design.md, docs/attribution.md
- [ ] Review UI (adapted blueprint frontend) — last, per risk table
- [ ] Profiler screenshot/report in README (needs a NAT-traced live run)

## Notes / decisions log

- 2026-07-05: Project started. Python 3.12 (nvidia-nat 1.8.0 requires <3.14).
  Heavy deps (google-adk, nvidia-nat[adk]) added only when first needed to keep
  early commits fast to install.
- 2026-07-05: nvidia-nat[adk] 1.8.0 resolves cleanly with google-adk 1.36.0
  (not 2.x). NAT functions register via the `nat.components` entry point.
- 2026-07-05: Live smoke test — Nemotron Nano extracted "one twenty
  milligrams" as 20mg; structured-output retries now feed validation errors
  back to the model. Keeps §3.4's nano→super verification well motivated.
- 2026-07-05: Spec §5 drift — the published Nemotron-Personas-Singapore
  schema has no `healthcare_persona`/ethnicity fields. Stratified sampling
  runs on age band × sex instead (48 personas, 6 per stratum, seed 42,
  committed at data/synthgen/personas_sample.jsonl, CC-BY-4.0).
- 2026-07-05: Full pipeline verified live on sg-0002 (5 artifacts, 50
  provenance-carrying claims across pre-op docs, intra-op voice notes, post-op
  interview). Baseline eval (evals/report.json, evals/README.md) surfaced:
  (a) a clock-time plumbing bug in transcript_from_voice_notes — FIXED;
  (b) gold-vs-extraction event granularity mismatch (gold splits agent/dose;
  extractor combines) — TODO: shared convention or looser extraction match;
  (c) distractor leakage into notes — TODO: strengthen relevance filtering;
  (d) post-op note/handoff verification is partial — TODO: verify all artifacts.

## Known follow-ups (surfaced by the baseline eval)

- Align gold intra-op event granularity with the extractor (or relax
  extraction_f1 to drug-name + time-bucket) — currently reads 0.0.
- Strengthen the note-writer's relevance filtering so distractors don't leak;
  measure with distractor_leakage.
- Verify all generated artifacts (post-op note, anticipated issues), not just
  pre-op note + handoff.
- Scale the dataset to ~30 cases and re-run the eval for stable aggregates.
- Add a NAT profiler screenshot/report to the README from a traced live run.
