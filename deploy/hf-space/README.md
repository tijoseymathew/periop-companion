---
title: PeriOp Companion
emoji: 🩺
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: Provenance-tracked peri-operative documentation on NVIDIA NIMs
---

<!--
  This file is the README for the Hugging Face Space, NOT the GitHub repo.
  Copy it to the Space repo's root as `README.md` — Hugging Face reads the YAML
  frontmatter above (sdk: docker, app_port: 7860) to build and route the Space.
  Deploy steps: deploy/hf-space/DEPLOY.md.
-->

# PeriOp Companion

An agentic peri-operative documentation assistant for anesthesia providers,
built on the NVIDIA Ambient Provider blueprint, orchestrated with **Google ADK**
and instrumented/evaluated with the **NVIDIA NeMo Agent Toolkit**. Every claim
in every generated note carries provenance to a source chunk or a timestamped,
diarized audio segment.

> Reference/demonstration project. All data is **synthetic, no PHI**.
> Documentation-support tool only; **not a medical device**.

## How this Space runs

- **No key set (default):** the Space boots a **keyless demo** — the full review
  UI over committed synthetic cases, with instant stage runs. Nothing to
  configure; just open it.
- **With your NIM key:** set an `NGC_API_KEY` **Space secret** and restart, and
  the reasoning/fast tiers call **hosted NVIDIA NIMs** on build.nvidia.com (no
  GPU) for live generation.

**Make it live in 60 seconds:** click ⋮ → **Duplicate this Space**, then in your
copy's **Settings → Variables and secrets** add a secret `NGC_API_KEY` with a
key from <https://build.nvidia.com> (top-right *Get API Key*, `nvapi-…`).

Source, docs, and the one-click Dev Container / Codespaces path:
<https://github.com/tijoseymathew/periop-companion> · full guide: `docs/deploy.md`.
