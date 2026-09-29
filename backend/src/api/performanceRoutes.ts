import type { Router } from "express";
import type { PerformancePlan, PerformancePlanSourceKind, ScriptStatus } from "@apipilot/shared-domain";
import { getEnvironment } from "../execution/environmentStore";
import { createLogger } from "../logger";
import { renderScript, scriptDigest } from "../performance/k6/renderScript";
import type { K6Probe, PerformanceRunner } from "../performance/k6/runnerTypes";
import { rebuildPlan } from "../performance/plan/buildPlan";
import { applyPlanUpdate } from "../performance/plan/planUpdate";
import { buildRemovedOperationPreview } from "../performance/plan/removedOperationPreview";
import { buildStepRequestPreview } from "../performance/plan/requestPreview";
import type { PerformanceContext } from "../performance/plan/stepRequest";
import { valueStatuses } from "../performance/plan/userSuppliedValues";
import type { GeneratedScript } from "../performance/scriptStore";
import { fail, handleKnownError, logReceived, logSucceeded } from "./performanceHttp";
import { registerPerformanceRunRoutes } from "./performanceRuns";

const logger = createLogger("api.performanceTesting");

/**
 * The performance plan, script and run routes, registered once per plan source (AP-032,
 * specs/032-quick-performance-test research Q2). AP-029's guided workflow stage and AP-032's
 * quick performance test differ only in where the plan and script are kept and in the guided
 * stage's transitions; every route body, error mapping and the run trigger's check order are
 * shared, so the constitution XVII exception's conditions are enforced in one place.
 */
export interface PerformanceTestingDependencies {
  runner: PerformanceRunner;
  probe: K6Probe;
  /** How often a running test checkpoints progress and keeps its session alive (research D18). */
  tickIntervalMs: number;
  now: () => Date;
  runDirectoryRoot?: string;
}

/** One request's view of a plan source's state. Obtained from `PerformancePlanSource.require()`. */
export interface PlanHandle {
  context: PerformanceContext;
  /** The current plan (the guided source rebuilds it when its approvals changed). */
  plan(): PerformancePlan;
  savePlan(plan: PerformancePlan): void;
  script(): GeneratedScript | undefined;
  saveScript(script: GeneratedScript): void;
  /** Called by `GET /plan` before reading the plan (guided: enters the stage). */
  onOpen?(): void;
  /** After `PUT /plan` saved `after` (guided: complete → active on a fingerprint change). */
  onPlanChanged(before: PerformancePlan, after: PerformancePlan): void;
  /** After `POST /plan/reset` saved `plan` (guided: complete → active when the script is out of date). */
  onPlanReset(plan: PerformancePlan): void;
  /** After `POST /script` stored a current script (guided: active → complete). */
  onScriptGenerated(): void;
}

export interface PerformancePlanSource {
  kind: PerformancePlanSourceKind;
  /** The path's gate: returns the handle, or throws the path's own error (mapped in `handleKnownError`). */
  require(): PlanHandle;
}

export function scriptStatus(plan: PerformancePlan, script: GeneratedScript | undefined): ScriptStatus | null {
  if (!script) return null;
  return {
    planFingerprint: script.planFingerprint,
    scriptSha256: script.scriptSha256,
    stepCount: script.stepCount,
    outOfDate: script.planFingerprint !== plan.fingerprint,
  };
}

function stepCountOf(plan: PerformancePlan): number {
  return plan.journeys.reduce((total, journey) => total + journey.steps.length, 0);
}

/**
 * Registers `GET/PUT <base>/plan`, `POST <base>/plan/reset`, `GET <base>/plan/values`,
 * `GET <base>/plan/steps/:stepId/request`, `GET <base>/plan/removed-operation`, `POST <base>/script`, `GET <base>/script/download`,
 * and then the readiness and run routes, for one plan source (specs/031
 * contracts/performance-api.md; specs/032 contracts/quick-performance-api.md).
 */
export function registerPerformanceRoutes(router: Router, base: string, source: PerformancePlanSource, deps: PerformanceTestingDependencies): void {
  // `GET /plan` has a side effect on the guided path (it enters the stage), so clients call it
  // when the user opens the plan, never to pre-fetch.
  router.get(`${base}/plan`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const handle = source.require();
      handle.onOpen?.();
      const plan = handle.plan();
      res.status(200).json({ plan, script: scriptStatus(plan, handle.script()) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.put(`${base}/plan`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const handle = source.require();
      const before = handle.plan();
      const plan = applyPlanUpdate(before, req.body, handle.context);
      handle.savePlan(plan);
      handle.onPlanChanged(before, plan);
      res.status(200).json({ plan, script: scriptStatus(plan, handle.script()) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.post(`${base}/plan/reset`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const handle = source.require();
      const plan = rebuildPlan(handle.plan(), handle.context, { keepOrder: false });
      handle.savePlan(plan);
      handle.onPlanReset(plan);
      res.status(200).json({ plan, script: scriptStatus(plan, handle.script()) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.get(`${base}/plan/values`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const plan = source.require().plan();
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

  // AP-032 FR-008: the view-only request of one step, derived from the request the script sends.
  router.get(`${base}/plan/steps/:stepId/request`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const handle = source.require();
      res.status(200).json({ request: buildStepRequestPreview(handle.plan(), handle.context, req.params.stepId) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  // AP-032 FR-024a: a removed operation's step and request as they would be if it were restored.
  // Read-only: the plan is not changed. The key is a query parameter because it holds a space and
  // a path template.
  router.get(`${base}/plan/removed-operation`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const handle = source.require();
      const operationKey = typeof req.query.operationKey === "string" ? req.query.operationKey : "";
      if (!operationKey) return fail(req, res, startedAt, 400, "invalid_request", "operationKey is required.");
      res.status(200).json(buildRemovedOperationPreview(handle.plan(), handle.context, operationKey));
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.post(`${base}/script`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const handle = source.require();
      const plan = handle.plan();
      const stepCount = stepCountOf(plan);
      if (stepCount === 0) return fail(req, res, startedAt, 422, "nothing_to_test", "The plan has no steps to test.");
      if (plan.stepsNeedingExpectedStatus.length > 0) {
        return fail(req, res, startedAt, 422, "expected_status_missing", "Every step needs at least one expected status before the script can be generated.", {
          stepIds: plan.stepsNeedingExpectedStatus,
        });
      }
      const rendered = renderScript(plan, handle.context);
      const scriptSha256 = scriptDigest(rendered.script);
      handle.saveScript({
        planFingerprint: plan.fingerprint,
        scriptSha256,
        environmentTemplateSha256: scriptDigest(rendered.environmentTemplate),
        script: rendered.script,
        environmentTemplate: rendered.environmentTemplate,
        stepCount,
        valueIndex: rendered.valueIndex,
      });
      handle.onScriptGenerated();
      logger.info("performance_script_generated", { sha256Prefix: scriptSha256.slice(0, 12), stepCount, planSource: source.kind });
      res.status(200).json({ script: scriptStatus(plan, handle.script()) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.get(`${base}/script/download`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const handle = source.require();
      const plan = handle.plan();
      const script = handle.script();
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

  registerPerformanceRunRoutes(router, deps, base, source);
}
