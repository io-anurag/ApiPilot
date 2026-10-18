/**
 * Security Lab limits (specs/057 research R11 and R13). The ceilings are what no profile may exceed; the
 * defaults apply when a profile leaves a value unset. Ceilings and retention caps are read from the
 * environment and validated at startup, like `validateAIConfiguration`, so a bad value stops the backend
 * with a message naming the variable instead of being ignored.
 */

export interface SecurityLabLimits {
  ceilings: {
    /** `SECURITY_LAB_MAX_REQUESTS_CEILING`: most requests a run may send, cleanup included. */
    maxRequests: number;
    /** `SECURITY_LAB_MAX_CONCURRENCY_CEILING`: most requests in flight at once. */
    maxConcurrency: number;
    /** `SECURITY_LAB_TIMEOUT_MS_CEILING`: longest per-request timeout, in milliseconds. */
    timeoutMs: number;
    /** `SECURITY_LAB_MAX_REPEAT_CEILING`: most repetitions of one request in a scenario. */
    maxRepeat: number;
  };
  retention: {
    /** `SECURITY_LAB_MAX_RETAINED_SCENARIOS`: scenario rows kept per owner. */
    maxScenarios: number;
    /** `SECURITY_LAB_MAX_RETAINED_RUNS`: run records kept per owner. */
    maxRuns: number;
  };
}

/** Applied when a profile does not set a value. Fixed, not configurable. */
export const PROFILE_DEFAULTS = Object.freeze({ maxRequests: 100, maxConcurrency: 1, timeoutMs: 10_000 });

/** Fixed, not configurable (research R11). */
export const MAX_REDIRECT_HOPS = 3;
export const RESPONSE_READ_CAP_BYTES = 256 * 1024;
export const EVIDENCE_BODY_EXCERPT_BYTES = 4 * 1024;
/** The scenario schema's own upper bound for `request.repeat.count` and `plannedRequestCount`. */
export const ABSOLUTE_MAX_REPEAT = 50;
/** The margin added to a documented or configured rate-limit threshold when generating a repeat scenario. */
export const REPEAT_MARGIN_RATIO = 0.2;
export const REPEAT_MIN_COUNT = 5;

export const SECURITY_LAB_VARIABLES = {
  maxRequests: "SECURITY_LAB_MAX_REQUESTS_CEILING",
  maxConcurrency: "SECURITY_LAB_MAX_CONCURRENCY_CEILING",
  timeoutMs: "SECURITY_LAB_TIMEOUT_MS_CEILING",
  maxRepeat: "SECURITY_LAB_MAX_REPEAT_CEILING",
  maxScenarios: "SECURITY_LAB_MAX_RETAINED_SCENARIOS",
  maxRuns: "SECURITY_LAB_MAX_RETAINED_RUNS",
} as const;

interface Bounds {
  fallback: number;
  min: number;
  max: number;
}

const BOUNDS: Record<keyof typeof SECURITY_LAB_VARIABLES, Bounds> = {
  maxRequests: { fallback: 500, min: 1, max: 5_000 },
  maxConcurrency: { fallback: 4, min: 1, max: 16 },
  timeoutMs: { fallback: 30_000, min: 1_000, max: 120_000 },
  maxRepeat: { fallback: ABSOLUTE_MAX_REPEAT, min: 2, max: ABSOLUTE_MAX_REPEAT },
  maxScenarios: { fallback: 20_000, min: 100, max: 1_000_000 },
  maxRuns: { fallback: 500, min: 1, max: 100_000 },
};

export class InvalidSecurityLabConfigurationError extends Error {
  constructor(
    public readonly variable: string,
    bounds: Bounds,
  ) {
    super(`${variable} must be an integer between ${bounds.min} and ${bounds.max} when provided.`);
    this.name = "InvalidSecurityLabConfigurationError";
  }
}

function read(env: NodeJS.ProcessEnv, key: keyof typeof SECURITY_LAB_VARIABLES): number {
  const variable = SECURITY_LAB_VARIABLES[key];
  const bounds = BOUNDS[key];
  const raw = env[variable];
  if (raw === undefined || raw.trim() === "") return bounds.fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new InvalidSecurityLabConfigurationError(variable, bounds);
  }
  return value;
}

/** Reads the ceilings and retention caps from `env`, falling back to the documented defaults. */
export function loadSecurityLabLimits(env: NodeJS.ProcessEnv = process.env): SecurityLabLimits {
  return {
    ceilings: {
      maxRequests: read(env, "maxRequests"),
      maxConcurrency: read(env, "maxConcurrency"),
      timeoutMs: read(env, "timeoutMs"),
      maxRepeat: read(env, "maxRepeat"),
    },
    retention: {
      maxScenarios: read(env, "maxScenarios"),
      maxRuns: read(env, "maxRuns"),
    },
  };
}

/** Fails fast at startup when a Security Lab variable is set to an unusable value. */
export function validateSecurityLabConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  loadSecurityLabLimits(env);
}
