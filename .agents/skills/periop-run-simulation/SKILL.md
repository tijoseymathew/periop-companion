---
name: periop-run-simulation
description: Generate synthetic peri-operative case bundles for PeriOp Companion - run the resumable synthgen pipeline (personas → case design → records pack → diarized interview scripts → gold labels) with scripts/generate_cases.py, optionally render interview audio with Magpie TTS via scripts/render_audio.py, and review bundles with scripts/render_review.py. Every case carries exactly one deliberate defect plus distractors so the pipeline is evaluable. Use when asked to create synthetic cases, simulate patients, regenerate case bundles, render case audio, or grow the eval dataset. Trigger keywords - simulation, synthetic cases, synthgen, generate cases, case bundle, personas, gold labels, TTS audio, data/cases.
license: Apache-2.0
---

# Run Simulation: Generate Synthetic Case Bundles

The synthgen pipeline (`src/periop/synthgen/`) turns seeded Singapore personas
into flawed case bundles whose **known defects make the pipeline evaluable**.
No real patients anywhere — the entire point is synthetic data. Each bundle
lands in `data/cases/sg-NNNN/` with its gold labels.

## Prerequisites

- `uv sync` completed; `NGC_API_KEY` in `.env` — **case generation is live
  reasoning-NIM work** (Super-49B) and costs real model time (several
  structured calls per case).
- Audio rendering additionally needs a **self-hosted Magpie TTS**
  (`PERIOP_TTS_BASE_URL`); there is no hosted equivalent. Skip audio unless
  you have that endpoint — bundles are useful without it.

## Step 1: Understand what one case contains

`generate_case` (`src/periop/synthgen/bundle.py`) writes, per case:

- `design.json` — surgery, ASA, comorbidities, meds, **exactly one deliberate
  defect** (`missing_allergy | stale_med_list | record_patient_conflict`) and
  ≥1 **distractor**. The flawed record pack and the truth differ *only* by the
  defect.
- `records/` — deterministic markdown with stable chunk ids (`doc:gp-summary`,
  `doc:med-list`, `doc:op-plan`, optional `doc:prior-anesthetic-record`).
- `scripts/` — diarized pre-op/post-op interview scripts (a `reveals_truth`
  gate forces the patient to say the withheld truth, retried once) and the
  intra-op voice-note bundle.
- `gold/gold.json` — the defect's `gold_question` (gap analysis must ask it),
  gold events, gold claims, and the distractor list (must **not** surface).

## Step 2: Generate cases

```bash
uv run python scripts/generate_cases.py --n 5              # cases sg-0001..sg-0005
uv run python scripts/generate_cases.py --n 5 --start 31   # extend: sg-0031..sg-0035
```

The pipeline is **resumable**: each piece (design, records, scripts, gold) is
skipped if already on disk, so a rate-limit interruption just re-runs. To
regenerate a piece deliberately, delete that file/dir in the case bundle and
re-run.

Personas are pre-sampled and committed (`data/synthgen/personas_sample.jsonl`);
re-sampling (`scripts/fetch_personas.py --per-stratum 6 --seed 42`) is rarely
needed and changes the population every downstream case draws from.

## Step 3 (optional): Render interview audio

```bash
uv run python scripts/render_audio.py sg-0031 sg-0032      # default: every case
uv run python scripts/render_audio.py --force sg-0031      # re-render existing
```

Writes `audio/*.wav` plus a gold timing manifest (used by the ASR eval) via
Magpie TTS. Requires `PERIOP_TTS_BASE_URL`; skipped-if-present like the rest.

## Step 4: Review what was generated

```bash
uv run python scripts/render_review.py sg-0031             # static HTML review per case
```

Then sanity-check the bundle by hand: the defect in `design.json` must be
absent/wrong in `records/` exactly once; the pre-op script must reveal the
truth; `gold/gold.json`'s distractors must be plausible but wrong.

## Step 5: Make the new cases count

New bundles are picked up by the eval harness automatically (every case with a
gold file is scored — see the `periop-run-evaluation` skill). Commit the whole
`data/cases/sg-NNNN/` directory; bundles are inputs, deliberately versioned.

## Common mistakes to avoid

- **Do not run without a key.** Synthgen has no stub mode — it exists to
  produce the data the stub replays. No `NGC_API_KEY` → it fails, by design.
- **Do not overwrite existing bundles casually.** `--start` past the existing
  range extends the dataset; regenerating committed cases invalidates every
  eval that scored them.
- **Do not hand-edit records or scripts without updating gold.** The gold file
  encodes the defect and distractors; a drifted bundle silently corrupts eval
  metrics.
- **Do not treat audio as required.** ASR-dependent evals need it; everything
  else (gap analysis, notes, handoff scoring) runs from scripts as text.
- **Do not point TTS at a hosted endpoint that doesn't exist.** Magpie is
  self-hosted only; leaving `PERIOP_TTS_BASE_URL` unset and skipping audio is
  the correct fallback.
- **Do not introduce real patient data as a "better" persona.** Synthetic
  personas are a hard boundary, not a quality ceiling.
