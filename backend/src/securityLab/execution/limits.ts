import type { RunLimits, SecurityProfile } from "@apipilot/shared-domain";
import type { SecurityLabLimits } from "../config";

/**
 * Effective limits for a run (specs/057 research R11, contracts/execution-safety-rules.md section 4). A run
 * may lower any of the profile's limits for itself and may never raise one: a value above the profile's, or above
 * the configured ceiling, is refused and never clamped silently.
 */

export interface LimitProblem {
  readonly code: "limit_invalid" | "limit_above_profile";
  readonly message: string;
}

const FIELDS = ["maxRequests", "maxConcurrency", "timeoutMs"] as const;
type LimitField = (typeof FIELDS)[number];

/** Reads the optional `limits` of a run request. Anything but a positive integer is refused with the field named. */
export function parseLimitOverrides(raw: unknown): { overrides: Partial<RunLimits>; problems: LimitProblem[] } {
  const problems: LimitProblem[] = [];
  const overrides: Partial<RunLimits> = {};
  if (raw === undefined || raw === null) return { overrides, problems };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { overrides, problems: [{ code: "limit_invalid", message: "'limits' must be an object with maxRequests, maxConcurrency and timeoutMs." }] };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(FIELDS as readonly string[]).includes(key)) problems.push({ code: "limit_invalid", message: `'limits.${key}' is not a limit. Use maxRequests, maxConcurrency or timeoutMs.` });
  }
  for (const field of FIELDS) {
    const value = record[field];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      problems.push({ code: "limit_invalid", message: `'limits.${field}' must be a positive integer.` });
      continue;
    }
    overrides[field] = value;
  }
  return { overrides, problems };
}

/** The limits a run uses: each override where given, else the profile's own value. */
export function effectiveLimits(
  profile: Pick<SecurityProfile, LimitField>,
  overrides: Partial<RunLimits>,
  ceilings: SecurityLabLimits["ceilings"],
): { limits: RunLimits; problems: LimitProblem[] } {
  const problems: LimitProblem[] = [];
  const limits: RunLimits = { maxRequests: profile.maxRequests, maxConcurrency: profile.maxConcurrency, timeoutMs: profile.timeoutMs };
  for (const field of FIELDS) {
    const requested = overrides[field];
    if (requested === undefined) continue;
    const allowed = Math.min(profile[field], ceilings[field]);
    if (requested > allowed) {
      problems.push({
        code: "limit_above_profile",
        message: `'${field}' is ${requested}, above the ${allowed} this profile allows. A run can lower a limit but never raise it.`,
      });
      continue;
    }
    limits[field] = requested;
  }
  return { limits, problems };
}
