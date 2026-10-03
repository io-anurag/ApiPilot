import type { MappingNameRefusal, ScriptProblem } from "@apipilot/shared-domain";

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

/** AP-034 (specs/034-run-user-k6-script contracts/user-scripts-api.md): `404 script_not_found`. */
export class UserScriptNotFoundError extends Error {
  constructor(public readonly scriptId: string) {
    super("No script with this id was found in this session.");
    this.name = "UserScriptNotFoundError";
  }
}

/** AP-034 `422 script_refused` (FR-004): nothing was stored, or the stored script no longer passes the check (research R17). */
export class UserScriptRefusedError extends Error {
  constructor(public readonly problems: ScriptProblem[]) {
    super("The script was refused by ApiPilot's check. Each reason is listed with its line.");
    this.name = "UserScriptRefusedError";
  }
}

/** AP-034 `409 script_changed`: the SHA-256 sent is not the script's current one (research R8, R17). */
export class UserScriptChangedError extends Error {
  constructor() {
    super("The script changed since it was shown. Review it again before continuing.");
    this.name = "UserScriptChangedError";
  }
}

/** AP-034 `409 script_not_confirmed` (FR-013). */
export class UserScriptNotConfirmedError extends Error {
  constructor() {
    super("The script has not been confirmed. Confirm its current content before running it.");
    this.name = "UserScriptNotConfirmedError";
  }
}

/** AP-034 `409 run_in_progress`: a script with a run in progress cannot be deleted (spec Edge Cases). */
export class UserScriptRunInProgressError extends Error {
  constructor(public readonly runId: string) {
    super("This script has a run in progress. Delete it once the run has ended.");
    this.name = "UserScriptRunInProgressError";
  }
}

/** AP-034 `409 load_override_unavailable` (FR-027). */
export class LoadOverrideUnavailableError extends Error {
  constructor() {
    super("This script has no default function, so a load profile cannot replace its scenarios. It runs with its own load settings.");
    this.name = "LoadOverrideUnavailableError";
  }
}

/** AP-034 `400 invalid_mapping_name` (FR-026). Names the refused name only, never a value. */
export class InvalidMappingNameError extends Error {
  constructor(
    public readonly mappingName: string,
    public readonly reason: MappingNameRefusal,
    message: string,
  ) {
    super(message);
    this.name = "InvalidMappingNameError";
  }
}

/** AP-034 `400 invalid_settings`: the settings' shape, limits or stages are invalid. */
export class InvalidUserScriptSettingsError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidUserScriptSettingsError";
  }
}

/**
 * AP-035 (specs/035-user-defined-journeys contracts/plan-journeys-api.md): why a `PUT /plan` user
 * journey change was refused. The plan is unchanged. Extras name journeys, steps, captures and
 * targets only, never a value.
 */
export type UserJourneyRefusalCode =
  | "invalid_user_journey"
  | "journey_too_long"
  | "too_many_captures"
  | "capture_name_invalid"
  | "capture_name_taken"
  | "capture_path_invalid"
  | "capture_header_invalid"
  | "binding_capture_unknown"
  | "capture_in_use"
  | "binding_target_unknown"
  | "binding_target_taken"
  | "parameter_edited"
  | "invalid_standalone"
  | "not_a_proposed_journey"
  | "not_based_on_workflow";

export class UserJourneyRefusedError extends Error {
  constructor(
    public readonly code: UserJourneyRefusalCode,
    message: string,
    public readonly extra: Record<string, string | number | string[] | Record<string, string>> = {},
  ) {
    super(message);
    this.name = "UserJourneyRefusedError";
  }
}

/** AP-035 FR-016 `422 binding_target_missing`: a captured value's target no longer exists. */
export class BindingTargetMissingError extends Error {
  constructor(public readonly stepIds: string[]) {
    super("A captured value's target no longer exists. Remove or re-target each binding marked \"Target no longer exists\".");
    this.name = "BindingTargetMissingError";
  }
}

/**
 * AP-036 (specs/036-collection-performance-test contracts/collection-performance-api.md): the
 * collection plan's refusals. None carries a value, a script excerpt, a URL or a variable name.
 */

/** `409 collection_plan_exists`: a plan exists and replacing it was not confirmed (FR-025). */
export class CollectionPlanExistsError extends Error {
  constructor() {
    super("This session already has a collection performance plan. Confirm to replace it; its runs and reports are kept.");
    this.name = "CollectionPlanExistsError";
  }
}

/** `422 too_many_requests`: more than 100 requests selected (FR-002). */
export class TooManyCollectionRequestsError extends Error {
  constructor(public readonly count: number) {
    super(`${count} requests are selected. A collection performance plan takes at most 100; narrow the selection in the run panel.`);
    this.name = "TooManyCollectionRequestsError";
  }
}

/** `409 collection_plan_out_of_date` (FR-022, research R13). */
export class CollectionPlanOutOfDateError extends Error {
  constructor(public readonly state: "changed" | "deleted") {
    super(
      state === "changed"
        ? "The collection changed since this plan was built. Rebuild the plan first."
        : "The collection this plan was built from has been deleted, so the plan cannot be run or rebuilt.",
    );
    this.name = "CollectionPlanOutOfDateError";
  }
}

/** `409 conversion_not_reviewed` (FR-018, research R14). */
export class ConversionNotReviewedError extends Error {
  constructor() {
    super("Review the conversion before generating the script.");
    this.name = "ConversionNotReviewedError";
  }
}

/** `409 collection_deleted`: rebuilding or seeding from a collection that no longer exists (FR-022). */
export class CollectionDeletedError extends Error {
  constructor() {
    super("The collection this plan was built from has been deleted.");
    this.name = "CollectionDeletedError";
  }
}

/** `400 not_supported_for_collection_plan` (FR-020): a `PUT /plan` field a collection plan does not offer. */
export class NotSupportedForCollectionPlanError extends Error {
  constructor(public readonly field: string) {
    super(`${field} is not offered for a plan built from a collection. Edit the request in the collection editor instead.`);
    this.name = "NotSupportedForCollectionPlanError";
  }
}

/** `422 base_url_missing` (FR-017, research R17). */
export class BaseUrlMissingError extends Error {
  constructor() {
    super("The plan has no base URL variable, or the collection gives it no value, so an environment cannot be created from it.");
    this.name = "BaseUrlMissingError";
  }
}

// ------------------------------------------------------------------------------------------------
// AP-037 request-chain plans (specs/037-request-chain-performance contracts/chain-plan-api.md). Each
// maps to one contract code in `backend/src/api/chainPlanHttp.ts`; none carries a value.

/** `404 chain_plan_not_found`. */
export class ChainPlanNotFoundError extends Error {
  constructor(planId: string) {
    super(`No request-chain plan with id '${planId}' was found.`);
    this.name = "ChainPlanNotFoundError";
  }
}

/** `409 plan_revision_conflict`: the plan was saved elsewhere since this revision was read. */
export class PlanRevisionConflictError extends Error {
  constructor(readonly planId: string) {
    super("The plan was changed since you opened it. It has been reloaded; make your change again.");
    this.name = "PlanRevisionConflictError";
  }
}

/** `422 invalid_plan`: a plan-level field that is not the documented shape. */
export class InvalidChainPlanError extends Error {
  constructor(
    readonly field: string,
    reason: string,
  ) {
    super(reason);
    this.name = "InvalidChainPlanError";
  }
}

/** `422 invalid_chain`. */
export class InvalidChainError extends Error {
  constructor(
    readonly chainId: string,
    reason: string,
  ) {
    super(reason);
    this.name = "InvalidChainError";
  }
}

/** `422 invalid_step`: one field of one step. */
export class InvalidStepError extends Error {
  constructor(
    readonly stepId: string,
    readonly field: string,
    reason: string,
  ) {
    super(reason);
    this.name = "InvalidStepError";
  }
}

/** `422 header_not_settable`: `Host` and `Content-Length` are set by the runtime (FR-003). */
export class HeaderNotSettableError extends Error {
  constructor(
    readonly stepId: string,
    readonly header: string,
  ) {
    super(`The ${header} header is set by k6 for every request, so a step cannot set it.`);
    this.name = "HeaderNotSettableError";
  }
}

/** `422` or `409 plan_limit_exceeded` (research R26). */
export class PlanLimitExceededError extends Error {
  constructor(
    readonly limit: string,
    reason: string,
    readonly statusCode: 409 | 422 = 422,
  ) {
    super(reason);
    this.name = "PlanLimitExceededError";
  }
}

export type CredentialLocation = { kind: "header"; name: string } | { kind: "body-field"; path: string };

/** `422 credential_needs_environment` (FR-027, Clarification 2026-10-03). */
export class CredentialNeedsEnvironmentError extends Error {
  constructor(
    readonly stepId: string,
    readonly location: CredentialLocation,
  ) {
    super("This step holds a credential typed as text. Choose a target environment first, so it can be kept there as a secret value.");
    this.name = "CredentialNeedsEnvironmentError";
  }
}

/** `422 credential_mixed_literal` (research R8). */
export class CredentialMixedLiteralError extends Error {
  constructor(
    readonly stepId: string,
    readonly location: CredentialLocation,
  ) {
    super("This credential mixes typed text with {{references}}. Use only a reference, or only the typed value.");
    this.name = "CredentialMixedLiteralError";
  }
}

/** `422 plan_has_blockers` (FR-014). */
export class PlanHasBlockersError extends Error {
  constructor(readonly blockers: readonly unknown[]) {
    super("The plan has problems to fix before a script can be generated or run.");
    this.name = "PlanHasBlockersError";
  }
}

/** `409 run_in_progress`: a plan with a run in progress cannot be deleted. */
export class ChainRunInProgressError extends Error {
  constructor() {
    super("A run of this plan is in progress. Cancel it or wait for it to end first.");
    this.name = "ChainRunInProgressError";
  }
}

/** `404 data_set_not_found`. */
export class DataSetNotFoundError extends Error {
  constructor(dataSetId: string) {
    super(`No data set with id '${dataSetId}' was found in this plan.`);
    this.name = "DataSetNotFoundError";
  }
}

/** `409 data_set_limit_exceeded` (FR-041: at most 5 data sets per plan). */
export class DataSetLimitExceededError extends Error {
  constructor(limit: number) {
    super(`A plan has at most ${limit} data sets. Remove one first.`);
    this.name = "DataSetLimitExceededError";
  }
}

/** `413 data_set_too_large` (FR-041). */
export class DataSetTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`A data set file is at most ${limitBytes / (1024 * 1024)} MiB.`);
    this.name = "DataSetTooLargeError";
  }
}
