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

/** AP-032 `409 quick_test_exists`: a new upload while a quick test exists and replacing was not confirmed (FR-021). */
export class QuickTestExistsError extends Error {
  constructor() {
    super("This session already has a quick performance test. Confirm to replace it; runs and reports are kept.");
    this.name = "QuickTestExistsError";
  }
}
