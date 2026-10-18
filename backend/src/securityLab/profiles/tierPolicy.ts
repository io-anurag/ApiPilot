import type { EnvironmentTier } from "@apipilot/shared-domain";

/**
 * What each environment tier permits (specs/057 contracts/execution-safety-rules.md section 3). The tier is a
 * property of the target environment, never of a scenario or of model output. Every rule that varies by tier
 * reads this module, so the profile validator, the destination policy and the run preview agree.
 */

export type TierKind = "local" | "staging-like" | "refused";

export function tierKind(tier: EnvironmentTier): TierKind {
  if (tier === "local") return "local";
  if (tier === "production") return "refused";
  return "staging-like";
}

/** Production is never a target: it is refused when a profile is saved and again when one is used. */
export function isProductionTier(tier: EnvironmentTier): boolean {
  return tier === "production";
}

/** Only a local profile may name loopback, private or other non-public addresses. */
export function allowsRestrictedAddresses(tier: EnvironmentTier): boolean {
  return tier === "local";
}

/** Only a local profile may relax TLS certificate verification. */
export function allowsRelaxedTls(tier: EnvironmentTier): boolean {
  return tier === "local";
}

/** A staging-like run is confirmed by the exact target name and base URL as well as the digest. */
export function requiresTargetRetype(tier: EnvironmentTier): boolean {
  return tierKind(tier) === "staging-like";
}

/** Destructive scenarios need the profile flag and a per-scenario confirmation on every permitted tier, at approval and at run. */
export function mayPermitDestructive(tier: EnvironmentTier): boolean {
  return tier !== "production";
}
