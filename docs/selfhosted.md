# Self-hosted NIM deployment (spec §8.1 / M6)

PeriOp Companion defaults to hosted NIMs on build.nvidia.com, but every model
call resolves its endpoint from the environment, so the full pipeline runs
against locally deployed NIMs with zero code changes — and zero rate limits,
which is what unblocks scaling the synthetic dataset.

## Switching endpoints

| Variable | Meaning |
|---|---|
| `PERIOP_NIM_BASE_URL` | OpenAI-compatible base URL for both LLM tiers |
| `PERIOP_REASONING_BASE_URL` / `PERIOP_FAST_BASE_URL` | Per-tier overrides (win over the generic) |
| `PERIOP_REASONING_MODEL` / `PERIOP_FAST_MODEL` | Served-model name overrides |
| `PERIOP_ASR_BASE_URL` / `PERIOP_TTS_BASE_URL` | Speech NIM HTTP endpoints (Parakeet / Magpie) |
| `PERIOP_ASR_GRPC_URL` | Parakeet Riva gRPC endpoint (diarization + word boosting live here, not on HTTP) |
| `PERIOP_REASONING_THINKING=1` / `PERIOP_FAST_THINKING=1` | Re-enable Nemotron reasoning (`<think>`) on a tier — both default off ([specs/v2-speed.md](../specs/v2-speed.md) §3.1); at the self-hosted decode rate thinking tokens dominate latency |

`NGC_API_KEY` is only required for the hosted endpoint; local NIMs don't
authenticate. `configs/selfhosted.env` is a sourceable endpoint set:

```bash
set -a; source configs/selfhosted.env; set +a
uv run python -m periop.cli.run_case sg-0001
uv run nat run --config_file configs/selfhosted.yml --input sg-0001
```

## Reference deployment: one DGX Spark (GB10)

All four NIMs run co-tenant on a single GB10 (aarch64, Blackwell sm_121,
120 GB unified memory) via docker compose:

| Role | NIM image | Port |
|---|---|---|
| Reasoning | `llama-3.3-nemotron-super-49b-v1.5` | `:8000` (OpenAI HTTP) |
| Fast | `nvidia-nemotron-nano-9b-v2-dgx-spark` | `:8001` (OpenAI HTTP) |
| ASR | `parakeet-1-1b-ctc-en-us` | `:9000` HTTP / `:50051` gRPC |
| TTS | `magpie-tts-multilingual` | `:9001` HTTP / `:50052` gRPC |

Notes that generalize beyond this box:

- **KV-cache bounding is what makes co-tenancy work.** LLM NIMs size their KV
  cache to most of GPU memory by default and starve co-tenants. Setting
  `NIM_KVCACHE_PERCENT=0.3` (49B) and `0.15` (nano) lets all four services
  share 120 GB. Bring services up sequentially, heaviest first.
- **On DGX Spark, prefer a model's `…-dgx-spark` NIM variant when one
  exists.** The generic `nvidia-nemotron-nano-9b-v2` arm64 tag actually ships
  x86-64 binaries (verifiable with `readelf` on an in-image binary) and
  crash-loops with `exec format error`; the `-dgx-spark` variant is genuinely
  aarch64.
- Models cache to a host volume (`/opt/nim/.cache` in-container), so restarts
  don't re-download. First pull of all four models is ~30 min each.
- Health check: `curl http://<host>:<port>/v1/health/ready`.

This replaces the spec's original "Parakeet ≈1 GPU; Super 49B ≈2×H100/4×A100"
sizing estimate: with bounded KV caches the entire stack fits one GB10.
