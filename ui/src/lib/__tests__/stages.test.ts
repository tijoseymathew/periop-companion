import { describe, expect, it } from "vitest";
import { groupArtifactsByStage, STAGES } from "../stages";
import type { ArtifactRecord } from "../schema";

const artifact = (artifact_id: string): ArtifactRecord => ({ artifact_id, claims: [] });

describe("groupArtifactsByStage", () => {
  it("groups the five pipeline artifacts in stage order (ui.md §5.3)", () => {
    // deliberately shuffled input: grouping must impose pipeline order
    const groups = groupArtifactsByStage([
      artifact("note:post-anesthesia-eval"),
      artifact("note:pacu-handoff"),
      artifact("note:pre-anesthesia-eval"),
      artifact("note:anticipated-issues"),
      artifact("record:intra-op"),
    ]);
    expect(groups.map((g) => g.stage)).toEqual(["Pre-op", "Intra-op", "Post-op"]);
    expect(groups[0].artifacts.map((a) => a.artifact_id)).toEqual(["note:pre-anesthesia-eval"]);
    expect(groups[1].artifacts.map((a) => a.artifact_id)).toEqual([
      "record:intra-op",
      "note:anticipated-issues",
    ]);
    expect(groups[2].artifacts.map((a) => a.artifact_id)).toEqual([
      "note:pacu-handoff",
      "note:post-anesthesia-eval",
    ]);
  });

  it("collects unknown artifact ids into an Other group rather than dropping them", () => {
    const groups = groupArtifactsByStage([
      artifact("note:pre-anesthesia-eval"),
      artifact("note:surprise"),
    ]);
    const other = groups.find((g) => g.stage === "Other")!;
    expect(other.artifacts.map((a) => a.artifact_id)).toEqual(["note:surprise"]);
  });

  it("omits empty stages so tabs never render blank", () => {
    const groups = groupArtifactsByStage([artifact("note:pacu-handoff")]);
    expect(groups.map((g) => g.stage)).toEqual(["Post-op"]);
  });

  it("exposes the stage vocabulary for tab rendering", () => {
    expect(STAGES).toEqual(["Pre-op", "Intra-op", "Post-op"]);
  });
});
