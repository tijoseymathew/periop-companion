# Skill Card: periop-provider-workflow

## Description
Teaches an AI agent to drive the PeriOp Companion provider workflow end-to-end
from the terminal via the `periop` CLI: create a case, add prior records and
the op plan, review the GapAnalyst's questions, upload stage audio, generate
NAT-traced stage outputs, review the claim ledger with provenance, sign off,
and acknowledge the PACU handoff.

## Owner
Josey Mathew ([tijoseymathew](https://github.com/tijoseymathew)) —
[periop-companion](https://github.com/tijoseymathew/periop-companion).
Community skill; **not** an NVIDIA-published or NVIDIA-Verified skill.

## License / Terms of Use
Apache-2.0 (same as the repository; see `LICENSE` and `NOTICE`).

## Use Case
Developers and evaluators exercising the full three-provider workflow (pre-op
→ intra-op → post-op) without a browser — demos, API exercise, and
regression walks.

## Deployment Geography for Use
Global. Live mode calls hosted NVIDIA NIMs on build.nvidia.com; demo mode
(`PERIOP_STUB_RUNNER=1`) needs no network.

## Requirements / Dependencies
- **Requires API Key or External Credential:** Optional. Demo mode needs
  nothing; live mode needs `NGC_API_KEY` (or `PERIOP_*` endpoints for
  self-hosted NIMs). Optional Langfuse keys for trace export.
- Tools: `uv` (Python 3.12), the repository checkout; `ffmpeg` on the server
  for non-WAV audio uploads.

## Known Risks and Mitigations
- **Risk:** an agent fights the stage gates or edits generated prose.
  **Mitigation:** the skill documents the gates as design guarantees and
  lists both as forbidden moves.
- **Risk:** killing slow live runs and retrying, spending model quota.
  **Mitigation:** latency expectations stated; progress lines defined as the
  heartbeat.
- **Risk:** real patient details entered into a case. **Mitigation:**
  explicit synthetic-data-only rule.

## Reference(s)
- `README.md`, `docs/architecture.md`
- `src/periop/cli/`, `src/periop/api/routers/workflow.py`,
  `tests/test_cli_conformance.py`

## Skill Output
- **Output Type(s):** shell commands (`periop` CLI), workflow state changes,
  claim-ledger readouts.
- **Output Format:** Markdown with inline code blocks.

## Evaluation
- **Agents used:** claude-code (manual verification).
- **Tasks:** the skill's own six-step walk is the task; conformance tests pin
  CLI == API == batch to identical ledgers.
- **Results:** exercised as the canonical demo path; no NVSkills-Eval-style
  benchmark (that harness is NVIDIA-internal).

## Skill Version(s)
0.1.0

## Verification
Signed with a detached OpenSSF Model Signing bundle (`skill.oms.sig`) via
Sigstore keyless signing in the repository's GitHub Actions workflow:

```bash
uvx --from model-signing model_signing verify sigstore .agents/skills/periop-provider-workflow \
  --signature .agents/skills/periop-provider-workflow/skill.oms.sig \
  --identity "https://github.com/tijoseymathew/periop-companion/.github/workflows/skills.yml@refs/heads/main" \
  --identity_provider https://token.actions.githubusercontent.com
```

Signing proves the released skill is the one that was scanned and reviewed;
it does not by itself prove the skill is safe.

## Ethical Considerations
Reference/demonstration project on synthetic data only, no PHI — a
documentation-support tool, never a medical device or clinical
decision-making system. Flagged claims are surfaced deliberately; the skill
instructs agents to report them, never hide them.
