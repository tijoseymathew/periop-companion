---
name: periop-deploy
description: Deploy PeriOp Companion - stand up the full app (FastAPI backend + built React review UI, one process) via local Docker, GitHub Codespaces / Dev Container, a Hugging Face Docker Space, or a bare local dev run. Covers the stub-by-default runtime (keyless demo with no network calls) versus live hosted-NIM generation with an NGC_API_KEY, the full PERIOP_* environment contract, port selection, and optional Langfuse tracing. Use when asked to deploy, run, host, demo, or containerize PeriOp Companion, or to switch an instance between demo and live mode. Trigger keywords - deploy, docker, codespaces, dev container, hugging face space, NGC_API_KEY, stub demo, live mode, run the app, host periop.
license: Apache-2.0
---

# Deploy PeriOp Companion

Stand up the whole app — API and review UI — as **one process** on CPU only.
The default live path calls hosted NVIDIA NIMs on
[build.nvidia.com](https://build.nvidia.com); no GPU is ever required. All data
is synthetic — this is a documentation-support reference project, never a
medical device, and no real patient details may be entered anywhere.

## Step 1: Understand the two runtime modes

The app auto-detects its mode at boot (`docker/entrypoint.sh`,
`.devcontainer/start.sh`):

- **No NIM API key → STUB demo.** No network calls, committed synthetic cases,
  instant stage runs. Perfect for exploring the UI and workflow.
- **`NGC_API_KEY` (or synonym `NVIDIA_API_KEY`) present → LIVE.** Stage
  generation calls hosted NIMs; runs take minutes per stage.
- Force either mode explicitly: `PERIOP_STUB_RUNNER=1` (demo) or `=0` (live).

Get a free key at [build.nvidia.com](https://build.nvidia.com) — open any model
page, click **Get API Key** (top-right); it looks like `nvapi-…`. One key
authorizes both LLM tiers and hosted Parakeet ASR. The key stays in your
environment or secrets — never commit it or bake it into an image.

## Step 2: Pick a path

### A. Docker (local)

The repo-root `Dockerfile` builds one image (stage 1 builds the SPA with
node:20, stage 2 is python:3.12-slim + `uv sync --frozen`) serving on **7860**:

```bash
docker build -t periop-companion .
docker run --rm -p 7860:7860 periop-companion                       # keyless demo
docker run --rm -p 7860:7860 -e NGC_API_KEY=nvapi-xxxx periop-companion   # live
```

Handy overrides: `-e PERIOP_STUB_RUNNER=1` forces the demo even with a key;
`-e PORT=8080 -p 8080:8080` moves the port (`$PORT` wins, then
`PERIOP_API_PORT`, then 7860); `--env-file .env` loads a whole env file.

### B. GitHub Codespaces / Dev Container

Click **Code → Codespaces → Create codespace on `main`** (or "Reopen in
Container" in VS Code). `.devcontainer/setup.sh` installs ffmpeg + uv, runs
`uv sync`, and builds `ui/dist` (one-time, a few minutes);
`.devcontainer/start.sh` then launches the server and port **8000**
auto-forwards. To go live, set `NGC_API_KEY=nvapi-…` in the generated `.env`
and restart with `bash .devcontainer/start.sh` in a fresh terminal.

### C. Hugging Face Docker Space (public URL)

The Space builds the same root `Dockerfile`; HF exposes 7860, which the image
already listens on. The public Space runs the keyless demo; anyone can
**Duplicate** it and add an `NGC_API_KEY` **secret** (Settings → Variables and
secrets) for a live instance. Step-by-step: `deploy/hf-space/DEPLOY.md`; the
Space README with required HF metadata is prepared at
`deploy/hf-space/README.md`.

### D. Bare local dev run

```bash
uv sync                                   # Python 3.12 env
(cd ui && npm ci && npm run build)        # the API serves ui/dist at /
uv run python -m periop.api               # → http://localhost:8000
```

Copy `.env.example` → `.env` first; it documents every variable below.

## Step 3: Know the environment contract

All optional — with nothing set, the app boots the keyless stub demo.

- `NGC_API_KEY` / `NVIDIA_API_KEY` — NIM key; presence selects live mode.
- `PERIOP_STUB_RUNNER` — `1` force demo, `0` force live, unset = auto.
- `PERIOP_REASONING_MODEL` / `PERIOP_FAST_MODEL` — default
  `nvidia/llama-3.3-nemotron-super-49b-v1.5` / `nvidia/nvidia-nemotron-nano-9b-v2`.
- `PERIOP_REASONING_BASE_URL` / `PERIOP_FAST_BASE_URL` — default
  `https://integrate.api.nvidia.com/v1`; point at self-hosted NIMs to run fully
  local with **no code change** (see `docs/selfhosted.md`).
- Hosted ASR with diarization (uses the same key):
  `PERIOP_ASR_GRPC_URL=grpc.nvcf.nvidia.com:443`, `PERIOP_ASR_USE_SSL=1`,
  `PERIOP_ASR_FUNCTION_ID=<uuid>` — read the function id from the **Try API**
  curl example on the Parakeet page at build.nvidia.com (it rotates; look it
  up, don't hardcode).
- `PERIOP_TTS_BASE_URL` — Magpie TTS, self-hosted only; used only to render
  synthetic case audio, never by the review flow.
- `PERIOP_API_HOST` / `PERIOP_API_PORT` — bind address (containers set
  `0.0.0.0:7860`).
- `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` + `LANGFUSE_BASE_URL` — all
  three set → stage runs export OTel traces; any missing → one startup warning
  and zero telemetry, never a crash.

## Step 4: Verify the deployment

1. `curl -s http://localhost:7860/` returns the SPA's HTML (adjust port/path).
2. The boot log names the mode: `LIVE mode (hosted NIMs …)` or
   `STUB demo mode (no network; synthetic cases; instant stage runs)`.
3. In the UI, open a seeded `sg-*` case from the worklist — it renders
   read-only with its claim ledger and playable audio citations.
4. Live check (spends model time): create a case, add records, run pre-op —
   progress should stream stage-by-stage.

## Common mistakes to avoid

- **Do not bake a key into an image or commit `.env`.** Keys are env/secrets
  only; the public HF Space must stay keyless.
- **Do not expect live speed from a demo, or demo speed from live.** Stub runs
  are instant; live stages take minutes each. Never kill a run that is
  streaming progress.
- **Do not skip the UI build on the bare path.** `python -m periop.api` serves
  `ui/dist`; without a build you get an API with no front-end.
- **Do not fight the port logic in containers.** `$PORT` (host-injected) beats
  `PERIOP_API_PORT` beats 7860 — publish the port you actually configured.
- **Do not add a GPU.** Every path is CPU-only; models run behind hosted or
  self-hosted NIM endpoints.
- **Do not enter real patient details.** Synthetic data only, in every mode.
