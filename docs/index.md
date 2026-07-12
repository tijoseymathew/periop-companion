# PeriOp Companion

An agentic peri-operative documentation assistant for anesthesia providers,
built on the NVIDIA Ambient Provider blueprint, orchestrated with **Google
ADK**, instrumented and evaluated with the **NVIDIA NeMo Agent Toolkit (NAT)**,
and grounded in Singapore demographics via **Nemotron-Personas-Singapore**.

**Every claim in every generated note carries provenance** to either a source
record chunk or a timestamped, diarized audio segment — because clinicians will
not trust, and sovereign-health regulators will not accept, generated notes that
cannot show their work.

!!! warning "Reference/demonstration project"
    All data is **synthetic, no PHI**. This is a documentation-support tool
    only — **not a medical device** and not a clinical decision-making system.

## The problem in one sentence

Three phases (pre-op, intra-op, post-op), scattered truth (documents + audio),
and trust that requires provenance.

## What it does

PeriOp Companion follows one patient through all three phases, generating
stage-appropriate documentation where each statement is traceable:

- **Pre-op** — ingests prior records, runs a **GapAnalyst** that flags what to
  clarify, transcribes the diarized interview, writes a claim-structured
  **pre-anesthesia note**, and **verifies** every claim against its cited spans.
- **Intra-op** — transcribes the anesthetist's voice notes, extracts structured
  events (Nemotron Nano first pass → Super verification), writes the
  chronological record, and anticipates post-op issues.
- **Post-op** — composes a **PACU handoff** from existing claims only (select /
  order / rephrase, but never a new claim — provenance is inherited), plus a
  post-anesthesia evaluation note.

## Where to go next

<div class="grid cards" markdown>

- :material-sitemap: **[Architecture](architecture.md)** — the full map: system
  diagram, agent-handoff flows, and component tables.
- :material-family-tree: **[ADK orchestration](adk-orchestration.md)** — how the
  stage pipeline is composed.
- :material-fingerprint: **[Provenance & explainability](provenance.md)** — why
  provenance is structural, not annotated.
- :material-react: **[Front-end](frontend.md)** — the React SPA: screens,
  invariants, status vocabulary.
- :material-server: **[Self-hosted NIMs](selfhosted.md)** — running against your
  own NIM deployment with no code change.
- :material-source-branch: **[Attribution](attribution.md)** — what was reused
  from the blueprint versus built here.

</div>

## Quickstart

```bash
uv sync                 # Python 3.12 environment
uv run pytest           # run the test suite (no network)
```

Live runs need an NVIDIA API key (`NGC_API_KEY` in `.env`). No GPU required —
the default path uses hosted NIMs on build.nvidia.com.

**Design rule:** ADK owns orchestration, NAT owns observability and evaluation,
the `Case` is the single source of truth.
