# Skill Card: periop-run-evaluation

## Description
Teaches an AI agent to evaluate the PeriOp Companion pipeline against gold
labels — run the resumable `scripts/run_eval.py` harness, interpret the metric
suite (gap recall, provenance coverage/precision, hallucination rate, claim
recall, distractor leakage, extraction F1) with its documented noise bands,
journal results in `evals/README.md`, and run the NAT-native evaluator,
profiler, and targeted A/B scripts.

## Owner
Josey Mathew ([tijoseymathew](https://github.com/tijoseymathew)) —
[periop-companion](https://github.com/tijoseymathew/periop-companion).
Community skill; **not** an NVIDIA-published or NVIDIA-Verified skill.

## License / Terms of Use
Apache-2.0 (same as the repository; see `LICENSE` and `NOTICE`).

## Use Case
Developers scoring a pipeline change, reproducing the committed benchmark, or
profiling latency bottlenecks.

## Deployment Geography for Use
Global. Runs the live pipeline against hosted NVIDIA NIMs on build.nvidia.com.

## Requirements / Dependencies
- **Requires API Key or External Credential:** **Yes** — `NGC_API_KEY`; the
  eval runs the live pipeline (Super-49B + Nano-9B). There is no stub eval.
- Case bundles with gold labels in `data/cases/` (committed; extend via the
  `periop-run-simulation` skill). ASR A/B additionally needs rendered audio.

## Known Risks and Mitigations
- **Risk:** reading judge-metric noise as signal (per-case swings ±0.3–0.5).
  **Mitigation:** the skill points to the journal's noise bands and requires
  aggregate + direction-count reads.
- **Risk:** `--rerun` used for re-scoring, wasting hours of model time.
  **Mitigation:** cache semantics are explained; `--rerun` is reserved for
  pipeline changes.
- **Risk:** known IssueAnticipator structured-output flake (~1-in-6 cases)
  read as a regression. **Mitigation:** documented with its retry remedy.
- **Risk:** unjournaled result overwrites the committed benchmark.
  **Mitigation:** journaling in `evals/README.md` is a required step.

## Reference(s)
- `evals/README.md` (the eval journal), `evals/report.json`
- `src/periop/evals/`, `scripts/run_eval.py`, `scripts/measure_gap_catch.py`,
  `scripts/measure_extraction_ab.py`, `scripts/eval_asr.py`
- `configs/eval_config.yml`, `configs/profile_config.yml`

## Skill Output
- **Output Type(s):** shell commands, `evals/report.json`, journal entries
  with metric tables.
- **Output Format:** Markdown with inline code blocks; JSON report on disk.

## Evaluation
- **Agents used:** claude-code (manual verification).
- **Tasks:** see `evals/evals.json` in this directory.
- **Results:** the committed `evals/report.json` (30-case, 2026-07-13
  resample; gap_recall 0.900) was produced with this workflow. No
  NVSkills-Eval-style benchmark (that harness is NVIDIA-internal).

## Skill Version(s)
0.1.0

## Verification
Signed with a detached OpenSSF Model Signing bundle (`skill.oms.sig`) via
Sigstore keyless signing in the repository's GitHub Actions workflow:

```bash
uvx --from model-signing model_signing verify sigstore .agents/skills/periop-run-evaluation \
  --signature .agents/skills/periop-run-evaluation/skill.oms.sig \
  --identity "https://github.com/tijoseymathew/periop-companion/.github/workflows/skills.yml@refs/heads/main" \
  --identity_provider https://token.actions.githubusercontent.com
```

Signing proves the released skill is the one that was scanned and reviewed;
it does not by itself prove the skill is safe.

## Ethical Considerations
Evaluation is what makes the provenance claims of this reference project
honest: metrics are reported with their noise bands, flagged failure modes
are documented rather than hidden, and all scoring runs on synthetic data
only. Not a medical device.
