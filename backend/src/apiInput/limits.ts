/**
 * Documented input limits (specs/056 FR-045, research R9). The upload size limit stays the existing
 * `MAX_UPLOAD_BYTES` and is deliberately not made configurable here.
 */

/** Limits that can be changed through the environment. */
export interface InputLimits {
  /** `INPUT_HAR_MAX_ENTRIES`: entries a HAR may hold before it is refused. */
  harMaxEntries: number;
  /** `INPUT_MAX_BODY_BYTES`: bytes of one request or response body that are analyzed; larger bodies are skipped and reported. */
  maxBodyBytes: number;
  /** `INPUT_MAX_JSON_DEPTH`: container nesting a JSON document may have before it is refused. */
  maxJsonDepth: number;
}

export const DEFAULT_INPUT_LIMITS: Readonly<InputLimits> = Object.freeze({
  harMaxEntries: 5_000,
  maxBodyBytes: 1_048_576,
  maxJsonDepth: 128,
});

/** Fixed limits (not configurable): initial defaults fixed at planning. */
export const EMBEDDED_BODY_MAX_DEPTH = 32;
export const MAX_DERIVED_OPERATIONS = 2_000;
export const MAX_EXAMPLES_PER_OPERATION = 5;
export const MAX_PATH_PARAMETER_VALUES = 10;
export const MAX_LEAF_VALUES_PER_BODY = 500;
export const MAX_ISSUES_PER_KIND = 200;
export const MAX_EXCLUSION_SAMPLES = 20;
export const MAX_CREDENTIAL_URL_ENTRIES = 20;
/** Minimum distinct values at a wildcard path position before it becomes a path parameter (FR-013). */
export const PATH_PARAM_MIN_DISTINCT = 2;

export const INPUT_LIMIT_VARIABLES = {
  harMaxEntries: "INPUT_HAR_MAX_ENTRIES",
  maxBodyBytes: "INPUT_MAX_BODY_BYTES",
  maxJsonDepth: "INPUT_MAX_JSON_DEPTH",
} as const;

export class InvalidInputConfigurationError extends Error {
  constructor(variable: string) {
    super(`${variable} must be a positive integer when provided.`);
    this.name = "InvalidInputConfigurationError";
  }
}

function readPositiveInteger(env: NodeJS.ProcessEnv, variable: string, fallback: number): number {
  const raw = env[variable];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new InvalidInputConfigurationError(variable);
  return value;
}

/** Reads the three configurable limits from `env`, falling back to the documented defaults. */
export function loadInputLimits(env: NodeJS.ProcessEnv = process.env): InputLimits {
  return {
    harMaxEntries: readPositiveInteger(env, INPUT_LIMIT_VARIABLES.harMaxEntries, DEFAULT_INPUT_LIMITS.harMaxEntries),
    maxBodyBytes: readPositiveInteger(env, INPUT_LIMIT_VARIABLES.maxBodyBytes, DEFAULT_INPUT_LIMITS.maxBodyBytes),
    maxJsonDepth: readPositiveInteger(env, INPUT_LIMIT_VARIABLES.maxJsonDepth, DEFAULT_INPUT_LIMITS.maxJsonDepth),
  };
}
