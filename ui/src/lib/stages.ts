/** Stage tabs group the five artifacts in pipeline order (ui.md §5.3). */
import type { ArtifactRecord } from "./schema";

export const STAGES = ["Pre-op", "Intra-op", "Post-op"] as const;
export type Stage = (typeof STAGES)[number] | "Other";

const STAGE_ARTIFACTS: Record<(typeof STAGES)[number], string[]> = {
  "Pre-op": ["note:pre-anesthesia-eval"],
  "Intra-op": ["record:intra-op", "note:anticipated-issues"],
  "Post-op": ["note:pacu-handoff", "note:post-anesthesia-eval"],
};

export interface StageGroup {
  stage: Stage;
  artifacts: ArtifactRecord[];
}

/**
 * Group artifacts into pipeline-ordered stages. Unknown artifact ids collect
 * into a trailing "Other" group — never dropped. Empty stages are omitted.
 */
export function groupArtifactsByStage(artifacts: ArtifactRecord[]): StageGroup[] {
  const byId = new Map(artifacts.map((a) => [a.artifact_id, a]));
  const groups: StageGroup[] = [];
  for (const stage of STAGES) {
    const members = STAGE_ARTIFACTS[stage]
      .filter((id) => byId.has(id))
      .map((id) => byId.get(id)!);
    if (members.length) groups.push({ stage, artifacts: members });
  }
  const known = new Set(Object.values(STAGE_ARTIFACTS).flat());
  const other = artifacts.filter((a) => !known.has(a.artifact_id));
  if (other.length) groups.push({ stage: "Other", artifacts: other });
  return groups;
}
