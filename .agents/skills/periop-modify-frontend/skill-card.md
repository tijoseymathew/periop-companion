# Skill Card: periop-modify-frontend

## Description
Teaches an AI agent to modify the PeriOp Companion front-end — the React 18 +
TypeScript + Vite + Tailwind SPA in `ui/` — holding its four product
invariants (one primary action, provider gates, no free-text over claims,
speech first) and verifying with vitest, the tsc build gate, and Playwright.

## Owner
Josey Mathew ([tijoseymathew](https://github.com/tijoseymathew)) —
[periop-companion](https://github.com/tijoseymathew/periop-companion).
Community skill; **not** an NVIDIA-published or NVIDIA-Verified skill.

## License / Terms of Use
Apache-2.0 (same as the repository; see `LICENSE` and `NOTICE`).

## Use Case
Developers changing UI screens/components, wiring new endpoints through the
zod-validated client layer, or restyling within the semantic token system.

## Deployment Geography for Use
Global. The front-end dev loop is fully local (stub backend, no key).

## Requirements / Dependencies
- **Requires API Key or External Credential:** No. Development runs against
  the stub backend (`PERIOP_STUB_RUNNER=1`).
- Tools: Node 20 + npm, `uv` for the backing API process.

## Known Risks and Mitigations
- **Risk:** UI edits that hide flagged claims or bypass provider gates,
  eroding the product's trust story. **Mitigation:** the four invariants are
  stated as hard rules with their enforcing modules named.
- **Risk:** silent type drift between backend pydantic models and the UI.
  **Mitigation:** the skill requires updating the zod mirror
  (`ui/src/lib/schema.ts`) with any response-shape change.
- **Risk:** unbuildable changes shipped (SPA is served from `ui/dist`).
  **Mitigation:** `npm run build` (tsc gate) is a required verification step.

## Reference(s)
- `docs/frontend.md`, `docs/architecture.md` §4
- `ui/src/app/App.tsx`, `ui/src/lib/`, `ui/tailwind.config.js`,
  `ui/playwright.config.ts`

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
uvx --from model-signing model_signing verify sigstore .agents/skills/periop-modify-frontend \
  --signature .agents/skills/periop-modify-frontend/skill.oms.sig \
  --identity "https://github.com/tijoseymathew/periop-companion/.github/workflows/skills.yml@refs/heads/main" \
  --identity_provider https://token.actions.githubusercontent.com
```

Signing proves the released skill is the one that was scanned and reviewed;
it does not by itself prove the skill is safe.

## Ethical Considerations
Reference project on synthetic data only, no PHI; not a medical device. The
UI's job is making claim provenance tangible — changes must keep flagged and
unresolved claims visible by default.
