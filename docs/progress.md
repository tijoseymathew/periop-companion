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
- [ ] ADK stage pipeline stubs (pre-op / intra-op / post-op) runnable end-to-end
      with stub tools
- [ ] NAT wiring: register workflow, `nat run` executes a trivial 3-stage pass

## M1 — Synthetic data v1

- [ ] Persona sampling from Nemotron-Personas-Singapore (or bundled sample)
- [ ] CaseDesigner: profile → surgery + comorbidities + meds + planted defect
      + distractor history
- [ ] Prior-records pack generator (GP summary, med list, old anesthetic record)
- [ ] Scripted pre-op interview / intra-op voice notes / post-op interview (gold
      diarized transcripts)
- [ ] Gold artifacts with claim/provenance annotations
- [ ] TTS rendering via Magpie TTS NIM (verify current model ID at build time)
- [ ] 5 cases end-to-end

## M2 — Pre-op stage

- [ ] RecordIngestor tool (chunker + source registry)
- [ ] GapAnalyst agent (questions w/ reason + provenance)
- [ ] InterviewTranscriber (Parakeet NIM offline + diarization; gold-transcript
      fallback path for offline dev)
- [ ] PreOpNoteWriter (claims-structured note) + question→answer alignment
- [ ] ClaimVerifier (NLI-style supported/unsupported/conflicting)
- [ ] Provenance links render in CLI

## M3 — Intra-op + post-op

- [ ] VoiceNoteTranscriber (streaming profile + word boosting lexicon)
- [ ] EventExtractor (nano first pass → super verification, strict JSON schema)
- [ ] IntraOpRecordWriter
- [ ] IssueAnticipator (cross-stage provenance)
- [ ] HandoffComposer (constrained: select/order/rephrase existing claims only)
- [ ] PostAnesthesiaEvaluator
- [ ] Full case runs end-to-end

## M4 — Eval harness

- [ ] Custom NAT evaluators: provenance precision/recall, claim recall vs gold,
      hallucinated-claim rate, gap-analysis P/R, distractor leakage,
      extraction F1, KER
- [ ] 30-case dataset
- [ ] A/B experiments (word boosting, nano vs super, constrained vs free handoff)
- [ ] `nat eval` report committed

## M5 — Polish

- [ ] README with architecture diagram + quickstart
- [ ] docs/provenance-design.md, docs/attribution.md
- [ ] Review UI (adapted blueprint frontend) — last, per risk table

## Notes / decisions log

- 2026-07-05: Project started. Python 3.12 (nvidia-nat 1.8.0 requires <3.14).
  Heavy deps (google-adk, nvidia-nat[adk]) added only when first needed to keep
  early commits fast to install.
