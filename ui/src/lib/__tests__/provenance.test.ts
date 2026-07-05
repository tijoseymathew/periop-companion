import { describe, expect, it } from "vitest";
import { CaseSchema, type Case } from "../schema";
import { buildReverseIndex, parseRef, resolveRef } from "../provenance";

const kase: Case = CaseSchema.parse({
  case_id: "sg-t",
  sources: [
    {
      source_id: "doc:gp-summary",
      type: "document",
      chunks: [
        { chunk_id: "c001", text: "On aspirin 100mg daily.", section: "Medications" },
        { chunk_id: "c002", text: "Type 2 diabetes." },
      ],
    },
    {
      source_id: "audio:preop-interview",
      type: "audio",
      segments: [
        { seg_id: "s017", t0: 214.3, t1: 221.8, speaker: "PATIENT", text: "Stopped the aspirin." },
      ],
    },
  ],
  artifacts: [
    {
      artifact_id: "note:pre-anesthesia-eval",
      claims: [
        {
          claim_id: "c-001",
          text: "Aspirin discontinued.",
          provenance: ["audio:preop-interview#s017"],
          status: "supported",
        },
        {
          claim_id: "c-002",
          text: "Records list aspirin as current.",
          provenance: ["doc:gp-summary#c001", "audio:preop-interview#s017"],
          status: "conflicting",
        },
      ],
    },
    {
      artifact_id: "note:pacu-handoff",
      claims: [
        {
          claim_id: "c-101",
          text: "Aspirin held pre-op.",
          provenance: ["audio:preop-interview#s017"],
          status: "supported",
        },
        { claim_id: "c-102", text: "Orphan.", provenance: ["doc:gone#c9"] },
      ],
    },
  ],
});

describe("parseRef", () => {
  it("splits on the final # (source ids contain colons)", () => {
    expect(parseRef("audio:preop-interview#s017")).toEqual({
      sourceId: "audio:preop-interview",
      anchor: "s017",
    });
  });

  it("uses the last # when the anchor side is unambiguous", () => {
    expect(parseRef("doc:weird#name#c1")).toEqual({ sourceId: "doc:weird#name", anchor: "c1" });
  });

  it("returns null on malformed refs instead of throwing", () => {
    expect(parseRef("no-anchor")).toBeNull();
    expect(parseRef("#c1")).toBeNull();
    expect(parseRef("doc:x#")).toBeNull();
  });
});

describe("resolveRef", () => {
  it("resolves a document ref to its chunk", () => {
    const hit = resolveRef(kase, "doc:gp-summary#c001");
    expect(hit).toMatchObject({
      kind: "chunk",
      source: { source_id: "doc:gp-summary" },
      chunk: { chunk_id: "c001", section: "Medications" },
    });
  });

  it("resolves an audio ref to its segment", () => {
    const hit = resolveRef(kase, "audio:preop-interview#s017");
    expect(hit).toMatchObject({
      kind: "segment",
      source: { source_id: "audio:preop-interview" },
      segment: { seg_id: "s017", t0: 214.3, t1: 221.8 },
    });
  });

  it("returns null for unknown sources, anchors, and malformed refs", () => {
    expect(resolveRef(kase, "doc:gone#c9")).toBeNull();
    expect(resolveRef(kase, "doc:gp-summary#c999")).toBeNull();
    expect(resolveRef(kase, "garbage")).toBeNull();
  });
});

describe("buildReverseIndex", () => {
  it("maps each cited ref to every claim citing it, across artifacts", () => {
    const index = buildReverseIndex(kase);
    const citers = index.get("audio:preop-interview#s017")!;
    expect(citers.map((c) => c.claim.claim_id)).toEqual(["c-001", "c-002", "c-101"]);
    expect(citers.map((c) => c.artifactId)).toEqual([
      "note:pre-anesthesia-eval",
      "note:pre-anesthesia-eval",
      "note:pacu-handoff",
    ]);
  });

  it("keeps a segment cited by both a supported and a conflicting claim legible", () => {
    // the record-vs-patient story (v1 §3.2): one segment, two verdicts
    const statuses = buildReverseIndex(kase)
      .get("audio:preop-interview#s017")!
      .map((c) => c.claim.status);
    expect(statuses).toContain("supported");
    expect(statuses).toContain("conflicting");
  });

  it("indexes unresolvable refs too (broken provenance is a finding)", () => {
    const citers = buildReverseIndex(kase).get("doc:gone#c9")!;
    expect(citers.map((c) => c.claim.claim_id)).toEqual(["c-102"]);
  });
});
