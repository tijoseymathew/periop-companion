import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CaseSchema, CaseSummarySchema } from "../schema";

// The real committed pipeline output is the contract: zod must accept it
// verbatim (ui.md §10). vitest runs with cwd = ui/, so the repo root is one up.
const sg0002 = JSON.parse(
  readFileSync(resolve(process.cwd(), "../data/cases/_out/sg-0002.json"), "utf-8"),
);

describe("CaseSchema", () => {
  it("accepts the committed sg-0002 pipeline output", () => {
    const kase = CaseSchema.parse(sg0002);
    expect(kase.case_id).toBe("sg-0002");
    expect(kase.artifacts).toHaveLength(5);
    expect(kase.sources.length).toBeGreaterThanOrEqual(7);
    expect(kase.intraop_events.length).toBeGreaterThan(0);
  });

  it("mirrors periop.schemas field names exactly", () => {
    const kase = CaseSchema.parse(sg0002);
    const audio = kase.sources.find((s) => s.type === "audio")!;
    expect(audio.segments[0]).toMatchObject({
      seg_id: expect.any(String),
      t0: expect.any(Number),
      t1: expect.any(Number),
      speaker: expect.any(String),
      text: expect.any(String),
    });
    const doc = kase.sources.find((s) => s.type === "document")!;
    expect(doc.chunks[0].chunk_id).toEqual(expect.any(String));
    const claim = kase.artifacts[0].claims[0];
    expect(claim.claim_id).toEqual(expect.any(String));
    expect(claim.provenance[0]).toEqual(expect.any(String));
  });

  it("defaults optional collections and status like the pydantic model", () => {
    const kase = CaseSchema.parse({
      case_id: "sg-x",
      artifacts: [{ artifact_id: "note:x", claims: [{ claim_id: "c-1", text: "t" }] }],
    });
    expect(kase.sources).toEqual([]);
    expect(kase.open_questions).toEqual([]);
    expect(kase.artifacts[0].claims[0].status).toBe("unverified");
    expect(kase.artifacts[0].claims[0].provenance).toEqual([]);
  });

  it("rejects unknown claim statuses", () => {
    expect(() =>
      CaseSchema.parse({
        case_id: "sg-x",
        artifacts: [
          { artifact_id: "note:x", claims: [{ claim_id: "c", text: "t", status: "maybe" }] },
        ],
      }),
    ).toThrow();
  });
});

describe("CaseSummarySchema", () => {
  it("accepts the /api/cases summary shape", () => {
    const summary = CaseSummarySchema.parse({
      case_id: "sg-0002",
      artifact_count: 5,
      claim_count: 82,
      status_counts: { supported: 60, unsupported: 20, conflicting: 2, inference: 0, unverified: 0 },
      has_audio: true,
    });
    expect(summary.status_counts.supported).toBe(60);
  });
});
