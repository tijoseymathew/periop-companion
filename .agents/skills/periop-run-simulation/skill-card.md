# Skill Card: periop-run-simulation

## Description
Teaches an AI agent to generate synthetic peri-operative case bundles with the
resumable synthgen pipeline — personas → case design → records pack →
diarized interview scripts → gold labels, each case carrying exactly one
deliberate defect plus distractors — and optionally render interview audio via
self-hosted Magpie TTS.

## Owner
Josey Mathew ([tijoseymathew](https://github.com/tijoseymathew)) —
[periop-companion](https://github.com/tijoseymathew/periop-companion).
Community skill; **not** an NVIDIA-published or NVIDIA-Verified skill.

## License / Terms of Use
Apache-2.0 (same as the repository; see `LICENSE` and `NOTICE`).

## Use Case
Developers growing or regenerating the evaluable synthetic dataset in
`data/cases/`, including audio rendering for ASR evals.

## Deployment Geography for Use
Global. Case generation calls hosted NVIDIA NIMs (Super-49B) on
build.nvidia.com; TTS requires a self-hosted Magpie endpoint.

## Requirements / Dependencies
- **Requires API Key or External Credential:** **Yes** — `NGC_API_KEY` for
  case generation (live reasoning-NIM calls; there is no stub mode). Audio
  additionally requires a self-hosted `PERIOP_TTS_BASE_URL`.
- Personas source: `nvidia/Nemotron-Personas-Singapore` (pre-sampled and
  committed at `data/synthgen/personas_sample.jsonl`).

## Known Risks and Mitigations
- **Risk:** regenerating committed bundles invalidates prior eval results.
  **Mitigation:** the skill teaches `--start` extension and forbids casual
  overwrites.
- **Risk:** hand edits desync records/scripts from gold labels, silently
  corrupting metrics. **Mitigation:** explicit rule — never edit a bundle
  without updating its gold.
- **Risk:** real patient data introduced as personas. **Mitigation:** stated
  as a hard boundary; the pipeline only consumes the committed synthetic
  persona sample.
- **Risk:** unbounded model spend. **Mitigation:** resumability is explained
  (interrupted runs re-use finished pieces) and audio is marked optional.

## Reference(s)
- `docs/architecture.md` (Synthetic Generation section)
- `src/periop/synthgen/`, `scripts/generate_cases.py`,
  `scripts/render_audio.py`, `scripts/render_review.py`, `data/cases/`

## Skill Output
- **Output Type(s):** shell commands, generated case bundles on disk
  (`design.json`, `records/`, `scripts/`, `gold/gold.json`, optional
  `audio/*.wav`).
- **Output Format:** Markdown with inline code blocks; JSON/markdown/WAV
  artifacts on disk.

## Evaluation
- **Agents used:** claude-code (manual verification).
- **Tasks:** see `evals/evals.json` in this directory.
- **Results:** the committed 30-case dataset (`sg-0001`–`sg-0030`) was
  produced with this workflow. No NVSkills-Eval-style benchmark (that harness
  is NVIDIA-internal).

## Skill Version(s)
0.1.0

## Verification
Signed with a detached OpenSSF Model Signing bundle (`skill.oms.sig`) via
Sigstore keyless signing in the repository's GitHub Actions workflow:

```bash
uvx --from model-signing model_signing verify sigstore .agents/skills/periop-run-simulation \
  --signature .agents/skills/periop-run-simulation/skill.oms.sig \
  --identity "https://github.com/tijoseymathew/periop-companion/.github/workflows/skills.yml@refs/heads/main" \
  --identity_provider https://token.actions.githubusercontent.com
```

Signing proves the released skill is the one that was scanned and reviewed;
it does not by itself prove the skill is safe.

## Ethical Considerations
The entire purpose of this pipeline is to avoid real patient data: all cases
are synthetic, defects are deliberate and labeled, and no PHI exists anywhere
in the dataset. Not a medical device.
