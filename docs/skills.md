# Agent skills

PeriOp Companion ships **agent skills** — portable instruction sets, per the
open [Agent Skills specification](https://agentskills.io/specification), that
teach a coding agent (Claude Code, Codex, Cursor, …) to work with this project
correctly. They follow the *verified-skills* pattern from
[NVIDIA's skill documentation](https://docs.nvidia.com/skills/): every skill is
**documented with a skill card, scanned in CI, and signed** — under this
repository's own identity (these are community skills, not NVIDIA-published or
NVIDIA-Verified skills).

## The skills

All live under [`.agents/skills/`](../.agents/skills/), one directory per
skill: `SKILL.md` (the instructions), `skill-card.md` (ownership, license,
risks, verification), `evals/evals.json` (agent-runnable acceptance tasks),
and `skill.oms.sig` (detached signature).

| Skill | Teaches an agent to | Needs a key? |
|---|---|---|
| `periop-deploy` | Stand the app up — Docker, Codespaces, HF Space, or bare local — in stub-demo or live mode | Live mode only |
| `periop-modify-backend` | Change agents, prompts, ADK composition, and API routes without breaking provenance or the CLI == API == batch contract | No (stub test loop) |
| `periop-modify-frontend` | Change the React SPA while holding its four product invariants | No |
| `periop-run-simulation` | Generate synthetic case bundles (design → records → scripts → gold), optionally with TTS audio | **Yes** |
| `periop-run-evaluation` | Run the eval harness, read metrics against their noise bands, journal results | **Yes** |
| `periop-provider-workflow` | Drive the full three-provider case workflow from the terminal via the `periop` CLI | Demo: no · Live: yes |

## Install

With the [skills CLI](https://www.skills.sh) (works for Claude Code, Codex,
Cursor, and other compatible agents):

```bash
npx skills add tijoseymathew/periop-companion                  # interactive picker
npx skills add tijoseymathew/periop-companion \
  --skill periop-deploy --agent claude-code --yes              # one skill, one agent
```

Working **inside a clone**, install them locally the same way (a local path
also works) — this sets up your agent's skill directory (e.g. `.claude/skills/`
for Claude Code, which stays git-ignored):

```bash
npx skills add . --agent claude-code                           # from the repo root
```

## Verify before you trust

Each skill directory carries a detached
[OpenSSF Model Signing](https://github.com/sigstore/model-transparency) (OMS)
bundle, produced by this repo's
[`skills.yml` workflow](../.github/workflows/skills.yml) with **Sigstore
keyless signing** — the trust anchor is the workflow identity itself, recorded
in the public Rekor transparency log:

```bash
uvx --from model-signing model_signing verify sigstore .agents/skills/periop-deploy \
  --signature .agents/skills/periop-deploy/skill.oms.sig \
  --identity "https://github.com/tijoseymathew/periop-companion/.github/workflows/skills.yml@refs/heads/main" \
  --identity_provider https://token.actions.githubusercontent.com
```

Signing proves the skill you downloaded is the one that was scanned and
reviewed; it does not by itself prove the skill is safe — read the skill card.
Every skill is also scanned in CI (see below); to scan one yourself, point
[SkillSpector](https://github.com/NVIDIA/SkillSpector) at its directory.

## The trust pipeline

On every change to `.agents/skills/**`,
[`skills.yml`](../.github/workflows/skills.yml):

1. **Scans** every skill with SkillSpector (static checks); a risk score in
   the `DO_NOT_INSTALL` band fails the build. SARIF lands in GitHub code
   scanning, markdown reports in the run's artifacts.
2. **Signs** every skill directory on `main` (after the scan passes) with
   `model_signing sign sigstore`, committing the refreshed `skill.oms.sig`
   files.

Skill cards record ownership, license, dependencies, known risks, and honest
evaluation status. The per-skill `evals/evals.json` files are agent-runnable
acceptance tasks with checkable success criteria — run them in a fresh agent
session with only that skill installed.

## Authoring a new skill

Follow the existing pattern: create `.agents/skills/<name>/` with `SKILL.md`
(frontmatter: `name`, `description` with trigger keywords, `license`),
`skill-card.md`, and `evals/evals.json`. Run `npx skills add . --agent
claude-code` to pick it up locally, and push — CI scans it and signs it on
`main`. Narrow purpose beats broad — one developer journey per skill.
