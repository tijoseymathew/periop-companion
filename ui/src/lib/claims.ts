/**
 * Shared claim-flagging vocabulary (brief §3, §4.7). A claim is "flagged" —
 * it needs a human's eyes before sign-off — when its verification status is
 * shaky OR its source link is broken. Kept in one place so the ledger, the
 * sign-off checkpoint, and the stepper conflict banner all agree.
 */
import type { Claim, ClaimStatus } from "./schema";

/** Statuses that demand review; supported/inference do not. */
export const FLAGGED_STATUSES: ClaimStatus[] = ["conflicting", "unsupported", "unverified"];

/** Cited nowhere — the "unresolved source" flag that must never hide (brief §3). */
export function claimUnresolved(claim: Claim): boolean {
  return claim.provenance.length === 0;
}

export function claimFlagged(claim: Claim): boolean {
  return FLAGGED_STATUSES.includes(claim.status) || claimUnresolved(claim);
}

/** Every claim across a case's artifacts, flattened (order preserved). */
export function allClaims(claims: { claims: Claim[] }[]): Claim[] {
  return claims.flatMap((a) => a.claims);
}
