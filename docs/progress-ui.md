# Review UI build progress

Resumable checklist for building [specs/ui.md](../specs/ui.md). Same discipline as
[progress.md](progress.md): every item lands as a commit with tests written first
(red) then implementation (green); every commit leaves the tree green. If a session
is interrupted (rate limits), resume from the first unchecked item.

Conventions:

- Python: `uv sync`; tests: `uv run pytest`.
- UI: `cd ui && npm install`; unit tests: `npm test` (vitest, jsdom);
  e2e: `npm run test:e2e` (Playwright, **headless** chromium; starts the FastAPI
  server against a generated fixture store — no network, no live NIMs).
- API dev server: `uv run uvicorn periop.api.app:app --reload`.
  UI dev server: `cd ui && npm run dev` (Vite proxies `/api` → :8000).
  Demo: `cd ui && npm run build`, then `uv run python -m periop.api`.
- Committed fixture: `data/cases/_out/sg-0002.json` (7 sources, 5 artifacts,
  82 claims). Wavs are gitignored; e2e generates a small wav fixture at runtime.

## U0 — FastAPI serving layer

- [x] C2 `feat(api)`: `src/periop/api/` — `GET /api/health`, `GET /api/cases`
      (summaries: artifact/claim counts, status_counts, has_audio),
      `GET /api/cases/{id}` (full Case), `GET /api/cases/{id}/audio/{source_id}`
      (Range support; 404 with render_audio.py hint; path traversal rejected;
      source must exist in the case). Env: `PERIOP_OUT_DIR`, `PERIOP_CASE_DIR`.
      `python -m periop.api` entry point. Deps: fastapi, uvicorn (+httpx dev).
- [x] C3 `fix(ui)`: static review page gains the missing `inference` claim style
      (glyph/color parity with `periop.cli.render`).

## U1 — Workspace shell

- [ ] C4 `feat(ui)`: SPA scaffold — Vite + React 18 + TS + Tailwind (own semantic
      tokens per spec §6, teal brand) + vitest/jsdom/@testing-library.
      `lib/schema.ts` (zod mirror of periop.schemas — validated against the real
      sg-0002.json fixture), `lib/provenance.ts` (ref parse/resolve, reverse
      index). Vitest green; `npm run build` clean.
- [ ] C5 `feat(ui)`: workspace components — App shell (3-column), CaseList with
      status filters (unsupported/conflicting never hidden by default), StageTabs,
      ArtifactView/ClaimRow/StatusBadge/ProvenanceChip (UNRESOLVED badge on broken
      refs), EventsTable, SourcePanel (DocumentView chunk highlight,
      TranscriptView diarized segments), reverse index ("cited by n claims").
      Vitest component tests.
- [ ] C6 `feat(api+ui)`: FastAPI serves `ui/dist` when present; Playwright
      headless e2e (`ui/e2e/`): fixture store via globalSetup, case browse,
      stage tabs, doc-chunk citation click → chunk highlighted in source panel,
      status filter behavior. U1 exit: sg-0002 fully browsable.

## U2 — Audio provenance

- [ ] C7 `feat(ui)`: AudioPlayer (custom chrome, `seekToTime`/`playClip(t0,t1)`
      via ref, timeupdate auto-pause, clip-region marker, speed/volume) — clip
      logic vitest-tested against a mocked media element. Claim/chip with audio
      ref → load `/api/.../audio/...`, seek t0, play, pause at t1; transcript
      segment highlight on play + click-to-seek; missing wav (404) → highlight-
      only degradation with `speaker, t0–t1s` label. Playwright e2e with a
      generated wav: v1 §11 step 3 (PACU-handoff claim → pre-op clip) + the
      degradation path.

## U3 — Live runs (stretch — not required for MVP)

- [ ] `POST /api/cases/{id}/run` SSE trace stream + TracePanel + run button.
      Deliberately deferred; MVP ships without it (spec §2).

## U4 — Polish

- [ ] C8 `feat(ui)`: copy-as-markdown per artifact (claims as bullets +
      citation footnotes, clipboard API with fallback); keyboard navigation
      between claims (↑/↓ move, Enter activates first ref). Vitest.
- [ ] C9 `docs`: attribution.md "Review UI" row (adapted vs built-new), README
      review-UI section (run instructions), final checklist ticks.

## Notes / decisions log

- 2026-07-06: Plan committed before implementation so any rate-limit interrupt
  can resume from the first unchecked box. Playwright browsers already cached
  (chromium-1228); pin `@playwright/test` to a matching 1.61.x.
