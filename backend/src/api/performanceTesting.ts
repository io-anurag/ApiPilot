import { Router, type Request, type Response } from "express";
import type { PerformancePlan, ScriptStatus, TestGenerationWorkflow } from "@apipilot/shared-domain";
import { EnvironmentNotFoundError } from "../execution/errors";
import { getEnvironment } from "../execution/environmentStore";
import { createLogger } from "../logger";
import {
  DependencyOrderViolationError,
  InvalidExpectedStatusError,
  InvalidLoadProfileError,
  InvalidOrderError,
  InvalidThresholdError,
  PerformanceRunNotFoundError,
  UnknownOperationError,
} from "../performance/errors";
import { renderScript, scriptDigest } from "../performance/k6/renderScript";
import { buildPlan, contextFromWorkflow, rebuildPlan, upstreamFingerprint } from "../performance/plan/buildPlan";
import { applyPlanUpdate, InvalidPlanUpdateError } from "../performance/plan/planUpdate";
import { valueStatuses } from "../performance/plan/userSuppliedValues";
import { getGeneratedScript, setGeneratedScript } from "../performance/scriptStore";
import type { PerformanceRunner, K6Probe } from "../performance/k6/runnerTypes";
import { advanceActiveStage, getCurrentWorkflow, patchWorkflow, updateStage } from "../testGenerationWorkflow/workflowStore";
import { registerPerformanceRunRoutes } from "./performanceRuns";

const logger = createLogger("api.performanceTesting");

/**
 * AP-029 k6 performance testing routes (specs/031-k6-performance-testing
 * contracts/performance-api.md). Routes stay thin: plan building, validation and rendering live
 * in `backend/src/performance/`. Every route is scoped to the calling session's guided workflow.
 */
export interface PerformanceTestingDependencies {
  runner: PerformanceRunner;
  probe: K6Probe;
  /** How often a running test checkpoints progress and keeps its session alive (research D18). */
  tickIntervalMs: number;
  now: () => Date;
  runDirectoryRoot?: string;
}

const BASE = "/test-generation-workflow/performance";

class PostmanGenerationIncompleteError extends Error {
  constructor() {
    super("Performance testing opens once the Postman collection has been generated.");
    this.name = "PostmanGenerationIncompleteError";
  }
}

function logReceived(req: Request): number {
  logger.info("request_received", { method: req.method, path: req.path });
  return Date.now();
}

function logSucceeded(req: Request, startedAt: number, statusCode: number): void {
  logger.info("request_succeeded", { method: req.method, path: req.path, statusCode, durationMs: Date.now() - startedAt });
}

function logFailed(req: Request, startedAt: number, statusCode: number, errorCategory: string): void {
  logger.error("request_failed", { method: req.method, path: req.path, statusCode, errorCategory, durationMs: Date.now() - startedAt });
}

export function fail(req: Request, res: Response, startedAt: number, status: number, error: string, message: string, extra: Record<string, unknown> = {}): void {
  logFailed(req, startedAt, status, error);
  res.status(status).json({ error, message, ...extra });
}

/** The stage gate (research D1): Postman generation must be complete. */
export function requirePostmanGenerationComplete(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow();
  if (!workflow || workflow.stages.postmanGeneration.status !== "complete") throw new PostmanGenerationIncompleteError();
  return workflow;
}

/**
 * The session's current plan: built on first read, and rebuilt (keeping the user's choices) when
 * the approvals it was built from have changed since (research D1, D26).
 */
export function currentPlan(workflow: TestGenerationWorkflow): PerformancePlan {
  const context = contextFromWorkflow(workflow);
  const existing = workflow.performancePlan;
  if (existing && existing.upstreamFingerprint === upstreamFingerprint(context)) return existing;
  const plan = existing ? rebuildPlan(existing, context, { keepOrder: true }) : buildPlan(context);
  patchWorkflow({ performancePlan: plan });
  return plan;
}

export function scriptStatus(plan: PerformancePlan): ScriptStatus | null {
  const script = getGeneratedScript();
  if (!script) return null;
  return {
    planFingerprint: script.planFingerprint,
    scriptSha256: script.scriptSha256,
    stepCount: script.stepCount,
    outOfDate: script.planFingerprint !== plan.fingerprint,
  };
}

/** Maps the typed errors every route shares to their contract codes; rethrows anything else. */
export function handleKnownError(req: Request, res: Response, startedAt: number, err: unknown): void {
  if (err instanceof PostmanGenerationIncompleteError) return fail(req, res, startedAt, 409, "postman_generation_incomplete", err.message);
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
  if (err instanceof UnknownOperationError) return fail(req, res, startedAt, 400, "unknown_operation", err.message);
  if (err instanceof InvalidPlanUpdateError) return fail(req, res, startedAt, 400, "invalid_request", err.message);
  if (err instanceof EnvironmentNotFoundError) return fail(req, res, startedAt, 404, "environment_not_found", err.message);
  if (err instanceof PerformanceRunNotFoundError) return fail(req, res, startedAt, 404, "run_not_found", err.message);
  throw err;
}

function enterStageIfNeeded(workflow: TestGenerationWorkflow): void {
  const status = workflow.stages.performanceTesting.status;
  if (status === "not-yet-reached" || status === "stale") advanceActiveStage("performanceTesting");
}

export function createPerformanceTestingRouter(dependencies: PerformanceTestingDependencies): Router {
  const router = Router();

  router.get(`${BASE}/plan`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const workflow = requirePostmanGenerationComplete();
      enterStageIfNeeded(workflow);
      const plan = currentPlan(getCurrentWorkflow()!);
      res.status(200).json({ plan, script: scriptStatus(plan) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.put(`${BASE}/plan`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const workflow = requirePostmanGenerationComplete();
      const before = currentPlan(workflow);
      const plan = applyPlanUpdate(before, req.body, contextFromWorkflow(workflow));
      patchWorkflow({ performancePlan: plan });
      if (plan.fingerprint !== before.fingerprint && getCurrentWorkflow()!.stages.performanceTesting.status === "complete") {
        updateStage("performanceTesting", "active");
      }
      res.status(200).json({ plan, script: scriptStatus(plan) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.post(`${BASE}/plan/reset`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const workflow = requirePostmanGenerationComplete();
      const plan = rebuildPlan(currentPlan(workflow), contextFromWorkflow(workflow), { keepOrder: false });
      patchWorkflow({ performancePlan: plan });
      if (getCurrentWorkflow()!.stages.performanceTesting.status === "complete" && scriptStatus(plan)?.outOfDate) {
        updateStage("performanceTesting", "active");
      }
      res.status(200).json({ plan, script: scriptStatus(plan) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.get(`${BASE}/plan/values`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const workflow = requirePostmanGenerationComplete();
      const plan = currentPlan(workflow);
      const environmentId = typeof req.query.environmentId === "string" ? req.query.environmentId : "";
      const environment = getEnvironment(environmentId);
      res.status(200).json({
        environment: { id: environment.id, name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl },
        values: valueStatuses(plan.userSuppliedValues, environment),
      });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.post(`${BASE}/script`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const workflow = requirePostmanGenerationComplete();
      const plan = currentPlan(workflow);
      const stepCount = plan.journeys.reduce((total, journey) => total + journey.steps.length, 0);
      if (stepCount === 0) return fail(req, res, startedAt, 422, "nothing_to_test", "The plan has no steps to test.");
      if (plan.stepsNeedingExpectedStatus.length > 0) {
        return fail(req, res, startedAt, 422, "expected_status_missing", "Every step needs at least one expected status before the script can be generated.", {
          stepIds: plan.stepsNeedingExpectedStatus,
        });
      }
      const rendered = renderScript(plan, contextFromWorkflow(workflow));
      const scriptSha256 = scriptDigest(rendered.script);
      setGeneratedScript({
        planFingerprint: plan.fingerprint,
        scriptSha256,
        environmentTemplateSha256: scriptDigest(rendered.environmentTemplate),
        script: rendered.script,
        environmentTemplate: rendered.environmentTemplate,
        stepCount,
        valueIndex: rendered.valueIndex,
      });
      if (getCurrentWorkflow()!.stages.performanceTesting.status === "active") updateStage("performanceTesting", "complete");
      logger.info("performance_script_generated", { sha256Prefix: scriptSha256.slice(0, 12), stepCount });
      res.status(200).json({ script: scriptStatus(plan) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.get(`${BASE}/script/download`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const workflow = requirePostmanGenerationComplete();
      const plan = currentPlan(workflow);
      const script = getGeneratedScript();
      if (!script) return fail(req, res, startedAt, 404, "script_not_generated", "No script has been generated for this plan yet.");
      if (script.planFingerprint !== plan.fingerprint) {
        return fail(req, res, startedAt, 409, "script_out_of_date", "The plan changed after the script was generated. Regenerate it first.");
      }
      if (req.query.file === "environment-template") {
        res.setHeader("Content-Disposition", 'attachment; filename="apipilot-performance-environment.json"');
        res.status(200).type("application/json").send(script.environmentTemplate);
      } else {
        res.setHeader("Content-Disposition", 'attachment; filename="apipilot-performance.js"');
        res.status(200).type("text/javascript; charset=utf-8").send(script.script);
      }
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  registerPerformanceRunRoutes(router, dependencies, BASE);
  return router;
}
