/**
 * Claim-status visibility filters (ui.md §5.2). The default shows everything:
 * unsupported and conflicting claims are never filtered out by default — an
 * explicit user toggle is the only way to hide them (v1 §4.3 invariant).
 */
import { CLAIM_STATUSES, type ClaimStatus } from "./schema";

export type StatusFilters = Record<ClaimStatus, boolean>;

export function defaultFilters(): StatusFilters {
  return Object.fromEntries(CLAIM_STATUSES.map((s) => [s, true])) as StatusFilters;
}
