# Attribution

PeriOp Companion **extends** the NVIDIA [ambient-provider](https://github.com/NVIDIA-AI-Blueprints/ambient-provider)
blueprint from a single-encounter transcribe-then-note tool into a stateful,
multi-stage, multi-agent longitudinal workflow with cross-stage memory and
claim-level provenance. This document records what was reused versus built.

## Reused from the blueprint (patterns / recipes)

| Component | How it is used here |
|---|---|
| Hosted NVCF speech access pattern | The `riva.client.Auth(uri="grpc.nvcf.nvidia.com:443", use_ssl=True, metadata_args=[["function-id", …], ["authorization", "Bearer …"]])` shape (see `ambient-scribe/apps/api/ambient_scribe/services/asr.py`) is the model for our Parakeet/Magpie clients. |
| Parakeet + Silero VAD + Sortformer offline ASR | Same ASR stack and `offline_recognize` + diarization config; role-mapping (provider/patient) mirrors the blueprint's speaker-tag → role step. |
| Single-`NVIDIA_API_KEY` hosted default | No GPU required; clone-and-run with one key, exactly as the blueprint's hosted profile. |
| NIM deployment recipes (stretch) | `deploy/selfhosted/` will reuse the blueprint's Parakeet/LLM NIM compose recipes. |

## Built new (everything agentic, provenance, synth data, eval)

- **Case object & provenance ledger** (`src/periop/schemas.py`): append-only
  source registry, claim-structured artifacts, `source_id#anchor` provenance,
  first-class conflict status. Notes are assembled *from* claims, so provenance
  is structural, not a post-hoc annotation.
- **Deterministic chunker** (`tools/chunker.py`): stable citable anchors, no
  embeddings/RAG.
- **Agents** (`agents/`): GapAnalyst, PreOpNoteWriter (with question→answer
  alignment), ClaimVerifier, EventExtractor (nano→super), IntraOpRecordWriter,
  IssueAnticipator (cross-stage provenance), constrained HandoffComposer,
  PostAnesthesiaEvaluator.
- **ADK orchestration + NAT wiring** (`agents/pipeline.py`, `nat/register.py`):
  stages as ADK `SequentialAgent`s with the Case in session state; the whole
  workflow registered as a NAT function (`nat run/serve/eval`).
- **Synthetic-data pipeline** (`synthgen/`): Nemotron-Personas-Singapore
  sampling → CaseDesigner (planted defects + distractors) → prior-records pack
  → scripted diarized encounters → gold claims. Resumable per-case bundles.
- **Evaluation harness** (`evals/`): provenance precision/coverage, claim
  recall vs gold, hallucinated-claim rate, gap-analysis P/R, distractor
  leakage, structured-extraction F1, clinical-term KER; LLM-judge matcher;
  nano-vs-super A/B.

## Model & data provenance

- Personas: [nvidia/Nemotron-Personas-Singapore](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Singapore)
  (CC-BY-4.0). Note: the published schema has no `healthcare_persona`/ethnicity
  fields; we stratify on age band × sex (see `docs/progress.md`).
- Models (build.nvidia.com): `nvidia/llama-3.3-nemotron-super-49b-v1.5`
  (reasoning), `nvidia/nvidia-nemotron-nano-9b-v2` (fast), Parakeet CTC 1.1B
  (ASR), Magpie TTS multilingual (synthetic audio). NVCF function IDs rotate;
  discover at runtime per the NVIDIA/skills `nemotron-speech` guidance.
