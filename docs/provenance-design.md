# Provenance & explainability design

Every claim in every generated note carries provenance to a source record
chunk or a timestamped, diarized audio segment. Provenance is **structural**:
notes are stored as sets of claims and the rendered document is assembled from
them, so a claim cannot exist without its citation.

## The chain

```
document / audio  →  Source (append-only registry)
                        chunks: {chunk_id, text, section}
                        segments: {seg_id, t0, t1, speaker, text}
                              │
                              ▼  cited by  source_id#anchor
                        Claim {claim_id, text, provenance[], status}
                              │
                              ▼  grouped into
                        ArtifactRecord (note / record / handoff)
```

A `ProvenanceRef` is the string `source_id#anchor` (e.g.
`audio:preop-interview#s017`). Audio anchors resolve to a segment carrying
`(t0, t1, speaker)` so the UI/CLI can play the exact clip.

## Five guarantees

1. **Claim decomposition** — each writer agent emits its note as atomic claims
   (structured output), not prose it later annotates.
2. **Citation validity at write time** — `Case.add_artifact` refuses any claim
   whose provenance does not resolve to a registered anchor; writer agents drop
   dangling-citation claims before committing. A hallucinated citation never
   reaches an artifact.
3. **Independent verification** — `ClaimVerifier` (fast model, NLI-style)
   re-checks each claim against *only* its cited spans → `supported /
   unsupported / conflicting`. Unsupported/conflicting claims are flagged in
   place, **never dropped** — the reviewer sees them.
4. **Conflicts are first-class** — when records say X and the interview says Y,
   the note states the interview truth, cites it, and the stale record value is
   not silently kept. The gap analysis surfaces the conflict as a question.
5. **Composition, not generation, for the handoff** — the `HandoffComposer`
   may only select, order, and lightly rephrase existing claims; each handoff
   item references source claims by global id (`artifact_id#claim_id`) and
   **inherits** their provenance. An item citing no existing claim is dropped.
   This bounds hallucination in the highest-stakes artifact by construction.

## Process provenance

Beyond content provenance, NAT OTel traces record which agent, prompt, and
model produced each artifact — provenance for the *process*, complementing
provenance for the *content*. ADK owns orchestration; NAT owns observability
and evaluation, so every LLM/tool call lands in the profiler and exporters.

## What this buys the evaluation

- **Provenance precision**: of cited claims, the fraction the verifier entails.
- **Provenance coverage**: fraction of claims carrying ≥1 valid citation.
- **Hallucinated-claim rate**: uncited or unsupported/conflicting claims —
  ~0 for the HandoffComposer by construction.
