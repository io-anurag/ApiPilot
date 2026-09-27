import { randomUUID } from "node:crypto";
import type { Router } from "express";
import type { PerformanceRun } from "@apipilot/shared-domain";
import { getEnvironment } from "../execution/environmentStore";
import { getInProgressRun } from "../execution/executionRunStore";
import { getInProgressRun as getUploadedInProgressRun } from "../externalCollections/uploadedCollectionExecutionStore";
import { createLogger } from "../logger";
import {
  createPerformanceRun,
  getPerformanceInProgressRun,
  getPerformanceRun,
  listPerformanceRuns,
  requestPerformanceCancel,
} from "../performance/performanceRunStore";
import { renderHtmlReport } from "../performance/report/renderHtmlReport";
import { cancelLiveRun, startPerformanceRun } from "../performance/runPerformanceTest";
import { getGeneratedScript } from "../performance/scriptStore";
import { getSessionId } from "../session/sessionContext";
import type { PerformanceTestingDependencies } from "./performanceTesting";
import { currentPlan, fail, handleKnownError, requirePostmanGenerationComplete } from "./performanceTesting";

const logger = createLogger("api.performanceRuns");

/**
 * Readiness, run and report routes (contracts/performance-api.md "Runs"). `POST /runs` is the only
 * way a run starts (FR-024; constitution XVII exception of 2026-09-24). Only it is stage-gated: a
 * run already started stays visible, cancellable and reportable even if an upstream revision
 * later makes Postman generation stale (contract "Stage gating").
 */
export function registerPerformanceRunRoutes(router: Router, deps: PerformanceTestingDependencies, base: string): void {
  router.get(`${base}/readiness`, async (req, res, next) => {
    try {
      const { readiness } = await deps.probe({ recheck: req.query.recheck === "true" });
      res.status(200).json({ readiness });
    } catch (err) {
      next(err);
    }
  });

  router.post(`${base}/runs`, async (req, res, next) => {
    const startedAt = Date.now();
    try {
      // 1. The stage gate.
      const workflow = requirePostmanGenerationComplete();
      // 2. A script exists and is current (FR-023).
      const plan = currentPlan(workflow);
      const script = getGeneratedScript();
      if (!script) return fail(req, res, startedAt, 409, "script_not_generated", "Generate the script before running it.");
      if (script.planFingerprint !== plan.fingerprint) {
        return fail(req, res, startedAt, 409, "script_out_of_date", "The plan changed after the script was generated. Regenerate it first.");
      }
      // 3. k6 is ready, probed now rather than from the cache (FR-027).
      const probe = await deps.probe({ recheck: true });
      if (probe.readiness.state !== "ready" || !probe.binaryPath) {
        return fail(req, res, startedAt, 409, "k6_unavailable", "k6 is not available on the machine running ApiPilot.", { readiness: probe.readiness });
      }
      // 4. The environment exists.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const environment = getEnvironment(typeof body.environmentId === "string" ? body.environmentId : "");
      // 5. The shared slot (FR-029). The check and the insert are synchronous, with no await between them.
      const inProgress = getInProgressRun() ?? getUploadedInProgressRun() ?? getPerformanceInProgressRun();
      if (inProgress) {
        return fail(req, res, startedAt, 409, "execution_in_progress", "Another execution run is in progress in this session.", { runId: inProgress.id });
      }
      const run: PerformanceRun = {
        id: randomUUID(),
        status: "in-progress",
        environment: { id: environment.id, name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl },
        planSnapshot: plan,
        scriptSha256: script.scriptSha256,
        k6Version: probe.readiness.version,
        plannedDurationMs: plan.loadProfile.plannedDurationMs,
        startedAt: deps.now().toISOString(),
        cancelRequested: false,
      };
      createPerformanceRun(run);
      const sessionId = getSessionId();
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
      }).catch((error: Error) => logger.error("performance_run_unhandled_error", { runId: run.id, errorCategory: error.name }));
      res.status(200).json({ run });
    } catch (err) {
      try {
        handleKnownError(req, res, startedAt, err);
      } catch (unknown) {
        next(unknown);
      }
    }
  });

  router.get(`${base}/runs`, (_req, res) => {
    res.status(200).json({ runs: listPerformanceRuns() });
  });

  router.get(`${base}/runs/:runId`, (req, res) => {
    const startedAt = Date.now();
    try {
      res.status(200).json({ run: getPerformanceRun(req.params.runId) });
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.post(`${base}/runs/:runId/cancel`, (req, res) => {
    const startedAt = Date.now();
    try {
      const run = getPerformanceRun(req.params.runId);
      if (run.status !== "in-progress") return fail(req, res, startedAt, 409, "run_not_in_progress", "This run has already ended.");
      const updated = requestPerformanceCancel(run.id);
      cancelLiveRun(run.id);
      res.status(202).json({ run: updated });
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.get(`${base}/runs/:runId/report`, (req, res) => {
    const startedAt = Date.now();
    try {
      const run = getPerformanceRun(req.params.runId);
      if (run.status === "in-progress") return fail(req, res, startedAt, 409, "run_in_progress", "The report is available once the run has ended.");
      if (req.query.download === "true") {
        res.setHeader("Content-Disposition", `attachment; filename="apipilot-performance-${run.id}.html"`);
      }
      res.status(200).type("text/html; charset=utf-8").send(renderHtmlReport(run));
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });
}
