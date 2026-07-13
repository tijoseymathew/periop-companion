# Skill Card: periop-deploy

## Description
Teaches an AI agent to deploy PeriOp Companion — one process serving the
FastAPI backend and the built React review UI — via local Docker, GitHub
Codespaces / Dev Container, a Hugging Face Docker Space, or a bare local dev
run, including the stub-demo vs live hosted-NIM runtime modes and the full
`PERIOP_*` environment contract.

## Owner
Josey Mathew ([tijoseymathew](https://github.com/tijoseymathew)) —
[periop-companion](https://github.com/tijoseymathew/periop-companion).
Community skill; **not** an NVIDIA-published or NVIDIA-Verified skill.

## License / Terms of Use
Apache-2.0 (same as the repository; see `LICENSE` and `NOTICE`).

## Use Case
Developers and evaluators standing up the app to try it, demo it, or develop
against it. CPU-only; no GPU in any path.

## Deployment Geography for Use
Global. Live mode calls hosted NVIDIA NIMs on build.nvidia.com; availability
follows NVIDIA's service terms.

## Requirements / Dependencies
- **Requires API Key or External Credential:** Optional. No key → keyless stub
  demo (no network calls). Live mode needs a user-supplied `NGC_API_KEY` /
  `NVIDIA_API_KEY` (free at build.nvidia.com).
- **Credential handling:** keys stay in the user's environment or platform
  secrets; the skill instructs never to commit keys or bake them into images.
- Tools: Docker, or GitHub Codespaces, or `uv` (Python 3.12) + Node 20.

## Known Risks and Mitigations
- **Risk:** deploying with a key baked into an image or committed `.env`.
  **Mitigation:** the skill's steps and "common mistakes" explicitly forbid
  this; the HF Space path keeps the public instance keyless.
- **Risk:** agent kills a slow live run and retries, spending model quota.
  **Mitigation:** skill states live-stage latency expectations and forbids
  killing streaming runs.
- **Risk:** stale instructions if deploy scripts change.
  **Mitigation:** skill names the authoritative files
  (`docker/entrypoint.sh`, `.devcontainer/`, `docs/deploy.md`) rather than
  duplicating their logic.
- **Accepted scan finding:** SkillSpector flags `periop-companion` in the
  `docker build`/`docker run` examples as an unpinned image reference (RP1,
  MEDIUM). Accepted: it is the locally built image tag from the preceding
  `docker build -t periop-companion .`, not a registry pull — there is
  nothing to pin.

## Reference(s)
- `docs/deploy.md`, `docs/selfhosted.md`, `deploy/hf-space/DEPLOY.md`
- `Dockerfile`, `docker/entrypoint.sh`, `.devcontainer/`, `.env.example`

## Skill Output
- **Output Type(s):** shell commands, configuration instructions, verification
  steps.
- **Output Format:** Markdown with inline code blocks.

## Evaluation
- **Agents used:** claude-code (manual verification).
- **Tasks:** see `evals/evals.json` in this directory.
- **Results:** exercised manually against the repo's deploy paths; no
  NVSkills-Eval-style benchmark (that harness is NVIDIA-internal). Honest
  status: community-tested, not formally benchmarked.

## Skill Version(s)
0.1.0

## Verification
This skill directory is signed with a detached OpenSSF Model Signing bundle
(`skill.oms.sig`) produced by the repository's GitHub Actions workflow via
Sigstore keyless signing:

```bash
uvx --from model-signing model_signing verify sigstore .agents/skills/periop-deploy \
  --signature .agents/skills/periop-deploy/skill.oms.sig \
  --identity "https://github.com/tijoseymathew/periop-companion/.github/workflows/skills.yml@refs/heads/main" \
  --identity_provider https://token.actions.githubusercontent.com
```

Signing proves the released skill is the one that was scanned and reviewed;
it does not by itself prove the skill is safe.

## Ethical Considerations
PeriOp Companion is a reference/demonstration project on **synthetic data
only, no PHI** — a documentation-support tool, not a medical device and not a
clinical decision-making system. The skill forbids entering real patient
details in any deployment mode.
