import type { Request, Response } from "express";
import { EnvironmentNotFoundError } from "../execution/errors";
import { createLogger } from "../logger";
import { InvalidRunOrderError, NoRequestsSelectedError, UploadedCollectionNotFoundError } from "../externalCollections/errors";
import {
  BaseUrlMissingError,
  BindingTargetMissingError,
  CollectionDeletedError,
  CollectionPlanExistsError,
  CollectionPlanOutOfDateError,
  ConversionNotReviewedError,
  NotSupportedForCollectionPlanError,
  TooManyCollectionRequestsError,
  DependencyOrderViolationError,
  InvalidBodyEditError,
  InvalidParameterEditError,
  InvalidExpectedStatusError,
  InvalidLoadProfileError,
  InvalidOrderError,
  InvalidThresholdError,
  NoPositiveScenarioError,
  OperationNotRemovedError,
  PerformanceRunNotFoundError,
  QuickTestExistsError,
  StepNotFoundError,
  UnknownOperationError,
  UserJourneyRefusedError,
} from "../performance/errors";
import { InvalidPlanUpdateError } from "../performance/plan/planUpdate";

const logger = createLogger("api.performanceTesting");

/**
 * Request logging and error mapping shared by every performance route (AP-029 and AP-032). Kept
 * apart from `performanceRoutes.ts` and `performanceRuns.ts` so neither imports the other at run
 * time.
 */

/** A source's gate error, carrying the contract status and code it maps to. */
export class PlanSourceUnavailableError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlanSourceUnavailableError";
  }
}

export function logReceived(req: Request): number {
  logger.info("request_received", { method: req.method, path: req.path });
  return Date.now();
}

export function logSucceeded(req: Request, startedAt: number, statusCode: number): void {
  logger.info("request_succeeded", { method: req.method, path: req.path, statusCode, durationMs: Date.now() - startedAt });
}

function logFailed(req: Request, startedAt: number, statusCode: number, errorCategory: string): void {
  logger.error("request_failed", { method: req.method, path: req.path, statusCode, errorCategory, durationMs: Date.now() - startedAt });
}

export function fail(req: Request, res: Response, startedAt: number, status: number, error: string, message: string, extra: Record<string, unknown> = {}): void {
  logFailed(req, startedAt, status, error);
  res.status(status).json({ error, message, ...extra });
}

/** Maps the typed errors every route shares to their contract codes; rethrows anything else. */
export function handleKnownError(req: Request, res: Response, startedAt: number, err: unknown): void {
  if (err instanceof PlanSourceUnavailableError) return fail(req, res, startedAt, err.statusCode, err.code, err.message);
  if (err instanceof DependencyOrderViolationError) {
    return fail(req, res, startedAt, 400, "dependency_order_violation", err.message, {
      variable: err.variable,
      producerStepId: err.producerStepId,
      consumerStepId: err.consumerStepId,
    });
  }
  if (err instanceof InvalidOrderError) return fail(req, res, startedAt, 400, "invalid_order", err.message);
  if (err instanceof InvalidLoadProfileError) return fail(req, res, startedAt, 400, "invalid_load_profile", err.message);
  if (err instanceof InvalidThresholdError) return fail(req, res, startedAt, 400, "invalid_threshold", err.message);
  if (err instanceof InvalidExpectedStatusError) return fail(req, res, startedAt, 400, "invalid_expected_status", err.message, { stepId: err.stepId });
  if (err instanceof InvalidBodyEditError) return fail(req, res, startedAt, 400, err.code, err.message, { stepId: err.stepId, ...err.extra });
  if (err instanceof InvalidParameterEditError) return fail(req, res, startedAt, 400, err.code, err.message, { stepId: err.stepId, ...err.extra });
  if (err instanceof UnknownOperationError) return fail(req, res, startedAt, 400, "unknown_operation", err.message, { operationKey: err.operationKey });
  if (err instanceof UserJourneyRefusedError) return fail(req, res, startedAt, 400, err.code, err.message, err.extra);
  if (err instanceof BindingTargetMissingError) return fail(req, res, startedAt, 422, "binding_target_missing", err.message, { stepIds: err.stepIds });
  if (err instanceof InvalidPlanUpdateError) return fail(req, res, startedAt, 400, "invalid_request", err.message);
  if (err instanceof EnvironmentNotFoundError) return fail(req, res, startedAt, 404, "environment_not_found", err.message);
  if (err instanceof PerformanceRunNotFoundError) return fail(req, res, startedAt, 404, "run_not_found", err.message);
  if (err instanceof StepNotFoundError) return fail(req, res, startedAt, 404, "step_not_found", err.message);
  if (err instanceof OperationNotRemovedError) return fail(req, res, startedAt, 404, "operation_not_removed", err.message);
  if (err instanceof NoPositiveScenarioError) return fail(req, res, startedAt, 409, "no_positive_scenario", err.message);
  if (err instanceof QuickTestExistsError) return fail(req, res, startedAt, 409, "quick_test_exists", err.message);
  // AP-036 (specs/036-collection-performance-test contracts/collection-performance-api.md).
  if (err instanceof CollectionPlanExistsError) return fail(req, res, startedAt, 409, "collection_plan_exists", err.message);
  if (err instanceof TooManyCollectionRequestsError) return fail(req, res, startedAt, 422, "too_many_requests", err.message, { count: err.count });
  if (err instanceof CollectionPlanOutOfDateError) return fail(req, res, startedAt, 409, "collection_plan_out_of_date", err.message, { state: err.state });
  if (err instanceof ConversionNotReviewedError) return fail(req, res, startedAt, 409, "conversion_not_reviewed", err.message);
  if (err instanceof CollectionDeletedError) return fail(req, res, startedAt, 409, "collection_deleted", err.message);
  if (err instanceof NotSupportedForCollectionPlanError) return fail(req, res, startedAt, 400, "not_supported_for_collection_plan", err.message, { field: err.field });
  if (err instanceof BaseUrlMissingError) return fail(req, res, startedAt, 422, "base_url_missing", err.message);
  if (err instanceof UploadedCollectionNotFoundError) return fail(req, res, startedAt, 404, "uploaded_collection_not_found", err.message);
  if (err instanceof NoRequestsSelectedError) return fail(req, res, startedAt, 400, "no_requests_selected", err.message);
  if (err instanceof InvalidRunOrderError) return fail(req, res, startedAt, 400, "invalid_run_order", err.message);
  throw err;
}

