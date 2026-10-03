import type { Request, Response } from "express";
import { EnvironmentNotFoundError } from "../execution/errors";
import { createLogger } from "../logger";
import { InvalidRunOrderError, NoRequestsSelectedError, UploadedCollectionNotFoundError } from "../externalCollections/errors";
import {
  InvalidLoadProfileError,
  InvalidOrderError,
  InvalidThresholdError,
  PerformanceRunNotFoundError,
  QuickTestExistsError,
  StepNotFoundError,
} from "../performance/errors";

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
  if (err instanceof InvalidOrderError) return fail(req, res, startedAt, 400, "invalid_order", err.message);
  if (err instanceof InvalidLoadProfileError) return fail(req, res, startedAt, 400, "invalid_load_profile", err.message);
  if (err instanceof InvalidThresholdError) return fail(req, res, startedAt, 400, "invalid_threshold", err.message);
  if (err instanceof EnvironmentNotFoundError) return fail(req, res, startedAt, 404, "environment_not_found", err.message);
  if (err instanceof PerformanceRunNotFoundError) return fail(req, res, startedAt, 404, "run_not_found", err.message);
  if (err instanceof StepNotFoundError) return fail(req, res, startedAt, 404, "step_not_found", err.message);
  if (err instanceof QuickTestExistsError) return fail(req, res, startedAt, 409, "quick_test_exists", err.message);
  if (err instanceof UploadedCollectionNotFoundError) return fail(req, res, startedAt, 404, "uploaded_collection_not_found", err.message);
  if (err instanceof NoRequestsSelectedError) return fail(req, res, startedAt, 400, "no_requests_selected", err.message);
  if (err instanceof InvalidRunOrderError) return fail(req, res, startedAt, 400, "invalid_run_order", err.message);
  throw err;
}

