/**
 * Typed Security Lab errors (specs/057-security-lab-v1, contracts/security-lab-api.md "Typed error
 * codes"). The router maps one of these to `{ error, message, ...details }` with the status below. A
 * message is written for the engineer: no stack, path, secret or internal detail (CLAUDE.md §24).
 */

export const SECURITY_LAB_ERROR_STATUS = {
  no_specification: 409,
  invalid_request: 400,
  category_not_generatable: 400,
  scenario_not_found: 404,
  stale_version: 409,
  scenario_invalid: 422,
  scenario_rejected: 409,
  invalid_transition: 409,
  destructive_confirmation_required: 409,
  not_executable_content: 409,
  profile_not_found: 404,
  profile_invalid: 422,
  profile_in_use: 409,
  run_plan_invalid: 422,
  plan_changed: 409,
  confirmation_required: 409,
  execution_in_progress: 409,
  no_run_in_progress: 409,
  run_not_found: 404,
  finding_not_found: 404,
  invalid_finding_update: 422,
  ai_unavailable: 503,
  nothing_to_report: 409,
  no_approved_scenarios: 409,
  export_failed: 422,
  retention_limit_reached: 409,
  assessment_not_found: 404,
  confirmation_mismatch: 422,
  environment_not_found: 404,
  duplicate_environment_name: 409,
} as const;

export type SecurityLabErrorCode = keyof typeof SECURITY_LAB_ERROR_STATUS;

export class SecurityLabError extends Error {
  readonly statusCode: number;

  constructor(
    public readonly code: SecurityLabErrorCode,
    message: string,
    /** Extra, safe, JSON-serialisable fields merged into the response body. */
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SecurityLabError";
    this.statusCode = SECURITY_LAB_ERROR_STATUS[code];
  }

  /** The response body for this error. `error` and `message` always win over a same-named detail. */
  toBody(): Record<string, unknown> {
    return { ...this.details, error: this.code, message: this.message };
  }
}

export function isSecurityLabError(value: unknown): value is SecurityLabError {
  return value instanceof SecurityLabError;
}

export function noSpecification(): SecurityLabError {
  return new SecurityLabError(
    "no_specification",
    "No specification is loaded. Upload one in the Guided Workflow to analyze, generate or run.",
  );
}

export function invalidRequest(message: string, details: Record<string, unknown> = {}): SecurityLabError {
  return new SecurityLabError("invalid_request", message, details);
}

export function scenarioNotFound(id: string): SecurityLabError {
  return new SecurityLabError("scenario_not_found", `No security scenario with id '${id}' was found.`);
}

export function profileNotFound(id: string): SecurityLabError {
  return new SecurityLabError("profile_not_found", `No security profile with id '${id}' was found.`);
}

export function runNotFound(id: string): SecurityLabError {
  return new SecurityLabError("run_not_found", `No security run with id '${id}' was found.`);
}

export function findingNotFound(id: string): SecurityLabError {
  return new SecurityLabError("finding_not_found", `No security finding with id '${id}' was found.`);
}

export function retentionLimitReached(kind: "scenarios" | "runs", cap: number): SecurityLabError {
  return new SecurityLabError(
    "retention_limit_reached",
    `Retained ${kind} reached the limit of ${cap}. Delete an assessment or all retained data in Reports before adding more.`,
    { kind, cap },
  );
}
