# PeriOp Companion — demo video

The ~80-second silent demo video for the PeriOp Companion repo. 16:9, on-screen
text only (reads with the sound off), built to `../demo-video-script.md`.

It moves through **problem → solution → proof**: a cold-open on the scattered
sources of truth, then the three perioperative stages (Pre-op, Intra-op,
Post-op) shown as live product footage inside a browser frame — each with its
inputs and outputs called out — and a provenance beat proving every generated
claim traces back to a source.

## Built with HyperFrames

This video is a **[HyperFrames](https://hyperframes.heygen.com)** composition:
the entire piece is a single seekable `index.html` — motion-graphics scenes in
CSS/GSAP plus the live `sg-0031` screen recordings composited into a floating
browser inset — rendered deterministically to MP4. HyperFrames is HeyGen's
HTML-to-video framework. Thanks to the HyperFrames team.

## Layout

- `index.html` — the whole composition (one paused GSAP timeline, `data-*`
  timing, framework-owned `<video>` playback cropped per scene via `clip-path`).
- `demo-video-script.md` (one level up) — the shot-by-shot brief.
- `assets/` — gitignored. The source footage the composition reads (see below).
- `renders/` — gitignored. Render output is a reproducible build artifact; run
  the command below to produce `renders/periop-demo.mp4` locally (1920×1080 ·
  30 fps · 80 s).

## Getting the source footage

`assets/` isn't committed — it's captured footage, not code, and the canonical
recording session already lives in the `periop-companion` repo. Before
`npm run render` or `npm run dev` will work, populate it:

```bash
COMPANION=../../periop-companion   # adjust to your checkout
mkdir -p assets
cp "$COMPANION/ui/e2e/.recordings/sg0031-demo-02-preop.mp4"   assets/preop.mp4
cp "$COMPANION/ui/e2e/.recordings/sg0031-demo-03-intraop.mp4" assets/intraop.mp4
cp "$COMPANION/ui/e2e/.recordings/sg0031-demo-04-postop.mp4"  assets/postop.mp4
```

If that directory is empty, re-record the sg-0031 case first — see
`$COMPANION/ui/e2e/DEMO_RECORDING.md` and `record_sg0031_demo.mjs` (drives the
live app through Playwright against real NIM inference; takes roughly 10
minutes per part, not a quick rebuild).

`assets/codespace.png` has no script — it's a manual screenshot of the GitHub
Codespaces one-click-run flow on the repo's landing page. Retake it at
1920×1080 (or close to it; the composition crops to a 940×529 inset) whenever
the Codespaces UI changes materially.

## Rebuild

```bash
npm run check     # lint + runtime + layout + motion + contrast
npm run render    # → renders/periop-demo.mp4 (add --video-frame-format png for crisp UI text)
npm run dev       # live preview in HyperFrames Studio
```

## Notes

- No voiceover; a silent underscore track was intentionally left off.
- Post-op shows the completed PACU handoff + post-anaesthesia evaluation (both
  with citations) rather than the scripted equipment-stock screen — that view
  isn't present in the `sg-0031` recordings.
- All footage uses fully synthetic data — no PHI.
