# PeriOp Companion

An agentic peri-operative documentation assistant for anesthesia providers. It
follows one patient through pre-op, intra-op, and post-op — flagging record gaps,
transcribing interviews and voice notes, and drafting the notes and PACU handoff.

**Every claim in every generated note carries provenance** to a source record
chunk or a timestamped, diarized audio segment. Clinicians will not trust — and
sovereign-health regulators will not accept — generated notes that cannot show
their work.

Built on the NVIDIA Ambient Provider blueprint, orchestrated with **Google ADK**,
evaluated with the **NVIDIA NeMo Agent Toolkit (NAT)**, powered by **NVIDIA NIMs**
(Nemotron Super 49B + Nano 9B, Parakeet ASR, Magpie TTS).

> Reference/demonstration project. All data is **synthetic, no PHI**.
> Documentation-support tool only — **not a medical device** and not a clinical
> decision-making system.

📖 **[Full documentation →](https://tijoseymathew.github.io/periop-companion/)**

## Try it in your browser

One click runs the full app — API + review UI — in the browser. No GPU. With
**no API key** it runs a keyless demo over committed synthetic cases; add an
`NGC_API_KEY` ([get one at build.nvidia.com](https://build.nvidia.com)) to switch
to live generation.

- **GitHub Codespaces** — *Code → Codespaces → Create*. Builds, starts, and
  forwards the port automatically.
- **Docker** — `docker build -t periop-companion . && docker run --rm -p 7860:7860 periop-companion` → <http://localhost:7860>
- **Hugging Face Space** — duplicate it and add your `NGC_API_KEY` secret.

See **[Run in your browser →](https://tijoseymathew.github.io/periop-companion/deploy/)**.

## Run locally

```bash
uv sync                 # Python 3.12 environment
uv run pytest           # test suite, no network

# live runs need an NVIDIA key (NGC_API_KEY in .env); no GPU required
uv run periop create "Hip repair" --provider p-lim   # drive the workflow from the terminal
uv run python -m periop.api                # → http://localhost:8000 (build ui/ first)
```

Every path is env-selected: the **same code runs against hosted NIMs or
self-hosted NIMs with no code change** (`PERIOP_*_BASE_URL`). The reference
sovereign deployment co-tenants all four NIMs on a single DGX Spark GB10 —
see **[Self-hosted NIMs →](https://tijoseymathew.github.io/periop-companion/selfhosted/)**.

## How it works

| | |
|---|---|
| **Pre-op** | A **GapAnalyst** flags what to clarify (missing / stale / conflicting, each citing its chunk); the diarized interview is transcribed; a claim-structured pre-anesthesia note is written and every claim verified. |
| **Intra-op** | Voice notes are transcribed and structured into events; the chronological record is written; post-op issues are anticipated with cross-stage provenance. |
| **Post-op** | The SBAR **PACU handoff** is composed from existing claims only — selected and reordered, never newly invented — plus a post-anesthesia evaluation. |

**Three ways in — one workflow.** A React SPA, a terminal CLI (`periop`), and an
[agent skill](https://github.com/NVIDIA/NemoClaw)-style `SKILL.md` all converge
on one FastAPI process. Conformance tests pin them together: **CLI == API ==
batch**, byte-identical ledgers.

**Provenance is structural, not annotated** — notes are rendered *from* a claim
set, so a claim cannot exist without a citation. Click a claim in the review UI
and it plays the exact audio clip `(t0 → t1)` or highlights the cited document
chunk.

Read more: **[Architecture](https://tijoseymathew.github.io/periop-companion/architecture/)** ·
**[ADK orchestration](https://tijoseymathew.github.io/periop-companion/adk-orchestration/)** ·
**[Provenance & explainability](https://tijoseymathew.github.io/periop-companion/provenance/)** ·
**[Front-end](https://tijoseymathew.github.io/periop-companion/frontend/)** ·
**[Attribution](https://tijoseymathew.github.io/periop-companion/attribution/)**

## License

[Apache-2.0](LICENSE). Synthetic data only, no PHI. Not a medical device.
