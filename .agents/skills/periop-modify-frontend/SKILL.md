---
name: periop-modify-frontend
description: Modify the PeriOp Companion front-end - the React 18 + TypeScript + Vite + Tailwind SPA in ui/ - add or change screens and components, consume new API endpoints through the zod-validated client layer, respect the four UI invariants (one primary action, provider gates, no free-text over claims, speech first), and verify with vitest, the tsc build gate, and Playwright e2e. Use when asked to change the UI, add a screen or component, restyle, wire a new endpoint into the SPA, or debug front-end behavior in periop-companion. Trigger keywords - frontend, UI, React, SPA, component, screen, vite, tailwind, zod, SSE, worklist, brief, claim ledger, ui/src.
license: Apache-2.0
---

# Modify the PeriOp Companion Front-End

The full provider-facing app lives in `ui/` — React 18 + TypeScript + Vite 6 +
Tailwind 3, axios + zod, **no router and no store**. It is served from
`ui/dist` at `/` by the same FastAPI process that runs the pipeline. Read
`docs/frontend.md` before non-trivial changes — it names the invariants this
skill guards.

## Step 1: Know the structure

- **Routing is plain React state** in `ui/src/app/App.tsx`
  (`View = worklist | case | stock`); a case's sub-screen is a second state
  machine derived from case state by `flowScreen` in `ui/src/lib/flow.ts`,
  overridable by explicit navigation (`screenOverride`).
- **Components** in `ui/src/components/`, grouped by surface: `flow/`
  (RecordsScreen, InterviewScreen, CaptureScreen, RecordingPanel, FlowChrome),
  `catchup/` (Worklist, BriefScreen, SourceModal), `chat/` (CaseChatPanel),
  `equipment/` (StockScreen), plus AudioPlayer, CaseSheet, SourceLink.
- **View-model layer** in `ui/src/lib/` keeps components dumb:
  - `api.ts` — axios REST; **every response is `.parse()`-d through zod** at
    the boundary.
  - `schema.ts` — zod mirror of `src/periop/schemas.py`; field names match
    the pydantic models exactly.
  - `sse.ts` — stage-run/chat streaming via `fetch` + `ReadableStream`
    (EventSource can't POST).
  - `workflow.ts` — `primaryAction(case)`: the one-obvious-next-button
    guarantee; `flow.ts` — capture-flow state machine; `catchup.ts` —
    brief/worklist view-models and `CLAIM_STATUS_META`; `claims.ts` —
    flagged-claim vocabulary; `provenance.ts` — ref parse/resolve/reverse
    index; `recorder.ts` — MediaRecorder hook.
- **Theme** — semantic tokens in `ui/tailwind.config.js` (warm-paper surface,
  `brand` green for interactive, five-state status palette). Use the tokens,
  not raw colors. No dark theme, no settings screen — by design.

## Step 2: Run it

```bash
cd ui && npm ci
# terminal 1 — stub backend, instant runs, no key:
PERIOP_STUB_RUNNER=1 uv run python -m periop.api
# terminal 2 — hot-reloading SPA:
npm run dev
```

`npm run dev` proxies to the API; the stub server gives you seeded `sg-*`
cases with real ledgers and audio to develop against.

## Step 3: Make the change, holding the four invariants

1. **One primary action, always.** Don't hand-place competing buttons; extend
   `primaryAction` in `lib/workflow.ts` if a new action kind is needed —
   worklist and brief both read it.
2. **The provider is the gate.** Stage progression, question review, and
   sign-off gating come from case state — never let the UI enable an action
   the backend would 409/refuse.
3. **Claims are prose you cannot free-type over.** No rich-text editing of
   notes; corrections go through add/edit-claim endpoints so human edits carry
   an attributed `edit:<provider_id>` source.
4. **Speech first, typing last.** New inputs should be uploaded, pasted, or
   spoken; the only required typing stays the case label.

Recipes:

- **New component/screen:** put it in the matching component group; wrap flow
  screens in FlowChrome + CaseSheet (regions scroll, the page never does);
  derive state through a `lib/` view-model, not ad-hoc fetches in components.
- **Consume a new endpoint:** add the zod shape to `lib/schema.ts` (mirror the
  pydantic model field-for-field), the call to `lib/api.ts` with `.parse()`,
  then use it. Streaming endpoints go through `lib/sse.ts`.
- **Provenance surfaces:** resolve refs via `lib/provenance.ts` — an
  unresolvable ref returns `null`, never throws, because a broken citation is
  a finding the UI must show, not a crash.

## Step 4: Verify

```bash
cd ui
npm test              # vitest unit tests (src/**/__tests__)
npm run build         # tsc --noEmit gate + vite build → ui/dist
npm run test:e2e      # builds, then Playwright against fixtures in ui/e2e/
```

All three must pass. For a manual check, open the dev server, walk a seeded
case (worklist → brief → source modal), and click a claim's source link — the
cited chunk highlights, or the exact `t0→t1` audio clip plays and auto-pauses.

## Common mistakes to avoid

- **Do not add a router or global store.** Plain state + view-models is the
  architecture, not an accident.
- **Do not fetch around `lib/api.ts`** or skip the zod `.parse()` — the
  boundary validation is what keeps UI types honest against the backend.
- **Do not desync `lib/schema.ts` from `periop/schemas.py`** — backend shape
  changes must land in the zod mirror in the same change.
- **Do not hide flagged claims.** `✗ conflicting` / `? unsupported` /
  unresolved citations are surfaced by default; the trust pitch is showing the
  shaky work.
- **Do not hardcode colors or fonts.** Extend the semantic tokens in
  `tailwind.config.js`.
- **Do not use EventSource for new streams** — POST bodies require the
  `fetch`+`ReadableStream` pattern in `lib/sse.ts`.
- **Do not forget the served-SPA path.** The API serves `ui/dist`; a change
  isn't deployable until `npm run build` passes.
