/**
 * Typed errors for AP-029 k6 performance testing (specs/031-k6-performance-testing). Each maps to
 * one contract error code in `backend/src/api/performanceHttp.ts` or the route that throws it;
 * none carries a value.
 */

export class PerformanceRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`No performance run with id '${runId}' was found.`);
    this.name = "PerformanceRunNotFoundError";
  }
}

/** `400 invalid_expected_status`: an unknown step, an empty list, or a malformed code (D26). */
export class InvalidExpectedStatusError extends Error {
  constructor(
    public readonly stepId: string,
    reason: string,
  ) {
    super(reason);
    this.name = "InvalidExpectedStatusError";
  }
}

/** `400 invalid_request`: a `PUT /plan` body or field that is not the documented shape. */
export class InvalidPlanUpdateError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidPlanUpdateError";
  }
}

/** `400 invalid_load_profile` (data-model.md validation rules). */
export class InvalidLoadProfileError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidLoadProfileError";
  }
}

/** `400 invalid_threshold`. */
export class InvalidThresholdError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidThresholdError";
  }
}

/** `400 unknown_operation`: an excluded operation key that is not in the analyzed model. */
export class UnknownOperationError extends Error {
  constructor(public readonly operationKey: string) {
    super(`'${operationKey}' is not an analyzed operation.`);
    this.name = "UnknownOperationError";
  }
}

/** `400 invalid_order`: a proposed order that is not a permutation of the same ids. */
export class InvalidOrderError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidOrderError";
  }
}

/** `400 dependency_order_violation` (FR-007): the first variable the proposed order breaks. */
export class DependencyOrderViolationError extends Error {
  constructor(
    public readonly variable: string,
    public readonly producerStepId: string,
    public readonly consumerStepId: string,
  ) {
    super(`This order would run a step before the step that produces '${variable}'.`);
    this.name = "DependencyOrderViolationError";
  }
}

/** AP-032 `404 step_not_found`: a step id that is not in the current plan (step request preview). */
export class StepNotFoundError extends Error {
  constructor(public readonly stepId: string) {
    super(`'${stepId}' is not a step in this plan.`);
    this.name = "StepNotFoundError";
  }
}

/** AP-032 `404 operation_not_removed`: the removed-operation preview for a key not in the removed list. */
export class OperationNotRemovedError extends Error {
  constructor(public readonly operationKey: string) {
    super(`'${operationKey}' is not a removed operation of this plan.`);
    this.name = "OperationNotRemovedError";
  }
}

/** AP-032 `409 no_positive_scenario`: a removed operation that would still build no step if restored. */
export class NoPositiveScenarioError extends Error {
  constructor(public readonly operationKey: string) {
    super(`'${operationKey}' has no positive scenario, so restoring it would add no step.`);
    this.name = "NoPositiveScenarioError";
  }
}

/** AP-032 `409 quick_test_exists`: a new upload while a quick test exists and replacing was not confirmed (FR-021). */
export class QuickTestExistsError extends Error {
  constructor() {
    super("This session already has a quick performance test. Confirm to replace it; runs and reports are kept.");
    this.name = "QuickTestExistsError";
  }
}

/** AP-033 (specs/033-edit-step-request-body contracts/body-edits-api.md): why a body edit was refused. */
export type InvalidBodyEditCode =
  | "invalid_body_edit"
  | "body_not_accepted"
  | "body_too_large"
  | "invalid_body"
  | "reserved_reference"
  | "body_secret_literal";

/** Extra fields a body-edit refusal carries. None holds body text or a value (research R6, R14). */
export interface InvalidBodyEditExtra {
  limitBytes?: number;
  line?: number;
  column?: number;
  reference?: string;
  fieldPath?: string;
}

/** AP-033 FR-020 to FR-022 (amended 2026-09-30): why a parameter edit was refused. */
export type InvalidParameterEditCode =
  | "invalid_parameter_edit"
  | "parameter_not_editable"
  | "parameter_required"
  | "parameter_too_long"
  | "reserved_reference"
  | "parameter_secret_literal";

/**
 * AP-033 `400 <code>`: a `PUT /plan` parameter edit that cannot be saved; nothing is applied. The
 * extra fields name the parameter only; no message quotes the value the engineer typed.
 */
export class InvalidParameterEditError extends Error {
  constructor(
    public readonly code: InvalidParameterEditCode,
    public readonly stepId: string,
    message: string,
    public readonly extra: { location?: string; name?: string; reference?: string; limitBytes?: number } = {},
  ) {
    super(message);
    this.name = "InvalidParameterEditError";
  }
}

/** AP-033 `400 <code>`: a `PUT /plan` body edit that cannot be saved; nothing is applied (research R6). */
export class InvalidBodyEditError extends Error {
  constructor(
    public readonly code: InvalidBodyEditCode,
    public readonly stepId: string,
    message: string,
    public readonly extra: InvalidBodyEditExtra = {},
  ) {
    super(message);
    this.name = "InvalidBodyEditError";
  }
}
