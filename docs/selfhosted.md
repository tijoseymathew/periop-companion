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
| `PERIOP_VERIFIER_CONCURRENCY` | Parallel claim-verification calls (default 4; `0`/`1` = sequential) — the knob for rate-limited hosted endpoints; a local Nano NIM serves this level of concurrency comfortably |

`NGC_API_KEY` is only required for the hosted endpoint; local NIMs don't
authenticate. `configs/selfhosted.env` is a sourceable endpoint set:

```bash
set -a; source configs/selfhosted.env; set +a
uv run python -m periop.cli.run_case sg-0001
uv run nat run --config_file configs/selfhosted.yml --input sg-0001
```

## Running the whole pipeline locally

The pipeline needs four NIMs. Each is an ordinary OpenAI- or Riva-compatible
service, so they can live on one host or several — periop only cares about the
URLs above.

| Role | What it serves | Example image | Protocol |
|---|---|---|---|
| Reasoning | notes, gap analysis, claim structuring (Nemotron Super 49B) | `llama-3.3-nemotron-super-49b-v1.5` | OpenAI HTTP |
| Fast | high-volume light calls (Nemotron Nano 9B) | `nvidia-nemotron-nano-9b-v2` | OpenAI HTTP |
| ASR | batch transcription + diarization (Parakeet) | `parakeet-1-1b-ctc-en-us` | HTTP + Riva gRPC |
| TTS | speech synthesis (Magpie) | `magpie-tts-multilingual` | HTTP + Riva gRPC |

The images above are the ones periop is developed against; any endpoint that
speaks the same API works. Models cache to a host-mounted volume
(`/opt/nim/.cache` in-container), so restarts don't re-download; the first pull
of each model is large (tens of minutes). Health-check any service with
`curl http://<host>:<port>/v1/health/ready`.

The spec's original sizing note ("Parakeet ≈1 GPU; Super 49B ≈2×H100/4×A100")
assumes a NIM per GPU. If you have that, deploy each role on its own device and
skip the rest of this page. The learnings below are for the harder case: fitting
all four onto **one** GPU with a shared memory pool.

## Learnings: co-tenancy on a single shared-memory GPU

Everything here comes from actually standing the four NIMs up co-resident on a
single GPU. The recurring theme: **on a shared memory pool the binding
constraint is total memory, and the LLM NIMs grab far more than you expect
unless you bound them explicitly.**

- **The KV cache is the real footprint knob — not `--gpu-memory-utilization`.**
  This is the single most important finding, and it corrects the intuitive
  approach. `--gpu-memory-utilization` (and the `NIM_KVCACHE_PERCENT` /
  `NIM_GPU_MEM_FRACTION` env vars) only set the *startup gate*; once running,
  vLLM still sizes the KV cache to the **profile's** default utilization and
  grabs whatever memory is free — non-deterministically, and *more* when more is
  free at load. A 49B reasoning NIM was measured taking 64–72 GB this way,
  starving its co-tenants out. Hard-cap it instead with
  `--kv-cache-memory-bytes` (e.g. 6 GiB): the model then pins at
  `weights + KV cap` regardless of free memory at load, so it fits alongside the
  others *and can restart at any time* without re-winning a memory race. Pass
  this as a real vLLM flag through the NIM's passthrough-args env var — some NIM
  builds silently ignore the equivalent `NIM_*` env vars.

- **Pin a quantization profile; don't rely on auto-selection.** Profile
  auto-selection picks the largest one that fits *at load time*. On an empty GPU
  that can be a big FP8 profile needing lots of free memory — which then can
  never restart once co-tenants are up and that window has closed. Pin a smaller
  profile (e.g. an NVFP4 single-GPU one) explicitly so bring-up is repeatable.

- **Add `--enforce-eager` for the heavy LLM.** CUDA-graph capture causes a
  transient memory spike at startup that can OOM-kill a co-resident service. On a
  memory-bound box the graph latency win is marginal anyway (decode is
  bandwidth-bound — see below), so disabling capture trades almost nothing for
  reliability.

- **Bring services up sequentially and verify `/health/ready` before the next.**
  Watch for the trap where a container stays `Up` with `0 restarts` but its
  engine has already aborted (KV didn't fit) and the port never serves — confirm
  readiness with the health endpoint, not `docker ps`.

- **Trim ASR to the pipeline you actually use.** periop only calls the batch
  `/v1/audio/transcriptions` endpoint, which needs the *offline* engine plus VAD
  and diarization — not the streaming engines. Selecting offline-only
  (`mode=ofl` on Parakeet) drops the streaming engines and reclaims a large chunk
  of memory with no loss of function for this workload.

- **Don't starve the fast tier's KV either.** A budget that just fits the fast
  model's weights can leave too little for even one request's KV cache, and the
  engine aborts at startup. Give it enough headroom for KV; the weights are the
  smaller half of the requirement.

- **Reasoning tool-calling may need serving-side flags.** OpenAI `tool_choice`
  auto isn't always enabled by default; turning it on can require passing the
  vLLM tool-parser flags (and, on some images, a parser plugin matching the
  bundled vLLM version). If reasoning tool calls 400, check the serving side
  before suspecting periop.

## Performance expectations

Batch-1 decode on a single-GPU box is **memory-bandwidth-bound**: each token
reads every weight byte, so per-stream throughput ≈ memory bandwidth ÷ weight
size, and no amount of config tuning moves it much. On the example box the 49B
reasoning tier decoded at a flat ~7.7 tok/s regardless of prompt or output size,
and a full case is dominated by a handful of long reasoning generations.

That is why both tiers **default thinking off** (`PERIOP_REASONING_THINKING` /
`PERIOP_FAST_THINKING`): with thinking on, the `<think>` tokens are the
overwhelming majority of the wall clock. If you need the reasoning quality that
thinking buys, expect a large latency cost per call — or serve the reasoning
tier on hardware with more memory bandwidth, or point that one tier at the
hosted endpoint while keeping the rest local. The fast tier is a small fraction
of the wall clock and generally isn't worth tuning.
