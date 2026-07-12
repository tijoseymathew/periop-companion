# Build progress — case chat & equipment advisor

Resumable checklist for building [specs/v2-agents.md](v2-agents.md) (CaseChat
+ EquipmentAdvisor). Written retrospectively: this workstream shipped before
the spec did, so every item below is checked from the start, each annotated
with what actually landed and where. Same conventions as
[progress.md](progress.md) otherwise: if a session resumes this workstream
for a follow-on change, treat the first unchecked item as the resume point.

- Python: `uv run pytest` · UI units: `cd ui && npm test` · E2E: `cd ui && npm run test:e2e`

## E1 — Equipment ledger

- [x] `feat`: fixed 21-item `CATALOG` (airway/vascular-access/regional/
      infusion/monitoring) + `EquipmentStore` reservation ledger at
      `<out_dir>/_equipment/reservations.json`, atomic writes behind one
      process-wide lock (mirrors `CaseStore`). `reserve`/`release` the only
      mutations; shortage raises rather than partially reserving.
      `tests/test_equipment.py`.

## E2 — CaseChat: read tools + streaming

- [x] `feat(chat)`: case assistant on the fast tier (`ToolChatModel` over
      the NIM's OpenAI-shaped tools interface), one `InMemoryRunner` per API
      process, one ADK session per case (multi-turn for the server's life).
      Read tools: `list_sources`, `search_case`, `read_source`.
      `GET`/`POST /api/cases/{id}/chat`, SSE (`tool_call`/`tool_result`/
      `reply`), floating panel (`CaseChatPanel.tsx`). Hermetic e2e via
      `StubChatRuntime`. `tests/test_case_chat.py`, `tests/test_chat_api.py`,
      `CaseChatPanel.test.tsx`.
- [x] `feat(chat)`: `search_case` fuzzy-matches document/transcript/claim
      text (`SequenceMatcher`-based term scoring) instead of requiring exact
      substrings.

## E3 — CaseChat: equipment ordering tools

- [x] `feat(chat)`: `list_equipment`, `reserve_equipment`,
      `release_equipment`, `case_equipment` tools, gated to the pre-op stage
      and blocked on demo/signed-off cases (ordering tools do their own
      writability check; read tools stay open on demo cases).

## E4 — EquipmentAdvisor

- [x] `feat(preop)`: tool-loop `LlmAgent` appended after `PreOpNoteWriter`
      (fast tier) — reads the op plan + fresh note, calls
      `suggest_equipment(item_id, reason)` 1-3 times against the fixed
      catalog, writes `Case.equipment_suggestions`. Regenerating pre-op
      clears prior suggestions first. `tests/test_equipment_advisor.py`.
- [x] `fix(preop)`: live-NIM finding — the shared pipeline session's ambient
      turns (the bare `"run"` kickoff, neighbouring agents' events) read as
      noise; the fast tier answered "I need the case details" and made no
      tool calls. `_before_model` now keeps only this loop's own tool
      exchange and opens with an explicit directive user turn. Verified live:
      3 grounded suggestions in ~8 s (syringe pump, LMA-4, video
      laryngoscope) on a case with propofol sedation.

## E5 — Sign-off reservation + UI

- [x] `feat(api)`: `POST /api/cases/{id}/stages/preop/signoff` accepts an
      `equipment` list; each ticked item reserved (qty 1, attributed to the
      signer) before the stage flips; already-held items skipped
      (idempotent re-signoff); a shortage rolls back this request's
      reservations and 409s.
- [x] `feat(ui)`: pre-op sign-off rail lists the advisor's suggestions
      (name, reason, unticked box per item) above the sign-off action;
      ticked `item_id`s ride the sign-off request.
- [x] `feat`: `GET /api/equipment` (read-only stock endpoint) backs a
      `StockScreen` off the worklist showing catalog-wide availability.
      `StockScreen.test.tsx`.

## Notes / decisions log

- Both agents are sidecar to the claim/provenance model on purpose: neither
  writes a `Claim` or appears in an artifact, so v1's structural-provenance
  guarantee is untouched by either addition.
- CaseChat never runs inside the pipeline's NAT session or under the run
  lock; equipment writes from chat and from sign-off serialize through the
  ledger's own lock instead.
- No spec existed for this workstream while it was being built — it grew
  out of a single `feat(chat)` commit that did both agents at once, then
  three follow-on commits. [specs/v2-agents.md](v2-agents.md) and this
  tracker were written after the fact, once the shape was stable, to bring
  the workstream in line with every other feature's spec-first record.
