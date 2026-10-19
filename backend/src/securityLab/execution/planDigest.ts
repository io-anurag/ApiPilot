import type { RunLimits, SecurityProfile } from "@apipilot/shared-domain";
import { hash64 } from "../canonical";

/**
 * The digest that binds the plan a person confirmed to the plan that runs (specs/057 FR-042, research R12). It
 * covers everything that decides what is sent and where: the profile as saved (hosts, ports, identities, test data,
 * limits, categories, cleanup, TLS), the target's name, tier and base URL, the ordered list of scenario versions
 * with their content hashes, and the effective limits. Change any of them between preview and start and the digest
 * differs, so the start is refused as `plan_changed` and nothing is sent. No credential value is in it: the store
 * is write-only, and a credential changing does not change what is sent or where.
 */

export interface DigestItem {
  readonly id: string;
  readonly version: number;
  readonly contentHash: string;
}

export interface DigestInput {
  readonly profile: SecurityProfile;
  readonly environment: { readonly name: string; readonly tier: string; readonly baseUrl: string };
  readonly items: readonly DigestItem[];
  readonly limits: RunLimits;
}

export function computePlanDigest(input: DigestInput): string {
  // Timestamps change on any save and decide nothing about what is sent, so they are left out of the profile snapshot.
  const profile: Partial<SecurityProfile> = { ...input.profile };
  delete profile.createdAt;
  delete profile.updatedAt;
  return hash64({ profile, environment: input.environment, items: input.items, limits: input.limits });
}
