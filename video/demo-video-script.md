# PeriOp Companion — public demo video script (v2)

For the GitHub repo page. Public audience — **never say or show "interview,"
"candidate," or anything about a hiring process.** Problem → solution →
proof, no roadmap, no personal-career framing. The interview deck
(`/home/josey/projects/periop-interview/slides/periop-companion-interview-deck.html`)
is a source for numbers/copy/visual-language only — never shown on screen,
never reused past its "Solution" section.

**Target length: ~2:00.** **Aspect:** 16:9, 1920×1080. **No voiceover —
on-screen text only.** Silent underscore track, one dynamic swell at the
0:20 turn. Every beat has to read with the sound off and no narrator
carrying meaning between cuts, so text is doing all the work: short,
sequential, high-contrast.

---

## Asset index (full paths)

**Live-NIM recordings — the spine of the video** (sg-0031 case; each file
already scrolls to and pauses on the interesting fact for its stage):
- `/home/josey/projects/periop-companion/ui/e2e/.recordings/sg0031-demo-01-intake.mp4` — 1:39
- `/home/josey/projects/periop-companion/ui/e2e/.recordings/sg0031-demo-02-preop.mp4` — 2:55
- `/home/josey/projects/periop-companion/ui/e2e/.recordings/sg0031-demo-03-intraop.mp4` — 0:33 (⚠ see Scene 6 note)
- `/home/josey/projects/periop-companion/ui/e2e/.recordings/sg0031-demo-04-postop.mp4` — 2:48
- `/home/josey/projects/periop-companion/ui/e2e/.recordings/sg0031-demo-full.mp4` — 7:54, all four concatenated; scrub this for frame-accurate in/out points
- `.webm` siblings of all five exist alongside the `.mp4`s if a different codec is needed

**Production reference** (for the editor — not shown in the video):
- `/home/josey/projects/periop-companion/ui/e2e/DEMO_RECORDING.md`
- `/home/josey/projects/periop-companion/ui/e2e/record_sg0031_demo.mjs`

**Other assets:**
- `/home/josey/projects/periop-interview/codespace.png` — GitHub Codespaces one-click-run screenshot, for the closing CTA
- ~~`docs/images/review-ui.png`~~ — dropped, outdated
- ~~`docs/images/provider-workflow-demo.webm`~~ — dropped; the sg-0031 recordings are the real generations, no need for the stub-runner B-roll

**Design system to build every motion-graphics card from** — pulled straight
from the deck's own stylesheet so the video and the deck (and the product
itself) read as one visual system, not a mismatched overlay:

```
--bg: #fdfae7        --primary: #1e2bfa      --text: #111111
--text-muted: #6b6b6b  --text-light: #9a9a9a  --positive: #059669
--accent-light: rgba(30,43,250,0.08)          --border: rgba(30,43,250,0.2)
--card-bg: rgba(30,43,250,0.04)
--font-display: 'Space Grotesk', sans-serif    (headings, numbers, chips)
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)  --duration-normal: 0.6s
```

**Explicit brand rule baked into the deck's CSS (line 227): "soft cobalt
tints, translucent borders, rounded corners. No drop shadows anywhere."**
Every custom component below (including the video inset frame) follows this
— depth comes from a blurred colour glow behind an element, never a
`box-shadow`.

**Build it as an actual HTML page, not a design-tool composition.** The
deck already proves this stack renders cleanly and animates well in a real
browser. Write each motion-graphics scene below as a plain HTML/CSS(+~10
lines of JS) file, open it in Chromium, and screen-record it — with
Playwright, exactly like `record_sg0031_demo.mjs` already does for the app
footage (`page.video()`, `1920×1080` viewport = `recordVideo.size`, see the
gotcha about letterboxing in `DEMO_RECORDING.md`). That gets pixel-identical
resolution and color space to the live-app clips for free, so cuts between
"motion graphic" and "real UI" don't need any rescaling.

---

## Reusable components — lift straight from the deck's CSS

| Component | Deck source (line #) | Use it for |
|---|---|---|
| `.card` / `.card-sm` | 229, 235 | any generic card surface |
| `.journey-card` / `.step-circle` / `.phase-head` | 807–334 | the opening "three phases" beat |
| `.io-chip` / `.io-row` | 813–828 | the "scattered truth" beat (already styled as small pill-cards with an icon + label) |
| `.bar-row` / `.bar-track` / `.bar-fill` / `.bar-pct` | 311–322 | the minutes-per-patient bar build |
| `.stat-num` / `.metric-value` / `.stat-name` | 265–281 | any big counted-up number |
| `.chip` / `.chip-solid` / `.tag-pill` | 210, 343–350 | caption chips overlaid on video insets |
| `.highlight-block` / `.quote` | 241–252 | not used in this cut — deck-only |
| `.reveal` + `.d1`…`.d6` stagger | 468–480 | the universal entrance animation: `opacity 0→1`, `translateY(28px)→0`, staggered `0.08s` increments, `var(--ease-out-expo)`, `0.6s` — reuse this timing curve for *every* text/card entrance in the video so it feels like the same product |

## New components to build (none exist in the deck yet)

**1. `.browser-inset` — the frame every video clip sits in.**
Do not show the recordings full-bleed. Composite them into a floating
browser-chrome frame at ~62% canvas width, centered:
- Outer: `border-radius: 16px`, `border: 1.5px solid var(--border)`,
  `background: var(--card-bg)` — no `box-shadow`. Depth instead: an
  absolutely-positioned pseudo-element behind it, `background: var(--primary)`,
  `filter: blur(80px)`, `opacity: 0.18`, slightly larger than the frame — a
  soft glow, not a shadow.
- Chrome bar: `34px` tall, `background: var(--bg)`, bottom border
  `1px solid var(--border)`. Three `8px` circles in `var(--text-light)`
  (monochrome, not red/yellow/green — stays in the brand's mono-cobalt
  discipline instead of borrowing macOS iconography). An address-pill next
  to them: `.chip`-style, monospace-ish, showing e.g.
  `periop.dev/cases/sg-0031/preop` in `var(--text-muted)`.
  entrance: `.reveal` timing — pop from `scale(0.94) opacity 0` to
  `scale(1) opacity 1`.
- Video sits below the chrome bar, corners matching the outer radius on the
  bottom two corners only, `object-fit: cover`, cropped to the specific
  region called out per scene (see below) — not the whole 1920×1080 app
  chrome shrunk down, which would be illegible at 62% width.
- Optional continuous "alive" motion while a clip plays: `translateY`
  oscillating ±3px over 4s, `ease-in-out infinite` — subtle, keeps a static
  crop from reading as a still frame.
- Caption: a `.chip-solid` pill anchored just below the frame's bottom edge,
  overlapping it by ~10px, one line of text, `.reveal d2` timing.

**2. Claim shatter / claim lock — the provenance beat's hero visual.**
Two small `.card-sm`-style cards, shown in sequence (or side by side if the
canvas is wide enough):
- *Ungrounded claim* (the "wrong" example): text like `"Patient took
  apixaban Tuesday"` with a dashed, `var(--text-light)`-bordered chip below
  reading `no source`. Animate: `keyframes shake` (± 4px horizontal, 4
  cycles, 0.4s) then `opacity → 0, transform: scale(0.9)` — it fails and
  disappears. Never `display: none` a claim without the citation existing;
  make the visual say that structurally.
- *Grounded claim* (the real system): same claim text, but the source chip
  is solid, `var(--positive)` background, a small check-mark SVG, and a
  play-icon suggesting it links to a clip. Animate: `scale(0.9) → scale(1.04)
  → scale(1)` bounce (`var(--ease-out-expo)`), border/text colour tweening
  from `var(--border)`/`var(--text-muted)` to `var(--positive)` over the
  same 0.6s.
- Caption beneath both: `A claim cannot exist without a citation.`

**3. Radial progress ring — pairs with the `100%` counter.**
Plain SVG circle, `stroke: var(--primary)`, `stroke-width: 10`,
`stroke-linecap: round`, background track circle in `var(--accent-light)`.
Animate `stroke-dashoffset` from full circumference to `0` over `1.2s`,
`var(--ease-out-expo)`, synced to a `.stat-num`-styled counter ticking
`0 → 100` with a trailing `%`. No JS libraries needed — a
`requestAnimationFrame` loop or even a CSS `@property` + `transition` on
the dash-offset custom property both work.

**4. Scatter transform for the `.io-chip` row.**
Three `.io-chip`s (reuse the class as-is — it already renders as a nice
pill-card with an icon slot), start stacked/overlapping center, then each
animates outward on its own `d1`/`d2`/`d3` stagger delay to a scattered
layout: mix of `translate(x, y) rotate(±6deg)`. Icons: **do not use generic
outline icons for "document / audio / people."** Instead put real (but
illegible-at-a-glance, which is the point) content behind a subtle blur
inside each chip — a cropped fragment of an actual markdown doc heading, a
CSS-drawn waveform (a row of `div`s with animated `height` via `@keyframes
eq`, like an equalizer), and a chat-bubble pair — so the beat reads as "real
artifacts, scattered" rather than a generic icon set.

---

## Cold open — the problem (0:00–0:20)

No video yet.

| Time | Visual | On-screen text |
|---|---|---|
| 0:00–0:07 | Three `.journey-card`s (reuse as-is: `step-circle` 1/2/3, `phase-head`) fade/slide in left→right on the `.reveal` `d1`/`d2`/`d3` stagger, over `var(--bg)` | "One patient. Three phases of care." |
| 0:07–0:14 | Cut: the three cards collapse into three `.io-chip`s, which then scatter per Component 4 above | "The truth lives in documents. In audio. In people." |
| 0:14–0:20 | Cut: `.bar-row` build (reuse exact deck bars: Pre-op ~30min / Interview ~20min / Post-op ~20min / Notes ~10min, `bar-fill` animating `width: 0 → var(--w)`), holds 2s, then hard-cuts to a single big `.metric-value`-styled counter ticking up | "≈130 hours of clinician time. Every day. One hospital." |

## Turn — title card (0:20–0:28)

| Time | Visual | On-screen text |
|---|---|---|
| 0:20–0:28 | `Space Grotesk` wordmark builds on `var(--bg)`, `var(--primary)` accent-line (`.accent-line`, 88×6px) draws under it, subtitle fades in | **PeriOp Companion** / "Every claim, sourced." |

---

## Live walkthrough — inset-frame cuts (0:28–1:36)

General rule for every scene below: **hard-cut past anything waiting on the
backend.** Scrub each source file first and mark the exact frame where the
spinner/"Generating…" state resolves into content — cut in a beat *before*
that resolve (so the reveal itself is on screen), never during the wait.
Do not pad with a "thinking" bridge animation; a clean hard cut is more
confident and keeps the whole section inside its ~17s budget.

### Scene 1 — Intake (0:28–0:45)
**Source:** `sg0031-demo-01-intake.mp4`. Scrub to the generated question
list appearing (the live GapAnalyst result), crop tight to the card holding
the apixaban-timing question — not the full app chrome.
Frame in → hold on the question card (~8s) → caption chip → frame out.

| On-screen caption |
|---|
| "Flagged before anyone asks." |

### Scene 2 — Pre-op (0:45–1:02)
**Source:** `sg0031-demo-02-preop.mp4`. Scrub to the apixaban-conflict claim
card, crop to claim text + citation pill, then the citation click → audio
player/waveform. Cut the moment playback starts; don't let it play out.

| On-screen caption |
|---|
| "Click a claim. Hear where it came from." |

### Scene 3 — Intra-op (1:02–1:19)
**Source:** `sg0031-demo-03-intraop.mp4` — ⚠ **this recording is only 33s
because its own idempotency check (see `DEMO_RECORDING.md`) likely found
memos already uploaded from a prior run and skipped straight to
review/sign-off — it may not contain the voice-memo upload moment at all.**
Before cutting this scene, scrub it. If it opens on an already-generated
record, re-run `run_sg0031_demo.sh --part intraop` against a **fresh**
case store to capture four voice memos stacking up in sequence — that's the
stronger visual for a 17s beat than a static review screen. Crop to the
memo list / timeline, not the full app chrome.

| On-screen caption |
|---|
| "Hands stay on the patient." |

### Scene 4 — Post-op (1:19–1:36)
**Source:** `sg0031-demo-04-postop.mp4`. Two quick sub-cuts inside one
inset frame (whip-pan or hard cut between them, frame stays on screen):
(a) the handoff's anticoagulation-follow-up line with its citation, crop
tight; (b) the Equipment Stock screen, crop to this case's reservation tag.
Drop the live case-chat beat from this cut — not enough time at 2:00 total,
and the handoff + equipment payoff is the stronger pair.

| On-screen caption |
|---|
| "Nothing signed off gets left out." |

---

## Provenance beat (1:36–1:48)

No video — Components 2 and 3 above, back to back.

| Time | Visual | On-screen text |
|---|---|---|
| 1:36–1:42 | Claim shatter → claim lock (Component 2) | "A claim cannot exist without a citation." |
| 1:42–1:48 | Radial ring + counter to 100 (Component 3) | "100%. Structural, not scored." |

---

## Close (1:48–2:00)

| Time | Visual | On-screen text |
|---|---|---|
| 1:48–1:54 | `codespace.png` inside a `.browser-inset` frame (same component as the demo scenes — bookends the video), gentle Ken-Burns zoom | "One click. No GPU. No API key needed to try it." |
| 1:54–1:58 | Wordmark returns, GitHub mark + URL beneath | **PeriOp Companion** — github.com/tijoseymathew/periop-companion |
| 1:58–2:00 | Fine print, byte-for-byte the same as the README/deck disclaimer | "Fully synthetic data · no PHI · documentation support only — not a medical device." |
