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
- `assets/` — the live-NIM `sg-0031` recordings (`preop`, `intraop`, `postop`)
  and the GitHub Codespaces screenshot used in the closing CTA.
- `demo-video-script.md` (one level up) — the shot-by-shot brief.
- `renders/` — gitignored. Render output is a reproducible build artifact, not
  tracked; run the command below to produce `renders/periop-demo.mp4` locally
  (1920×1080 · 30 fps · 80 s).

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
