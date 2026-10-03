import { randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { CHAIN_PLAN_LIMITS, type ChainRun } from "@apipilot/shared-domain";
import { getEnvironment } from "../execution/environmentStore";
import { findExecutionInProgress } from "../execution/executionSlot";
import { createLogger } from "../logger";
import { createPlan, deletePlan, duplicatePlan, emptyPlan, getPlan, listPlans, savePlan, scriptStatusOf, viewOf } from "../performance/chain/chainPlanStore";
import { addDataSet, previewDataSet, removeDataSet, replaceDataSetFile, runCopyWriter, updateDataSet } from "../performance/chain/dataSets";
import { generateChainScript } from "../performance/chain/generateScript";
import { restoreRun } from "../performance/chain/restore";
import { parseSeedSource, seedPlan } from "../performance/chain/seed/seedService";
import { chainRunSnapshot } from "../performance/chain/runSnapshot";
import { ChainPlanNotFoundError, ChainRunInProgressError, DataSetNotFoundError, DataSetTooLargeError, InvalidChainPlanError, PerformanceRunNotFoundError, PlanHasBlockersError } from "../performance/errors";
import { renderChainReport } from "../performance/report/renderChainReport";
import { cancelLiveRun, startPerformanceRun } from "../performance/runPerformanceTest";
import { getChainScript } from "../performance/scriptStore";
import { getPerformanceRunRepository } from "../persistence/performanceRunRepository";
import { getSessionId } from "../session/sessionContext";
import { reaffirmSession } from "../session/sessionMiddleware";
import { chainRoute } from "./chainPlanHttp";
import { fail, logSucceeded } from "./performanceHttp";
import type { PerformanceTestingDependencies } from "./performanceRoutes";

const logger = createLogger("api.chainPlans");

/**
 * AP-037 Request-Chain Performance Plans (specs/037-request-chain-performance
 * contracts/chain-plan-api.md). A standalone route family over `performance/chain/`, with its own
 * 8 MiB JSON limit (research R26), mounted before the global parser. Routes stay thin. A run starts
 * only on `POST /api/chain-plans/:planId/runs`, the engineer's explicit trigger naming the target
 * environment (constitution XVII, 2026-09-24 exception as extended for AP-037); generating a script
 * or restoring a run never starts one. No response carries an environment value, a data set value or
 * the script text (except the download route), and logs carry ids and counts only (research R27).
 */
export const CHAIN_PLANS_BASE = "/api/chain-plans";
const BASE = "/chain-plans";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The JSON parser for this route family, mounted at `CHAIN_PLANS_BASE` before the global one. */
export const chainPlansJson = express.json({ limit: CHAIN_PLAN_LIMITS.documentBytes });

/** FR-041: a data set file is at most 5 MiB, held in memory only until it is checked and encrypted. */
const dataSetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CHAIN_PLAN_LIMITS.dataSetBytes, files: 1 } });

/** Accepts one `file` field; an oversized file is refused as `413 data_set_too_large`, nothing stored. */
function dataSetFile(req: Request, res: Response, next: NextFunction): void {
  dataSetUpload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return fail(req, res, Date.now(), 413, "data_set_too_large", new DataSetTooLargeError(CHAIN_PLAN_LIMITS.dataSetBytes).message);
    }
    next(err);
  });
}

function uploadedBytes(req: Request): Buffer {
  const file = (req as Request & { file?: { buffer: Buffer } }).file;
  if (!file) throw new InvalidChainPlanError("file", "Upload the CSV file under the 'file' field.");
  return file.buffer;
}

function dataSetIdOf(value: string): string {
  if (!UUID.test(value)) throw new DataSetNotFoundError(value);
  return value;
}

function planIdOf(value: string): string {
  if (!UUID.test(value)) throw new ChainPlanNotFoundError(value);
  return value;
}

function runIdOf(value: string): string {
  if (!UUID.test(value)) throw new PerformanceRunNotFoundError(value);
  return value;
}

function nameOf(body: unknown): string {
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== "string" || name.trim() === "" || name.trim().length > CHAIN_PLAN_LIMITS.nameLength) {
    throw new InvalidChainPlanError("name", `A plan needs a name of 1 to ${CHAIN_PLAN_LIMITS.nameLength} characters.`);
  }
  return name.trim();
}

function stepCountOf(plan: { chains: { steps: unknown[] }[] }): number {
  return plan.chains.reduce((total, chain) => total + chain.steps.length, 0);
}

function chainRunOf(runId: string): ChainRun {
  const run = getPerformanceRunRepository().getChainRun(getSessionId(), runIdOf(runId));
  if (!run) throw new PerformanceRunNotFoundError(runId);
  return run;
}

export function createChainPlansRouter(deps: PerformanceTestingDependencies): Router {
  const router = Router();

  // Static paths first, so `/:planId` never captures them.
  router.get(
    `${BASE}/readiness`,
    chainRoute(async (req, res, startedAt) => {
      const { readiness } = await deps.probe({ recheck: req.query.recheck === "true" });
      res.status(200).json({ readiness });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.get(
    `${BASE}/runs/:runId`,
    chainRoute((req, res, startedAt) => {
      res.status(200).json({ run: chainRunOf(req.params.runId) });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.post(
    `${BASE}/runs/:runId/cancel`,
    chainRoute((req, res, startedAt) => {
      const run = chainRunOf(req.params.runId);
      if (run.status !== "in-progress") return fail(req, res, startedAt, 409, "run_not_in_progress", "This run has already ended.");
      const updated = getPerformanceRunRepository().requestChainCancel(getSessionId(), run.id);
      cancelLiveRun(run.id);
      res.status(202).json({ run: updated });
      logSucceeded(req, startedAt, 202);
    }),
  );

  router.get(
    `${BASE}/runs/:runId/report`,
    chainRoute((req, res, startedAt) => {
      const run = chainRunOf(req.params.runId);
      if (run.status === "in-progress") return fail(req, res, startedAt, 409, "run_in_progress", "The report is available once the run has ended.");
      if (req.query.download === "true") res.setHeader("Content-Disposition", `attachment; filename="apipilot-performance-${run.id}.html"`);
      res.status(200).type("text/html; charset=utf-8").send(renderChainReport(run));
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.post(
    `${BASE}/runs/:runId/restore`,
    chainRoute((req, res, startedAt) => {
      const { view, dataSetsNotRestored } = restoreRun(runIdOf(req.params.runId), req.body, deps.now().toISOString());
      logger.info("chain_run_restored", { runId: req.params.runId, planId: view.plan.id, dataSetsNotRestored: dataSetsNotRestored.length });
      res.status(200).json({ ...view, dataSetsNotRestored });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.post(
    `${BASE}/seed`,
    chainRoute((req, res, startedAt) => {
      const body = (req.body ?? {}) as { name?: unknown; source?: unknown; environmentId?: unknown };
      const environmentId = typeof body.environmentId === "string" && body.environmentId !== "" ? body.environmentId : undefined;
      const source = parseSeedSource(body.source);
      const { view, movedCredentials, reportItems } = seedPlan({ name: nameOf(body), source, environmentId }, deps.now().toISOString());
      logger.info("chain_plan_seeded", { planId: view.plan.id, sourceKind: source.kind, stepCount: stepCountOf(view.plan), reportItemCount: reportItems, movedCredentialCount: movedCredentials.length });
      res.status(201).json({ ...view, movedCredentials });
      logSucceeded(req, startedAt, 201);
    }),
  );

  router.get(
    BASE,
    chainRoute((req, res, startedAt) => {
      res.status(200).json({ plans: listPlans() });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.post(
    BASE,
    chainRoute((req, res, startedAt) => {
      const view = createPlan(emptyPlan(nameOf(req.body), deps.now().toISOString()));
      logger.info("chain_plan_created", { planId: view.plan.id });
      res.status(201).json(view);
      logSucceeded(req, startedAt, 201);
    }),
  );

  router.get(
    `${BASE}/:planId`,
    chainRoute((req, res, startedAt) => {
      res.status(200).json(viewOf(getPlan(planIdOf(req.params.planId))));
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.put(
    `${BASE}/:planId`,
    chainRoute((req, res, startedAt) => {
      const body = (req.body ?? {}) as { revision?: unknown; plan?: unknown };
      const saveStarted = Date.now();
      const { view, movedCredentials } = savePlan(planIdOf(req.params.planId), body.revision, body.plan, deps.now().toISOString());
      logger.info("chain_plan_saved", {
        planId: view.plan.id,
        revision: view.plan.revision,
        chainCount: view.plan.chains.length,
        stepCount: stepCountOf(view.plan),
        movedCredentialCount: movedCredentials.length,
        durationMs: Date.now() - saveStarted,
      });
      res.status(200).json({ ...view, movedCredentials });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.post(
    `${BASE}/:planId/duplicate`,
    chainRoute((req, res, startedAt) => {
      const view = duplicatePlan(planIdOf(req.params.planId), nameOf(req.body), deps.now().toISOString());
      logger.info("chain_plan_duplicated", { planId: view.plan.id });
      res.status(201).json(view);
      logSucceeded(req, startedAt, 201);
    }),
  );

  router.delete(
    `${BASE}/:planId`,
    chainRoute((req, res, startedAt) => {
      const planId = planIdOf(req.params.planId);
      const inProgress = getPerformanceRunRepository().getChainInProgress(getSessionId());
      if (inProgress?.planId === planId) throw new ChainRunInProgressError();
      deletePlan(planId);
      logger.info("chain_plan_deleted", { planId });
      res.status(204).end();
      logSucceeded(req, startedAt, 204);
    }),
  );

  router.post(
    `${BASE}/:planId/data-sets`,
    dataSetFile,
    reaffirmSession,
    chainRoute((req, res, startedAt) => {
      const body = (req.body ?? {}) as { name?: unknown; mode?: unknown };
      const { dataSet, view } = addDataSet(planIdOf(req.params.planId), uploadedBytes(req), body.name, body.mode, deps.now().toISOString());
      logger.info("chain_data_set_stored", { planId: view.plan.id, dataSetId: dataSet.id, rowCount: dataSet.rowCount, columnCount: dataSet.columns.length, sizeBytes: dataSet.sizeBytes });
      res.status(201).json({ dataSet, ...view });
      logSucceeded(req, startedAt, 201);
    }),
  );

  router.put(
    `${BASE}/:planId/data-sets/:dataSetId`,
    chainRoute((req, res, startedAt) => {
      const { dataSet, view } = updateDataSet(planIdOf(req.params.planId), dataSetIdOf(req.params.dataSetId), req.body, deps.now().toISOString());
      res.status(200).json({ dataSet, ...view });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.put(
    `${BASE}/:planId/data-sets/:dataSetId/file`,
    dataSetFile,
    reaffirmSession,
    chainRoute((req, res, startedAt) => {
      const { dataSet, view } = replaceDataSetFile(planIdOf(req.params.planId), dataSetIdOf(req.params.dataSetId), uploadedBytes(req), deps.now().toISOString());
      logger.info("chain_data_set_stored", { planId: view.plan.id, dataSetId: dataSet.id, rowCount: dataSet.rowCount, columnCount: dataSet.columns.length, sizeBytes: dataSet.sizeBytes });
      res.status(200).json({ dataSet, ...view });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.delete(
    `${BASE}/:planId/data-sets/:dataSetId`,
    chainRoute((req, res, startedAt) => {
      res.status(200).json(removeDataSet(planIdOf(req.params.planId), dataSetIdOf(req.params.dataSetId)));
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.get(
    `${BASE}/:planId/data-sets/:dataSetId/preview`,
    chainRoute((req, res, startedAt) => {
      res.status(200).json(previewDataSet(planIdOf(req.params.planId), dataSetIdOf(req.params.dataSetId)));
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.post(
    `${BASE}/:planId/script`,
    chainRoute((req, res, startedAt) => {
      const plan = getPlan(planIdOf(req.params.planId));
      const view = viewOf(plan);
      const script = generateChainScript(plan, view.analysis);
      logger.info("chain_script_generated", { planId: plan.id, stepCount: script.stepCount });
      res.status(200).json({ script: scriptStatusOf(plan, script) });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.get(
    `${BASE}/:planId/script/download`,
    chainRoute((req, res, startedAt) => {
      const plan = getPlan(planIdOf(req.params.planId));
      const script = getChainScript(plan.id);
      if (!script) return fail(req, res, startedAt, 409, "script_not_generated", "No script has been generated for this plan yet.");
      if (script.planFingerprint !== plan.fingerprint) return fail(req, res, startedAt, 409, "script_out_of_date", "The plan changed after the script was generated. Regenerate it first.");
      // FR-047 (Clarification 2026-10-03): a data set is read from a file only ApiPilot writes for a run.
      if (plan.dataSets.length > 0) res.setHeader("X-ApiPilot-Note", "data-sets-not-included");
      if (req.query.file === "environment-template") {
        res.setHeader("Content-Disposition", 'attachment; filename="apipilot-request-chain-environment.json"');
        res.status(200).type("application/json").send(script.environmentTemplate);
      } else {
        res.setHeader("Content-Disposition", 'attachment; filename="apipilot-request-chain.js"');
        res.status(200).type("text/javascript; charset=utf-8").send(script.script);
      }
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.get(
    `${BASE}/:planId/runs`,
    chainRoute((req, res, startedAt) => {
      res.status(200).json({ runs: getPerformanceRunRepository().listChainRuns(getSessionId(), planIdOf(req.params.planId)) });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.post(
    `${BASE}/:planId/runs`,
    chainRoute(async (req, res, startedAt) => {
      const plan = getPlan(planIdOf(req.params.planId));
      // 1. A script exists and is current (FR-032).
      const script = getChainScript(plan.id);
      if (!script) return fail(req, res, startedAt, 409, "script_not_generated", "Generate the script before running it.");
      if (script.planFingerprint !== plan.fingerprint) return fail(req, res, startedAt, 409, "script_out_of_date", "The plan changed after the script was generated. Regenerate it first.");
      // 2. Nothing blocks the plan (FR-014).
      const view = viewOf(plan);
      if (view.analysis.blockers.length > 0) throw new PlanHasBlockersError(view.analysis.blockers);
      // 3. k6 is ready, probed now (AP-029 FR-027).
      const probe = await deps.probe({ recheck: true });
      if (probe.readiness.state !== "ready" || !probe.binaryPath) {
        return fail(req, res, startedAt, 409, "k6_unavailable", "k6 is not available on the machine running ApiPilot.", { readiness: probe.readiness });
      }
      // 4. The environment the trigger named exists.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const environment = getEnvironment(typeof body.environmentId === "string" ? body.environmentId : "");
      // 5. The session's one execution slot. The check and the insert are synchronous.
      const inProgress = findExecutionInProgress();
      if (inProgress) return fail(req, res, startedAt, 409, "execution_in_progress", "Another execution run is in progress in this session.", { runId: inProgress.runId });
      const run: ChainRun = {
        id: randomUUID(),
        planSource: "chain",
        planId: plan.id,
        status: "in-progress",
        environment: { id: environment.id, name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl },
        snapshot: chainRunSnapshot(plan, view.analysis),
        scriptSha256: script.scriptSha256,
        k6Version: probe.readiness.version,
        plannedDurationMs: plan.loadProfile.plannedDurationMs,
        startedAt: deps.now().toISOString(),
        cancelRequested: false,
      };
      const sessionId = getSessionId();
      getPerformanceRunRepository().createChainRun(sessionId, run, JSON.stringify(plan));
      void startPerformanceRun({
        sessionId,
        run,
        script,
        environment,
        binaryPath: probe.binaryPath,
        runner: deps.runner,
        tickIntervalMs: deps.tickIntervalMs,
        now: deps.now,
        runDirectoryRoot: deps.runDirectoryRoot,
        writeRunFiles: runCopyWriter(sessionId, plan),
      }).catch((error: Error) => logger.error("performance_run_unhandled_error", { runId: run.id, errorCategory: error.name }));
      res.status(200).json({ run });
      logSucceeded(req, startedAt, 200);
    }),
  );

  return router;
}
