# Run PeriOp Companion in your browser

Three zero-to-running paths, from "click a button" to "public URL". All of them
serve the same single process — the FastAPI backend **and** the built React
review UI — and all of them run on **CPU only**: the default path calls hosted
NVIDIA NIMs on [build.nvidia.com](https://build.nvidia.com), no local GPU.

| Path | Best for | Public URL? | Needs |
|------|----------|-------------|-------|
| [GitHub Codespaces / Dev Container](#1-github-codespaces--dev-container) | Trying the full app + code in-browser | No (private forwarded port) | GitHub account |
| [Docker (local)](#2-docker-local) | Running on your own machine | No | Docker |
| [Hugging Face Docker Space](#3-hugging-face-docker-space) | Sharing a live link | **Yes** | HF account |

## Two runtime modes

The app boots in one of two modes, chosen automatically from the environment
(logic in [`docker/entrypoint.sh`](../docker/entrypoint.sh) and
[`.devcontainer/start.sh`](../.devcontainer/start.sh)):

- **Stub demo (no key).** The *real* server with an instant stub pipeline: the
  full review UI over committed **synthetic** cases, stage runs that complete
  immediately, no network calls. Nothing to configure — this is what you get
  with no API key. Great for exploring the workflow and the click-to-play audio
  provenance.
- **Live (your NIM key).** Set `NGC_API_KEY` and the reasoning
  (`llama-3.3-nemotron-super-49b`) and fast (`nemotron-nano-9b`) tiers call
  hosted NIMs for real generation — gap analysis, note writing, per-claim
  verification with fresh provenance.

You can force either mode with `PERIOP_STUB_RUNNER=1` (demo) or `0` (live).

> **A note on speech.** The hosted key covers the LLM tiers. The keyless demo
> already exercises the whole UI including audio provenance, replayed from
> committed cases.
>
> The **speech-to-text** pipeline can also run hosted, GPU-free, against
> NVIDIA's hosted Parakeet ASR over NVCF using the same `NGC_API_KEY` —
> including **speaker diarization** for the pre-op interview:
>
> ```bash
> PERIOP_ASR_GRPC_URL=grpc.nvcf.nvidia.com:443
> PERIOP_ASR_USE_SSL=1
> PERIOP_ASR_FUNCTION_ID=<function id — see below>
> ```
>
> **Finding the function id.** It's per-model and can rotate, so look it up
> rather than hardcoding one:
>
> 1. Go to the Parakeet CTC 1.1B model page:
>    [build.nvidia.com/nvidia/parakeet-ctc-1_1b-asr/api](https://build.nvidia.com/nvidia/parakeet-ctc-1_1b-asr/api).
> 2. Find the `curl` example under **Try API**. It calls
>    `https://<FUNCTION_ID>.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions`
>    — the UUID between `https://` and `.invocation.api.nvcf.nvidia.com` is the
>    function id. Copy that into `PERIOP_ASR_FUNCTION_ID`.
>
> That curl example itself hits the OpenAI-style HTTP transcription route,
> which returns plain text with no speaker info. The *same* function id, used
> over the gRPC streaming path (what this app does), does return diarization —
> verified end to end against a real interview recording.
>
> Two things to know about the hosted endpoint:
>
> - **It's streaming-only** — `offline_recognize` is rejected
>   (`INVALID_ARGUMENT: … type=offline`). The app handles this transparently:
>   batch uploads (pre-op interview, intra-op notes) are fed through the
>   streaming API internally, so `transcribe()` behaves the same as against a
>   local NIM. Diarized segments and word timings come back unchanged.
> - **Diarization only comes back over gRPC streaming.** The OpenAI-style HTTP
>   `/v1/audio/transcriptions` route (the curl example above) never returns
>   speaker info, even for a diarization-capable function — you have to use the
>   gRPC path to see speaker tags at all.
>
> **Text-to-speech (Magpie TTS)** has no hosted equivalent and still needs a
> **self-hosted** NIM — see [selfhosted.md](selfhosted.md). It's only used to
> *render* synthetic case audio, not in the review flow.

---

## 1. GitHub Codespaces / Dev Container

One click gives you the full app running behind a forwarded port, plus the
codebase in a browser VS Code.

**On GitHub:** click **Code → Codespaces → Create codespace on `main`**. Or, in
VS Code with the *Dev Containers* extension: **Reopen in Container**.

What happens:

1. [`.devcontainer/setup.sh`](../.devcontainer/setup.sh) installs ffmpeg + uv,
   runs `uv sync`, and builds the SPA (`ui/dist`). One-time, a few minutes.
2. On attach, [`.devcontainer/start.sh`](../.devcontainer/start.sh) launches the
   server; port **8000** auto-forwards and opens in your browser.

**Go live:** edit the generated `.env`, set `NGC_API_KEY=nvapi-…`
([get one below](#getting-a-nim-api-key)), and restart the app
(`bash .devcontainer/start.sh` in a fresh terminal). No key → the keyless demo.

---

## 2. Docker (local)

The repo-root [`Dockerfile`](../Dockerfile) builds one image that serves
everything on port 7860.

```bash
# build
docker build -t periop-companion .

# run the keyless demo -> http://localhost:7860
docker run --rm -p 7860:7860 periop-companion

# run live with your NIM key
docker run --rm -p 7860:7860 -e NGC_API_KEY=nvapi-xxxx periop-companion
```

Handy overrides: `-e PERIOP_STUB_RUNNER=1` forces the demo; `-e PORT=8080 -p
8080:8080` changes the port; `--env-file .env` loads a whole `.env`.

---

## 3. Hugging Face Docker Space

Gives the app a **public live URL**. The Space builds the same root
`Dockerfile`; Hugging Face exposes port 7860 (its Docker-Space default) which
the image already listens on.

The public Space runs the **keyless demo**. Anyone can **Duplicate** it and add
their own `NGC_API_KEY` secret to get a live instance — no key is ever baked
into the image.

Full step-by-step (create the Space, push, add the key secret):
[`deploy/hf-space/DEPLOY.md`](../deploy/hf-space/DEPLOY.md). The Space's README
(with the required HF metadata) is prepared at
[`deploy/hf-space/README.md`](../deploy/hf-space/README.md).

---

## Getting a NIM API key

The live modes use **your own** NVIDIA NIM API key — it stays in your
environment/secrets and is never committed or shipped in an image.

1. Sign in at **[build.nvidia.com](https://build.nvidia.com)** (free), the
   hosted front door to [NVIDIA NIM](https://developer.nvidia.com/nim).
2. Open any model (e.g. *llama-3.3-nemotron-super-49b-v1.5*) and click
   **Get API Key** (top-right). It looks like `nvapi-…`.
3. The one key authorizes both tiers this app calls. Provide it as:
   - **Codespaces / local:** `NGC_API_KEY` in `.env` (copy from `.env.example`),
     or `-e NGC_API_KEY=…` on `docker run`.
   - **Hugging Face Space:** a **secret** named `NGC_API_KEY`
     (Settings → Variables and secrets).

`NVIDIA_API_KEY` is accepted as a synonym everywhere `NGC_API_KEY` is.

## Optional: Langfuse tracing

Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` (all
three) and live stage runs export OTel traces to your Langfuse project; leave
any unset and the app runs normally after one startup warning. See
[the observability section of the README](../README.md#observability-langfuse-live-and-batch-alike).
