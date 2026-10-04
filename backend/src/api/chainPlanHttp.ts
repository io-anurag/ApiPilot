import type { NextFunction, Request, Response } from "express";
import { EnvironmentNotFoundError } from "../execution/errors";
import {
  ChainPlanNotFoundError,
  ChainRunInProgressError,
  CredentialMixedLiteralError,
  CredentialNeedsEnvironmentError,
  DebugRunBlockedError,
  DebugRunInProgressError,
  DebugValueNotFoundError,
  DataSetLimitExceededError,
  DataSetNotFoundError,
  DataSetTooLargeError,
  HeaderNotSettableError,
  InvalidChainError,
  InvalidChainPlanError,
  InvalidStepError,
  PerformanceRunNotFoundError,
  PlanHasBlockersError,
  PlanLimitExceededError,
  PlanRevisionConflictError,
} from "../performance/errors";
import { getPlan, viewOf } from "../performance/chain/chainPlanStore";
import { DataSetInvalidError } from "../performance/chain/csv";
import { createLogger } from "../logger";
import { fail, handleKnownError, logReceived } from "./performanceHttp";

const logger = createLogger("api.chainPlans");

/**
 * Error mapping for the request-chain plan routes (specs/037-request-chain-performance
 * contracts/chain-plan-api.md). Each typed error maps to its contract status and code; anything
 * unknown goes to the central handler, which never exposes detail. No response here carries a value.
 */
export function handleChainError(req: Request, res: Response, startedAt: number, err: unknown): void {
  if (err instanceof ChainPlanNotFoundError) return fail(req, res, startedAt, 404, "chain_plan_not_found", err.message);
  if (err instanceof PlanRevisionConflictError) {
    let current: unknown;
    try {
      current = viewOf(getPlan(err.planId));
    } catch {
      current = undefined;
    }
    return fail(req, res, startedAt, 409, "plan_revision_conflict", err.message, current ? { current } : {});
  }
  if (err instanceof InvalidChainPlanError) return fail(req, res, startedAt, 422, "invalid_plan", err.message, { field: err.field });
  if (err instanceof InvalidChainError) return fail(req, res, startedAt, 422, "invalid_chain", err.message, { chainId: err.chainId });
  if (err instanceof InvalidStepError) return fail(req, res, startedAt, 422, "invalid_step", err.message, { stepId: err.stepId, field: err.field });
  if (err instanceof HeaderNotSettableError) return fail(req, res, startedAt, 422, "header_not_settable", err.message, { stepId: err.stepId, header: err.header });
  if (err instanceof PlanLimitExceededError) return fail(req, res, startedAt, err.statusCode, "plan_limit_exceeded", err.message, { limit: err.limit });
  if (err instanceof CredentialNeedsEnvironmentError) {
    return fail(req, res, startedAt, 422, "credential_needs_environment", err.message, { stepId: err.stepId, location: err.location });
  }
  if (err instanceof CredentialMixedLiteralError) {
    return fail(req, res, startedAt, 422, "credential_mixed_literal", err.message, { stepId: err.stepId, location: err.location });
  }
  if (err instanceof PlanHasBlockersError) return fail(req, res, startedAt, 422, "plan_has_blockers", err.message, { blockers: err.blockers });
  if (err instanceof DataSetInvalidError) {
    logger.info("chain_data_set_refused", { reason: err.refusal.reason, line: "line" in err.refusal ? err.refusal.line : 0 });
    return fail(req, res, startedAt, 422, "data_set_invalid", err.message, { ...err.refusal });
  }
  if (err instanceof DataSetTooLargeError) return fail(req, res, startedAt, 413, "data_set_too_large", err.message);
  if (err instanceof DataSetLimitExceededError) return fail(req, res, startedAt, 409, "data_set_limit_exceeded", err.message);
  if (err instanceof DataSetNotFoundError) return fail(req, res, startedAt, 404, "data_set_not_found", err.message);
  if (err instanceof ChainRunInProgressError) return fail(req, res, startedAt, 409, "run_in_progress", err.message);
  if (err instanceof DebugRunBlockedError) return fail(req, res, startedAt, 409, "execution_in_progress", err.message, { runId: err.runId });
  if (err instanceof DebugRunInProgressError) return fail(req, res, startedAt, 409, "debug_run_in_progress", err.message);
  if (err instanceof DebugValueNotFoundError) return fail(req, res, startedAt, 404, "debug_value_not_found", err.message);
  if (err instanceof EnvironmentNotFoundError) return fail(req, res, startedAt, 404, "environment_not_found", err.message);
  if (err instanceof PerformanceRunNotFoundError) return fail(req, res, startedAt, 404, "run_not_found", err.message);
  handleKnownError(req, res, startedAt, err);
}

/** Wraps a handler: request logging, the chain error mapping, and anything unknown to the central handler. */
export function chainRoute(handler: (req: Request, res: Response, startedAt: number) => void | Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startedAt = logReceived(req);
    try {
      await handler(req, res, startedAt);
    } catch (err) {
      try {
        handleChainError(req, res, startedAt, err);
      } catch (unknown) {
        next(unknown);
      }
    }
  };
}
