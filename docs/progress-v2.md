# Build progress — v2 provider workflow

Resumable checklist for building [specs/v2.md](../specs/v2.md) (case lifecycle,
write API, capture UI) on the `v2` branch. Same conventions as
[progress.md](progress.md): every item lands as one or more commits with tests
written first (red) then implementation (green); if a session is interrupted,
resume from the first unchecked item.

- Python: `uv run pytest` · UI units: `cd ui && npm test` · E2E: `cd ui && npm run test:e2e`
- ffmpeg is optional on dev machines: audio-normalization tests skip gracefully
  without it; wav uploads work ffmpeg-free.
- Live NIM smoke checks stay in `scripts/`, never CI.

## W0 — Schema + store

- [x] `Provider`, `StageState`, `Workflow` models; `Case.workflow` optional so
      every existing case JSON loads unchanged (a case without `workflow` is
      immutable demo data)
- [x] `open_questions` upgraded to `OpenQuestion` objects (question, reason,
      provenance, review, edited_text) with coercion from the legacy plain-string
      form; GapAnalyst stores full questions, PreOpNoteWriter aligns against the
      reviewed list, UI zod schema accepts both forms
- [x] `Source.captured_at` / `provided_by` (optional)
- [x] `CaseStore.save` atomic (temp file + rename)

## W1 — Intake

- [x] `GET /api/providers` roster from `data/providers.json`
- [x] `POST /api/cases` — skeleton case with `workflow` block; write-guard: every
      write endpoint 409s on demo cases
- [x] `POST /api/cases/{id}/sources/document` — paste/upload → records/ file →
      chunked source; ~5 MB cap; traversal rejection; GapAnalyst auto-run (via
      injectable runner) once op plan + ≥1 record exist
- [x] `PUT /api/cases/{id}/questions` — approve/dismiss/edit persisted, gate stamped

## W2 — Audio + stage runs

- [x] `POST /api/cases/{id}/sources/audio` — normalize to 16 kHz mono wav under
      `data/cases/{id}/audio/`; intra-op kind appends memos; others
      replace-with-confirmation; ~50 MB cap
- [x] `POST /api/cases/{id}/stages/{stage}/run` — gate + input validation,
      single-run lock, SSE per ui.md §7, invokes the matching stage runner
- [x] `POST .../stages/{stage}/signoff` · `.../reopen` · `POST .../handoff/ack`

## W3 — UI

- [x] Worklist sidebar (stage + status in words, performed-by, conflict
      indicator, filters) + provider picker + New case; demo cases read-only
- [x] Stage rail (Pre-op / Intra-op / Post-op stepper) above the center pane
- [x] Intake form + question review screens (center pane, pre-artifact)
- [x] Recorder (MediaRecorder + upload fallback), intra-op memo capture
- [x] Stage panels: one primary action per state (unit-tested), one-sentence
      status copy, SSE progress rendering
- [x] Sign-off screen (unsupported/conflicting counts + jump list), intra-op
      orientation view, handoff acknowledge

## W4 — Conformance + e2e

- [x] Lifecycle conformance test: API walk of a synthetic case reproduces the
      batch pipeline's ledger (stub chats)
- [ ] Playwright e2e: full three-provider lifecycle against the real API with a
      stubbed instant runner (`PERIOP_STUB_RUNNER=1`)

## W5 — Polish

- [ ] README v2 section; UX pass against spec §6 checklist; docs finalized
