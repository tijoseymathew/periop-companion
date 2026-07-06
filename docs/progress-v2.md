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
- [x] Playwright e2e: full three-provider lifecycle against the real API with a
      stubbed instant runner (`PERIOP_STUB_RUNNER=1`)

## W5 — Polish

- [x] README v2 section; UX pass against spec §6 checklist; docs finalized

## W6 — Stretch (spec §2 stretch list)

- [x] W6a-api: per-claim review actions (mark reviewed / flag) persisted as
      sidecar state (`_out/<case_id>.review.json`, atomic write; the case
      ledger itself stays untouched); `GET`/`PUT` endpoints, demo cases 409
- [x] W6a-ui: review/flag buttons on claim rows; sign-off screen counts
      reviewed/flagged and flagged claims join the jump list
- [x] W6b: "my cases" worklist filter (any stage performed/signed off by me,
      or created by me)
- [x] W6c: department dashboard view (cases by stage × status, awaiting-review
      queue, conflict totals — derived from the case summaries client-side)
- [ ] W6d: tablet-width layout — below `lg` the provenance rail hides and the
      worklist becomes a toggleable drawer, so the intra-op capture screen is
      a single big column; tablet-viewport Playwright spec
- [ ] W6e-api: streaming intra-op ASR — WebSocket
      `/api/cases/{id}/sources/audio/stream` taking 16 kHz PCM16 frames,
      feed/finish transcriber seam (fake in tests/e2e, Riva streaming adapter
      live), PCM appended to the memo wav ffmpeg-free, final segments
      registered on `audio:intraop-notes` with wav-offset times
- [ ] W6e-ui: live dictation on the intra-op capture screen (mic → PCM
      downsample → WS, live partial/final transcript, memo recorder as the
      fallback); streaming e2e with fake media device
- [ ] W6f: live streaming smoke script in `scripts/`, README stretch section,
      demo recording, docs finalized

## UX review against spec §6 (W4 exit criterion)

1. **One primary action per case state** — `primaryAction()` in
   `ui/src/lib/workflow.ts` is the single state machine every screen asks;
   unit-tested across the whole lifecycle (`workflow.test.ts`), and the e2e
   walk completes the workflow using only the big buttons. Read-only demo
   cases render zero `data-primary-action` elements (asserted in
   `lifecycle.spec.ts`).
2. **The screen explains itself** — every capture screen opens with one
   sentence (`CAPTURE_SENTENCES` / `GENERATE_SENTENCES` in `StagePanel.tsx`);
   empty worklist-filter state and empty stages carry instructions.
3. **Speech first, typing last** — the case label is the only obligatory
   typing (the e2e walk types nothing else: everything is paste, upload, or
   click); question edits are optional.
4. **Clinical vocabulary** — "Pre-op evaluation", "PACU handoff", "sign off",
   status words like "awaiting review" (`STATUS_WORDS`); no "pipeline",
   "artifact", or "claim extraction" in provider-facing copy. The review
   workspace keeps "claims" deliberately (load-bearing there).
5. **Legible at arm's length** — primary buttons are min-h 44–56 px with text
   labels; no icon-only actions (icons always accompany text); the record
   button is the largest control on its screen.
6. **Nothing to configure** — the provider picker is the only setup, one
   select in the header, persisted locally; no settings screen exists.
7. **Errors say what to do** — recorder failures keep the audio and offer
   Retry ("kept on this device"); microphone refusal points at the upload
   fallback; API gate 409s name the next action and are surfaced verbatim;
   unit-tested in `Recorder.test.tsx` and `tests/test_workflow_api.py`.
8. **The worklist answers "what needs me"** — label, headline stage + status
   in words, who acted last, conflict glyphs, stage/status filters
   (`Worklist.test.tsx`, `workflow.test.ts`).

## Design deviations from the spec (documented, deliberate)

- The post-op stage runs as one generation (handoff + post-anaesthesia note)
  gated on the post-op interview, matching the batch pipeline's
  `run_postop_stage` — the spec's §4.3 sketches the handoff generating before
  the interview. Keeping one runner preserves the lifecycle-conformance
  guarantee; splitting it is a candidate follow-up.
- Regeneration after reopen is not offered: reopen returns a stage to
  review/sign-off with prior artifacts kept (§4.5's "rather than silently
  regenerated" reading). Changing inputs after generation requires a new case.
