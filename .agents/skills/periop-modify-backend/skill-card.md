# Skill Card: periop-modify-backend

## Description
Teaches an AI agent to modify the PeriOp Companion backend safely: agent
prompts and schemas in `src/periop/agents/`, ADK pipeline composition in
`src/periop/adk/`, FastAPI routers in `src/periop/api/`, and NIM tier
selection — validated by the network-free pytest suite and the
CLI == API == batch conformance tests.

## Owner
Josey Mathew ([tijoseymathew](https://github.com/tijoseymathew)) —
[periop-companion](https://github.com/tijoseymathew/periop-companion).
Community skill; **not** an NVIDIA-published or NVIDIA-Verified skill.

## License / Terms of Use
Apache-2.0 (same as the repository; see `LICENSE` and `NOTICE`).

## Use Case
Developers extending or debugging the backend: changing agents/prompts, adding
pipeline steps or endpoints, tuning verification concurrency and model tiers.

## Deployment Geography for Use
Global. Live testing calls hosted NVIDIA NIMs on build.nvidia.com; the
development/test loop (`uv run pytest`, stub server) needs no network.

## Requirements / Dependencies
- **Requires API Key or External Credential:** No for the entire test loop
  (pytest + stub server are network-free). Optional `NGC_API_KEY` only for
  final live smoke runs.
- Tools: `uv` (Python 3.12), the repository checkout.

## Known Risks and Mitigations
- **Risk:** an agent's edit weakens the provenance guarantee (claims without
  resolvable citations). **Mitigation:** the skill states that
  `Case.add_artifact`'s refusal is the product and forbids weakening it.
- **Risk:** entry points diverge (CLI ≠ API ≠ batch). **Mitigation:** the
  skill requires the conformance tests and directs fixes to the shared
  `adk/runtime.py` seam.
- **Risk:** expensive live testing before cheap validation. **Mitigation:**
  stub-first test ladder is explicit.

## Reference(s)
- `docs/architecture.md`, `docs/adk-orchestration.md`
- `src/periop/adk/`, `src/periop/agents/`, `src/periop/api/`,
  `src/periop/schemas.py`, `tests/test_lifecycle_conformance.py`

## Skill Output
- **Output Type(s):** code edits, shell commands, test invocations.
- **Output Format:** Markdown with inline code blocks.

## Evaluation
- **Agents used:** claude-code (manual verification).
- **Tasks:** see `evals/evals.json` in this directory.
- **Results:** exercised manually; no NVSkills-Eval-style benchmark (that
  harness is NVIDIA-internal). Honest status: community-tested, not formally
  benchmarked.

## Skill Version(s)
0.1.0

## Verification
Signed with a detached OpenSSF Model Signing bundle (`skill.oms.sig`) via
Sigstore keyless signing in the repository's GitHub Actions workflow:

```bash
uvx --from model-signing model_signing verify sigstore .agents/skills/periop-modify-backend \
  --signature .agents/skills/periop-modify-backend/skill.oms.sig \
  --identity "https://github.com/tijoseymathew/periop-companion/.github/workflows/skills.yml@refs/heads/main" \
  --identity_provider https://token.actions.githubusercontent.com
```

Signing proves the released skill is the one that was scanned and reviewed;
it does not by itself prove the skill is safe.

## Ethical Considerations
Reference project on synthetic data only, no PHI; not a medical device.
Backend changes must preserve the claim-level provenance guarantees that make
generated documentation auditable.
