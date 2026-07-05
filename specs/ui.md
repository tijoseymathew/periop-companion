# PeriOp Companion — Review UI Specification

**A provenance-first review workspace for the PeriOp Companion pipeline, following the design of the NVIDIA [ambient-provider](https://github.com/NVIDIA-AI-Blueprints/ambient-provider) blueprint frontend — its layout, interaction patterns, and tech stack — reimplemented with unencumbered assets and extended from "transcript beside a note" to "claim ledger with click-to-play provenance."**

Version: 0.1 (draft for review)
Status: Companion to [specs/v1.md](v1.md). Supersedes the minimal static HTML review page (`periop.ui.review`) as the primary review surface; the static page remains as the zero-dependency fallback.

---

## 1. Purpose and positioning

`specs/v1.md` deliberately deferred the rich UI (§2 "CLI + minimal review UI", §10 "UI polish is last"). That debt is now due: the pipeline produces complete cases end-to-end (5 artifacts, ~50–80 verified claims per case), audio renders via Magpie TTS, and the ASR path is live. The one demo moment the current static page cannot deliver is v1 §11 step 3:

> Click a sentence in the PACU handoff → it plays the exact audio clip from the pre-op interview that supports the claim — provenance made tangible.

This spec defines that UI. Two things it is **not**:

- **Not a note editor.** ambient-provider's center pane is an editable note. Ours is deliberately read-only: PeriOp notes are *assembled from claims*, and free-text editing would sever the claim↔provenance structure that is the whole point. Review actions operate on claims (filter, flag, export), never on prose.
- **Not a port of the blueprint's code wholesale.** We follow its design (three-column workspace, plain-`<audio>` player with imperative seek, SSE trace streaming, semantic color tokens) and may adapt its Apache-2.0 application code with attribution, but all branded/proprietary pieces are excluded (§8).

### Relationship to the ambient-provider frontend

| ambient-provider (single encounter) | PeriOp Review UI (longitudinal case) |
|---|---|
| Left sidebar: previous notes + audio upload | Left sidebar: case list from the case store |
| Center: editable templated note (SOAP sections) | Center: claim-structured artifacts across three stages |
| Right: audio player + transcript + trace panel | Right: audio player + source panel (documents **and** transcripts) + trace panel |
| Transcript segment click → insert `[M:SS]` into note | Claim click → resolve provenance → highlight chunk **or** play audio clip |
| Citations modeled but unused (`citations=[]`) | Citations are the primary interaction — claim-level, structural |
| Generate button → SSE section-by-section note stream | Run button (stretch) → SSE stage/agent/artifact trace stream |

The claim→clip interaction is new work: the blueprint's `Citation` schema and `.timecode-link` styling exist but were never wired to a click handler. We reuse its *working* pattern instead — transcript-segment click → `audioPlayerRef.seekToTime(seconds)` via `forwardRef`/`useImperativeHandle` — and drive it from claim provenance.

---

## 2. Scope

### In scope (MVP)
- Read-only review workspace: browse processed cases, inspect every artifact as its claim ledger, filter by verification status.
- Citation interaction: claim → document chunk highlight, claim → audio clip playback (`t0`→`t1`, auto-pause), and the reverse index (segment/chunk → claims citing it).
- Thin FastAPI serving layer (`src/periop/api/`) over the existing case store + audio files. No new persistence.
- Graceful degradation: missing wavs → timestamp-only mode; unresolvable citations → visible `UNRESOLVED` marker (never hidden).

### Stretch
- Live pipeline runs from the UI with an SSE trace panel (stage/agent/artifact events).
- Claim review actions (mark reviewed / flag) persisted as a sidecar file, and gold-vs-generated diff view for eval triage.

### Out of scope
- Note editing, template systems, audio upload (cases come from `synthgen`), authentication, EHR integration, mobile layouts.

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────┐
│  ui/  — React 18 + TypeScript + Vite SPA (single page)     │
│  Tailwind semantic tokens · lucide-react icons · zod        │
│  axios REST client · native EventSource (SSE, stretch)      │
├────────────────────────────────────────────────────────────┤
│  src/periop/api/  — FastAPI, mounted under /api             │
│  read-mostly: case list · Case JSON · audio file serving    │
│  (stretch: POST run → SSE trace stream)                     │
├────────────────────────────────────────────────────────────┤
│  Existing: CaseStore (data/cases/_out/*.json) ·             │
│  audio wavs (data/cases/<id>/audio/*.wav, regenerable) ·    │
│  periop.schemas (Case/Claim/Source/AudioSegment)            │
└────────────────────────────────────────────────────────────┘
```

Design rules, carried over from the blueprint:

- **SPA, no router.** One screen; `App.tsx` owns all state with `useState`/`useRef` and passes props + imperative refs down. No Redux/Zustand/React Query until a real need appears.
- **Plain `<audio>`, custom chrome.** No waveform library. The player exposes `seekToTime(seconds)` (and, new for us, `playClip(t0, t1)`) via `useImperativeHandle`.
- **zod mirrors pydantic.** `ui/src/lib/schema.ts` mirrors `periop.schemas` exactly (field names included: `t0`, `t1`, `seg_id`, `chunk_id`, `claim_id`, `provenance`, `status`). Every API response is parsed through zod at the client boundary.
- **Semantic tokens, our values.** The blueprint styles everything through semantic utility names (`bg-surface-raised`, `text-primary`, `accent-*`) rather than raw hues. We adopt the *pattern* with our own neutral palette (§6) — the token **values** in the blueprint belong to NVIDIA's proprietary KUI theme and are not copied.

Vite dev server proxies `/api` → `http://localhost:8000`; production build is static files served by FastAPI (`StaticFiles` mount) so `uv run python -m periop.api` is the single-process demo command.

---

## 4. Backend: `src/periop/api/`

The repo currently has **no HTTP surface** (NAT `serve` exposes only the generic run-a-case function). The UI needs a thin, read-mostly API over what already exists on disk. FastAPI is chosen to mirror the blueprint (`apps/api`) and because `periop.schemas` pydantic models serialize directly as response models.

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{status: "ok"}` |
| `GET /api/cases` | Case summaries: `[{case_id, artifact_count, claim_count, status_counts: {supported: n, …}, has_audio: bool}]` — scanned from `data/cases/_out/*.json` |
| `GET /api/cases/{case_id}` | The full `Case` (the pydantic model, verbatim — sources with chunks/segments, artifacts with claims, events, open questions) |
| `GET /api/cases/{case_id}/audio/{source_id}` | The wav for an audio source (`audio:preop-interview` → `data/cases/{case_id}/audio/preop-interview.wav`), served with HTTP Range support so `<audio>` seeking works. `404` with a body explaining `scripts/render_audio.py` regenerates wavs (they are gitignored) |
| `POST /api/cases/{case_id}/run` *(stretch)* | SSE trace stream (§7) |

Conventions:
- Directories are configurable (`PERIOP_OUT_DIR`, `PERIOP_CASE_DIR`) with the existing defaults; no new env vocabulary beyond that.
- `source_id` → filename mapping is the existing convention: strip the `audio:` prefix, append `.wav`. Reject path traversal (the id must match a source in the case).
- Errors are structured JSON, never HTML. The API is local/demo-grade: no auth, no rate limiting (unlike the blueprint's slowapi 5/min — we have no upload endpoint to protect).

---

## 5. The workspace

One screen, fixed three-column layout (`h-screen flex`), directly following the blueprint's proportions:

```
┌──────────────────────────────────────────────────────────────────┐
│ Top bar: PeriOp Companion · Review        [case: sg-0002 ▾]      │
├──────────┬──────────────────────────────────┬────────────────────┤
│ Cases    │  Artifacts (center, flex-1)      │ Audio player (h-40)│
│ (w-80)   │                                  ├────────────────────┤
│          │  [Pre-op] [Intra-op] [Post-op]   │ Source panel       │
│ sg-0001  │                                  │ (flex-[3])         │
│ sg-0002 ●│  note:pacu-handoff               │  docs ⟷ transcripts│
│ sg-0003  │  ┌────────────────────────────┐  │                    │
│ …        │  │ ✓ c-007 "Aspirin was       │  │  s017 PATIENT      │
│          │  │   discontinued 6 days…"    │  │  214.3–221.8s      │
│ filters: │  │   ▸ audio:preop-int…#s017  │  │  "…stopped the     │
│ ✓ ⚠ ✕ →  │  └────────────────────────────┘  │   aspirin last…"   │
│          │  ⚠ c-012 "…"                     ├────────────────────┤
│          │                                  │ Trace (flex-[2])   │
└──────────┴──────────────────────────────────┴────────────────────┘
```

### 5.1 Top bar
App name + a generic clinical icon from **lucide-react** (MIT — e.g. `Stethoscope` or `Activity`). No logo art. Right slot: nothing in MVP (the blueprint puts its template picker here; we have no templates).

### 5.2 Left sidebar — cases (`w-80`, raised surface)
- Case list from `GET /api/cases`: case id, artifact/claim counts, a compact status strip (counts per verification status), an audio-available indicator.
- Status filter toggles (supported / unsupported / conflicting / inference / unverified) that filter the center pane's claim rows. **Unsupported and conflicting are never filtered out by default** — surfacing them is a v1 §4.3 invariant.
- *(Stretch)* "Run case" button per unprocessed case, morphing through run states like the blueprint's Generate CTA ("Running pre-op…" / "Running intra-op…" / …).

### 5.3 Center — the claim ledger (flex-1)
- Stage tabs (Pre-op / Intra-op / Post-op) grouping the five artifacts in pipeline order: `note:pre-anesthesia-eval` · `record:intra-op`, `note:anticipated-issues` · `note:pacu-handoff`, `note:post-anesthesia-eval`.
- Each artifact renders as its ordered claims — this *is* the note; there is no separate prose rendering. A claim row shows: status badge, claim text, and its provenance chips (`doc:gp-summary#c003`, `audio:preop-interview#s017`).
- **Clicking a claim (or a provenance chip)** resolves the ref via the loaded Case:
  - **document chunk** → source panel switches to that document, scrolls to the chunk, highlights it;
  - **audio segment** → audio player loads that source's wav (if not already), seeks to `t0`, plays, auto-pauses at `t1`; the source panel switches to that transcript and highlights the segment. If the wav 404s, fall back to highlight-only with the `speaker, t0–t1s` label (today's static-page behavior).
  - Multiple refs → chips are individually clickable; clicking the row activates the first ref.
- `record:intra-op` additionally offers an events table view (`case.intraop_events`: time, category, value, units, provenance) — same chip interaction.
- Unresolvable refs render an unmissable `UNRESOLVED` badge, mirroring `periop.ui.review`'s rule: broken provenance is a finding, not a rendering error.
- Copy/export: a "Copy as Markdown" button per artifact (clipboard API with fallback, as in the blueprint) rendering claims as a bulleted note with citation footnotes.

### 5.4 Right sidebar — provenance (`w-96`, sunken surface)
Vertical stack, blueprint proportions:

1. **Audio player** (fixed `h-40`): custom chrome over a hidden `<audio preload="metadata">` — play/pause, reset, `MM:SS` mono readout, click-to-seek progress bar, speed select (0.75–2×), volume. New behaviors vs the blueprint: `playClip(t0, t1)` (seek, play, pause at `t1` via `timeupdate`), a visible clip-region marker on the progress bar while a clip is active, and a source label showing which of the case's three recordings is loaded.
2. **Source panel** (`flex-[3]`): tabs for every source in the case — documents (chunk list, section headings, chunk ids) and transcripts (diarized segments: `seg_id`, speaker badge, `t0–t1`, text). Speaker color-coding follows the blueprint's transcript pattern (PROVIDER / PATIENT / others distinct); segment click seeks the player (`onSeekToTime`), and the currently-playing segment highlights via the player's `onTimeUpdate` (the blueprint left this as a TODO; we implement it).
3. **Reverse index**: each chunk/segment shows a small "cited by n claims" affordance; clicking lists those claims and jumps the center pane to them. This makes conflicts legible — a segment cited by both a `supported` and a `conflicting` claim is exactly the record-vs-patient story v1 §3.2 wants told.
4. **Trace panel** (`flex-[2]`, stretch): live run events grouped per stage in accordion cards, newest auto-opened — the blueprint's `TracePanel` pattern applied to stage/agent events instead of LLM token streams. Hidden in MVP (collapsed to zero height when there is no run).

---

## 6. Visual language

Follow the blueprint's *system* — dark-first theme, semantic tokens, quiet surfaces with color reserved for status — with our own values:

| Token | Role | Value (ours) |
|---|---|---|
| `surface-base` / `surface-raised` / `surface-sunken` | page / left panel / right panel | neutral slate ramp (e.g. `#0f172a` / `#1e293b` / `#0b1120`) |
| `text-primary` / `text-secondary` / `text-subtle` | text hierarchy | slate ramp |
| `brand` | interactive accents, play button | **teal** (`#14b8a6` family) — deliberately *not* green, to keep distance from the NVIDIA brand color |
| `status-supported` | ✓ badge | green |
| `status-unsupported` | ⚠ badge | amber |
| `status-conflicting` | ✕ badge | red |
| `status-inference` | → badge | violet |
| `status-unverified` | ○ badge | grey |

- Status glyphs match the CLI renderer (`periop.cli.render`), including `→` for `inference` — one vocabulary across CLI, static HTML, and this UI. (Note: the static page currently lacks an `inference` style; add it there as part of this work so the fallback stays consistent.)
- Monospace (`JetBrains Mono` / `Fira Code` fallback stack, both OFL) for ids, timestamps, and transcript text; system UI stack (`Inter`-like) elsewhere. No bundled proprietary fonts.
- Icons: **lucide-react only** (MIT). Radix primitives (MIT) allowed if a real need appears (e.g. tabs), but prefer plain elements as the blueprint's components mostly do.
- Light theme is nice-to-have; if done, via CSS variables under the same token names.

---

## 7. Live runs (stretch): SSE trace stream

Modeled on the blueprint's `GET /notes/stream` EventSource protocol, adapted from token-streaming to stage-streaming:

```
event: status            data: {"message": "loading case sg-0003"}
event: stage_start       data: {"stage": "preop"}
event: agent_start       data: {"stage": "preop", "agent": "GapAnalyst"}
event: agent_end         data: {"stage": "preop", "agent": "GapAnalyst", "summary": "6 questions"}
event: artifact_complete data: {"artifact_id": "note:pre-anesthesia-eval", "claims": 21}
event: complete          data: {"case_id": "sg-0003"}
event: error             data: {"message": "..."}
```

- Server: `POST /api/cases/{case_id}/run` returning `text/event-stream`. Because `EventSource` cannot POST, the client uses a `fetch` + `ReadableStream` SSE reader (the blueprint's `createCustomEventSource` pattern — its own workaround for exactly this).
- On `artifact_complete` the client refetches the case and the new artifact appears in place — the section-by-section arrival UX of the blueprint's note stream, at artifact granularity.
- One run at a time per server (in-memory lock); this is a demo tool, not a job queue.
- Event emission hooks into the existing stage runners; it must not perturb NAT tracing (events are UI-facing, OTel remains the tracing source of truth).

---

## 8. Branding, licensing, and what we must not copy

The ambient-provider **application code is Apache-2.0** (SPDX headers on UI sources) — adapting its patterns and code is permitted with attribution, recorded in `docs/attribution.md`. Its repo also vendors components that are **explicitly proprietary** (per its `THIRD-PARTY-NOTICES.md`) and must not enter this repo in any form:

| Excluded | What we use instead |
|---|---|
| `@kui/foundations`, `@kui/react` (Kaizen UI) — vendored `.tgz` packages, `AppBar`/`Button`/`Text`/`ThemeProvider`, the `nv-dark` theme and all KUI token *values* | Plain Tailwind + our own semantic token values (§6); hand-rolled app bar and buttons |
| `@nv-brand-assets/*` icons (`Health`, `Microphone`, `Soundwaves`, …) | lucide-react (MIT) |
| NVIDIA logos, wordmarks, the NVIDIA green brand color as an accent | Generic lucide glyph; teal accent |
| "Ambient Scribe" / "Ambient Provider" names, README screenshots/banners (`images/*.png`) | "PeriOp Companion — Review"; our own screenshots |

Rules of thumb for implementers:
- Never install or vendor any `@kui/*` or `@nv-brand-assets/*` package, and never transcribe KUI token hex values even under new names.
- Textual references to NVIDIA products (NIM, Parakeet, Nemotron) in docs/attribution remain fine — that's nominative use, not branding.
- Any file adapted (not just inspired) from blueprint source keeps a comment noting its origin, and `docs/attribution.md` gains a "Review UI" row describing what was adapted (layout, AudioPlayer chrome pattern, SSE reader) vs built new (claim ledger, citation playback, reverse index, the API).

---

## 9. Repository plan

```
periop-companion/
├── ui/                          # the SPA (replaces the planned "adapted frontend" slot)
│   ├── index.html  vite.config.ts  tailwind.config.js  package.json
│   └── src/
│       ├── main.tsx
│       ├── app/App.tsx          # all state; layout shell
│       ├── components/          # CaseList, StageTabs, ArtifactView, ClaimRow,
│       │                        # StatusBadge, ProvenanceChip, EventsTable,
│       │                        # AudioPlayer, SourcePanel, DocumentView,
│       │                        # TranscriptView, TracePanel
│       └── lib/                 # api.ts (axios + SSE reader), schema.ts (zod),
│                                # provenance.ts (ref parsing/resolution, reverse index)
├── src/periop/api/              # FastAPI app: app.py, routers/{cases,audio,run}.py
├── src/periop/ui/review.py      # kept: static-HTML fallback (gains inference style)
└── docs/attribution.md          # + Review UI adaptation row
```

- `ui/` has its own `package.json` (npm, pinned via lockfile); it is not part of the uv/Python build. `npm run build` outputs to `ui/dist/`, which the FastAPI app serves when present.
- Python API dev: `uv run uvicorn periop.api.app:app --reload`. UI dev: `npm run dev` (Vite proxy). Demo: build once, run the API.

---

## 10. Testing

Same TDD discipline as the rest of the repo (tests first, every commit green):

- **API** (`pytest`, no network): endpoint contracts against fixture cases in a tmp store — case listing/summaries, full-case round-trip through `periop.schemas`, audio 404-with-hint, path-traversal rejection, Range request handling.
- **UI** (`vitest` + `@testing-library/react`): provenance resolution (`provenance.ts` ref parsing, reverse index), claim click → `playClip(t0, t1)` called with the segment's times, chunk click → highlight target, status filters never hiding conflicting/unsupported by default, `UNRESOLVED` badge on broken refs, zod schema accepting real committed case JSON (`data/cases/_out/sg-0002.json` as a fixture).
- **Player clip logic**: `timeupdate`-based auto-pause tested with a mocked media element (jsdom has no real audio).
- Live checks (real wavs, real server) live in `scripts/` per repo convention, never in CI.

---

## 11. Milestones

| # | Milestone | Exit criterion |
|---|---|---|
| U0 | FastAPI serving layer: cases list, case detail, audio with Range; static-page `inference` style fix | `curl` walk-through of all endpoints against sg-0001..0005; pytest green |
| U1 | Workspace shell: three-column layout, case list, stage tabs, claim ledger with status badges + filters, source panel (documents + transcripts), reverse index | sg-0002 fully browsable; doc-chunk citation click highlights the chunk |
| U2 | Audio provenance: player with `playClip`, claim → clip playback with auto-pause, segment highlight-on-play, missing-wav degradation | v1 §11 demo step 3 works: click a PACU-handoff claim → hear the pre-op interview clip |
| U3 | *(Stretch)* Live runs: SSE run endpoint + trace panel, artifact-by-artifact arrival | A case runs end-to-end from the browser with visible stage progress |
| U4 | Polish: copy-as-markdown export, keyboard navigation between claims, README demo GIF, attribution updated | Screenshots/GIF in README; `docs/attribution.md` row landed |

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Wavs are gitignored → fresh clones have no audio | First-class degradation (timestamp-only mode) is a tested path, not an error state; API 404 body points at `scripts/render_audio.py` |
| ASR-derived segments may drift from gold-manifest times | Clip playback uses whatever `t0/t1` the Case's segments carry (the same source the claims cite), so player and provenance can't disagree |
| `contentEditable`-style scope creep toward editing | Explicit non-goal (§1); review actions are claim-level metadata only |
| Blueprint code adapted without notice | Attribution rule in §8; review checklist item for any file with blueprint lineage |
| SSE run endpoint interferes with NAT-instrumented runs | UI events are additive hooks; OTel/profiler paths untouched; stretch milestone can ship after MVP without blocking it |
