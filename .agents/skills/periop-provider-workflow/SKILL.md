---
name: periop-provider-workflow
description: Drive the PeriOp Companion provider workflow from the terminal - create a case, add prior records and the op plan, review the GapAnalyst's questions, upload stage audio, generate NAT-traced stage outputs, review the claim ledger with provenance, sign off, and acknowledge the PACU handoff. Use when asked to walk a peri-operative case through pre-op, intra-op, or post-op documentation, demo the three-provider handoff story, or exercise the workflow API without a browser. Trigger keywords - periop, pre-op evaluation, intra-op record, PACU handoff, sign off, case workflow, claim ledger, provenance, anesthesia documentation.
license: Apache-2.0
---

# Drive the PeriOp Companion Provider Workflow

Walk a synthetic peri-operative case through the full provider workflow using
the `periop` CLI. Every command is an HTTP call against the same API the
browser UI uses, so stage gates, error messages, and NAT/Langfuse tracing
behave identically to the product. All data is synthetic — this is a
documentation-support reference project, never a medical device, and no real
patient details may be entered anywhere.

## Prerequisites

- The [periop-companion](https://github.com/tijoseymathew/periop-companion) repository, with `uv sync` completed (Python 3.12).
- **Live mode** needs `NGC_API_KEY` in `.env` (hosted NIMs on build.nvidia.com) or `PERIOP_*` endpoint variables for self-hosted NIMs. Stage generation then takes **minutes per stage** (tens of minutes on local NIMs) — never kill a run that is streaming progress.
- **Demo mode** needs nothing: start the server with `PERIOP_STUB_RUNNER=1` for instant deterministic artifacts. Use this to learn the flow before spending model time.
- Optional: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` all set → every stage run exports a NAT trace to Langfuse; any missing → one startup warning and zero telemetry, never a crash.
- Audio uploads: `.wav` always works; other formats need `ffmpeg` on the server.

## Step 1: Choose the Transport

Run `uv run periop --help` from the repository root to confirm the CLI is
installed. Then pick one of:

- **Against a running server** (the browser UI's server, or a demo server):

  ```bash
  uv run python -m periop.api &          # optionally PERIOP_STUB_RUNNER=1
  export PERIOP_API_URL=http://localhost:8000
  ```

- **Auto-hosted** (no server): omit `PERIOP_API_URL` and every `periop`
  command hosts the app itself on an ephemeral port, NAT session included.
  Slower per command (one app boot each), but zero setup.

## Step 2: Pick an Acting Provider

The provider is attribution, not identity — it stamps `performed_by` and
`signed_off_by` on stages.

```bash
uv run periop providers                  # roster from data/providers.json
export PERIOP_PROVIDER=p-lim             # or pass --provider on each command
```

The canonical demo uses three identities: `p-lim` (pre-op clinic), `p-tan`
(theatre), `p-rahman` (recovery) — providers who may never speak to each
other. The handoff that carries its own evidence is the product.

## Step 3: Create the Case and Add Records

```bash
uv run periop create "Hip repair"                    # prints the case id, e.g. hip-repair
uv run periop add-document hip-repair gp-summary records/gp-summary.md
uv run periop add-document hip-repair op-plan --text "Elective right hip repair under GA."
```

Document types: `gp-summary`, `med-list`, `prior-anesthetic-record`,
`op-plan`, `other`. Files may be `.txt`, `.md`, or `.pdf`; omit the path to
paste with `--text` or pipe via stdin. Once the op plan plus at least one
record exist, the GapAnalyst runs automatically and the CLI names the next
step.

## Step 4: Review the Clarification Questions

```bash
uv run periop questions hip-repair                   # indexed, each with its why
uv run periop approve-questions hip-repair --dismiss 2
```

Approval passes the pre-op question gate. Dismissed questions are kept, never
deleted — a dismissed question that later proves relevant is itself a
finding.

## Step 5: Record and Generate, Stage by Stage

Each stage has the same shape: inputs → generate → review → sign off.

```bash
uv run periop add-audio hip-repair preop-interview interview.wav
uv run periop run hip-repair preop                   # streams per-agent progress
uv run periop show hip-repair                        # claim ledger with cited spans
uv run periop signoff hip-repair preop
```

- Audio kinds map to stages: `preop-interview`, `intraop-notes` (memos
  append — upload as many as needed), `postop-interview`. Re-uploading an
  interview requires `--confirm`.
- `run` streams the live progress events; the run itself executes inside a
  NAT `Runner`, so LLM spans land in the profiler/Langfuse exactly like a
  batch `nat run`.
- Repeat for `intraop` (as `p-tan`) and `postop` (as `p-rahman`). The
  post-op run generates both the PACU handoff and the post-anesthesia
  evaluation.

## Step 6: Acknowledge the Handoff and Verify

```bash
uv run periop ack-handoff hip-repair --provider p-rahman
uv run periop list                                   # worklist: headline status in words
uv run periop show hip-repair                        # every stage signed off
```

A complete walk ends with all three stages `signed off` and the handoff
acknowledged. In `show`'s ledger, `✗ (conflicting)` and `? (unsupported)`
claims are surfaced deliberately — report them, never hide them.

## Common Mistakes to Avoid

- **Do not fight the gates.** Stages unlock in order (pre-op → intra-op →
  post-op), require approved questions and recorded inputs, and refuse
  regeneration while an output exists. Every refusal names the next action —
  read it and do that.
- **Do not kill a streaming run.** Live NIM stages take minutes (local NIMs
  tens of minutes); progress lines are the heartbeat. Only treat a run as
  failed when the CLI prints `error:` and exits.
- **Do not write to seeded demo cases** (`sg-*`). Cases without a workflow
  block are reviewable everywhere, writable nowhere; create a new case
  instead.
- **Do not edit generated prose.** Notes are assembled from claims; review
  actions operate on claims and stages, never on text. There is no command to
  edit an artifact — that is a design guarantee, not a gap.
- **Do not enter real patient details.** Labels and records are demo
  identifiers on synthetic data only.
- **Do not run two generations at once.** The server allows one pipeline run
  at a time and 409s the second — wait for the stream to finish.
- **Do not skip the question review.** `run … preop` is gated on
  `approve-questions`; approving is one command even when nothing is
  dismissed.
