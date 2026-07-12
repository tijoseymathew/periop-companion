# PeriOp Companion — Case Chat & Equipment Advisor Specification

**Two agents beyond the three-stage pipeline: a CaseChat assistant a provider can ask questions of over the case record, and an EquipmentAdvisor that suggests theatre equipment while writing the pre-op note — both fast-tier tool-calling `LlmAgent`s, both grounded only in what's already on the `Case`.**

Version: 0.1 (retrospective)
Status: Companion to [specs/v2.md](v2.md) (case lifecycle, write API) and [specs/ui.md](ui.md) (review UI). Written after the fact — every milestone below shipped in commits already on this branch before this document existed; it is kept in `specs/` for the same reason every other feature here has one: so the design rationale outlives the diff. Supersedes neither: the pipeline agents, write API, and review UI are unchanged; this spec documents two additions alongside them.
Framing unchanged: reference/demonstration project, synthetic data only, no PHI, not a medical device.

---

## 1. Why these two agents

The pipeline (v1) answers "what happened" through generated, cited notes. Two gaps that structure doesn't cover:

1. **A provider has an ad-hoc question mid-case** — "did the interview mention a penicillin allergy?", "what was the induction dose?" — that doesn't warrant regenerating a stage or reading the whole record. The claim ledger is the review surface, not a query interface.
2. **Pre-op is also when a provider mentally plans equipment** (airway backup, regional kit, monitoring) based on the case's specifics, and today nothing in the tool surfaces that thinking or records what was picked, so pre-op "readiness" ends at the note.

Both are answered by fast-tier (Nano-9B) tool-calling agents rather than a pipeline stage: neither produces a cited claim in an artifact, both are optional to a provider's workflow (the pipeline runs identically with zero chat turns and zero equipment suggestions), and both need to reach outside the artifact-claim model — CaseChat answers from live search over sources, EquipmentAdvisor recommends against a fixed store, not a `Source`.

## 2. Scope

### In scope
- CaseChat: multi-turn, per-case, SSE-streamed assistant with read tools over sources/notes and (pre-op only) equipment-ordering tools.
- EquipmentAdvisor: a tool-loop step appended to pre-op note generation that suggests 1–3 theatre-store items with a case-grounded reason.
- The equipment ledger: a fixed in-code catalog plus a per-out-dir reservation ledger, shared by both agents and the sign-off flow.
- Sign-off UI surfacing suggestions as tickboxes; the API reserving ticked items as the pre-op stage completes.
- A stock screen off the worklist showing catalog-wide availability.

### Out of scope
- CaseChat writing to the note/claim ledger, or answering with anything not traceable to a search/read tool call (no free-standing clinical advice — the system instruction says so explicitly, spec §3.2).
- Equipment ordering outside pre-op (both the advisor and CaseChat's write tools are gated to the pre-op stage — a case past pre-op sign-off has already reserved what it needed).
- Cross-case equipment planning (surgical scheduling, shared inventory across multiple concurrent cases beyond the reservation ledger's simple subtract-on-reserve).

## 3. Design

### 3.1 The equipment ledger (`src/periop/equipment.py`)

A fixed `CATALOG` (21 items across airway/vascular-access/regional/infusion/monitoring, small quantities on purpose so "out of stock" is reachable in a demo) and an `EquipmentStore` that persists only the reservation ledger — `<out_dir>/_equipment/reservations.json`, atomic writes (temp file + `os.replace`) behind one process-wide lock, mirroring `CaseStore`'s own discipline so the two never race each other. `reserve`/`release` are the only mutations; `stock_levels`/`case_reservations` are the reads both the API and the agents call through.

### 3.2 CaseChat (`src/periop/agents/case_chat.py`)

One `LlmAgent` (fast tier, `ToolChatModel` carrying the ADK tool loop over the NIM's OpenAI-shaped tools interface), one long-lived `InMemoryRunner` per API process, one ADK session per case (`session_id = case_id`) so a conversation is multi-turn for the life of the server. Tools are closures over the runtime so every call resolves the case and equipment ledger fresh from disk — the chatbot always sees what the rest of the API serves, never a stale in-memory copy.

Tools:
- **Read** (always available): `list_sources`, `search_case` (fuzzy match over chunk/segment/claim text — `SequenceMatcher`-based term scoring, not embeddings), `read_source` (whole document or transcript).
- **Equipment** (pre-op only, blocked on demo cases and cases already past pre-op): `list_equipment`, `reserve_equipment`, `release_equipment`, `case_equipment`.

The system instruction requires searching before answering ("never claim the record lacks something you haven't looked for") and forbids treatment recommendations — this is a documentation aid answering from the record, not a clinical decision system, same posture as the pipeline notes. Capped at `MAX_LLM_CALLS_PER_TURN = 12` so a confused tool loop can't spin forever.

`GET/POST /api/cases/{id}/chat` (`api/routers/chat.py`) streams turn-by-turn over SSE into a floating panel on the case view (`ui/src/components/chat/CaseChatPanel.tsx`); hermetic e2e gets a scripted `StubChatRuntime` so Playwright never hits a live NIM.

### 3.3 EquipmentAdvisor (`src/periop/agents/equipment_advisor.py`)

A second `LlmAgent` (fast tier, same `ToolChatModel`) appended after the `PreOpNoteWriter` step (v1 spec §3.3 step 5): it reads the op plan and the just-written note, and calls `suggest_equipment(item_id, reason)` — one call per item, 1–3 items, each `item_id` validated against the fixed catalog — writing to `Case.equipment_suggestions`. A regenerated pre-op clears prior suggestions first (stale suggestions would otherwise pin the cap across eras). Suggestions only: nothing is reserved until the provider ticks boxes at sign-off.

One live-NIM lesson worth keeping visible: the advisor's first version answered the pipeline session's bare `"run"` kickoff turn with "I need the case details" and made no tool calls — the shared ADK session carries the neighbouring agents' turns as context, which reads as noise to a fresh instruction. The fix (`_before_model`) keeps only this loop's own tool exchange and opens with an explicit directive user turn instead of trusting the session's ambient state.

### 3.4 Sign-off reserves the ticked items

`POST /api/cases/{id}/stages/preop/signoff` (pre-op only) accepts an equipment list alongside the usual sign-off body; each ticked `item_id` is reserved (qty 1, attributed to the signing provider) through the ledger before the stage flips to signed-off. Items the case already holds are skipped (idempotent re-signoff); a shortage rolls back this request's reservations and 409s so the provider can untick and retry — sign-off is all-or-nothing on equipment, never a partial hold. The pre-op rail (`ui/src/components/equipment/`) lists the advisor's suggestions above the sign-off action — name, reason, an unticked box per item — and a separate `StockScreen` off the worklist shows catalog-wide availability (`GET /api/equipment`).

## 4. What this changes for the pipeline — and what it must not

- The pipeline's claim/provenance model is untouched: neither agent writes a `Claim`, cites a `ProvenanceRef`, or appears in an artifact. `equipment_suggestions` and the reservation ledger are sidecar state, same posture as the review sidecar (v2 §3, `_out/<case_id>.review.json`).
- Pre-op note generation gains one more Nano-9B call (the advisor) after the existing writer/verifier chain — additive latency, not on the reasoning tier, so it doesn't move the v2-speed §1 bottleneck story.
- CaseChat never runs inside the pipeline's NAT session or under the run lock — it's a standalone assistant, not a stage, and multiple chat turns can interleave with a stage run without contention (equipment writes still serialize through the ledger's own lock).

## 5. Testing

- `tests/test_equipment.py` — ledger reserve/release, atomic writes, shortage/rollback.
- `tests/test_equipment_advisor.py` — tool validation (unknown item_id, cap enforcement), suggestion state, the clear-on-regenerate behavior.
- `tests/test_case_chat.py` — search/read tools against a fixture case, equipment tools' pre-op gate, the `MAX_LLM_CALLS_PER_TURN` ceiling.
- `tests/test_chat_api.py` — the SSE endpoint against `StubChatRuntime`.
- `ui/src/components/__tests__/CaseChatPanel.test.tsx`, `StockScreen.test.tsx` — vitest component coverage.
- Playwright e2e (existing suites) exercises the sign-off tickbox flow against the stub pipeline runner.

## 6. Milestones

Lettered independently of the `W`/`C`/`U` sequences — these agents sit beside the pipeline and CLI, not inside either.

| # | Milestone | Exit criterion |
|---|---|---|
| E1 | Equipment ledger: fixed catalog + reservation store | `tests/test_equipment.py` green; reserve/release atomic under concurrent writers |
| E2 | CaseChat: read tools (`list_sources`/`search_case`/`read_source`), SSE endpoint, floating panel | A provider question about the record gets a grounded, cited-in-prose answer; hermetic e2e via `StubChatRuntime` |
| E3 | CaseChat: equipment tools gated to pre-op | Ordering blocked outside pre-op and on demo cases; `case_equipment` reflects the ledger |
| E4 | EquipmentAdvisor: tool loop on the pre-op note step | Live NIM run yields 1–3 grounded suggestions in single-digit seconds; regenerate clears prior suggestions |
| E5 | Sign-off reserves ticked equipment; pre-op rail tickboxes; stock screen | Ticking and signing off reserves for real; a shortage 409s and rolls back; `GET /api/equipment` backs the stock screen |

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| A shared ADK session's ambient turns confuse a freshly-instructed tool agent (observed live, §3.3) | `_before_model` strips everything but this loop's own tool exchange and opens with an explicit directive turn — pinned by the E4 live-run note above, not just a unit test |
| CaseChat search misses relevant text (fuzzy match, not embeddings) | The instruction requires a second search with different words before giving up; scope is a demo-scale per-case record (tens of chunks/segments), not a corpus, so recall at this scale is a smaller risk than at production scale |
| Equipment double-reservation under concurrent sign-off requests or chat orders | Both paths go through the same `EquipmentStore` process-wide lock; a shortage on either path rolls back cleanly rather than partially reserving |
| A chat turn spins on tool calls | Hard ceiling `MAX_LLM_CALLS_PER_TURN = 12` |
| Equipment/chat sidecar state drifts from the pipeline-written case JSON | Both live outside `Case` proper (`equipment_suggestions` is the one exception, cleared and rewritten per pre-op run, never read by verification) — same non-interference posture as the review sidecar (v2 §3) |
