import type { Router } from "express";
import type { PerformancePlanSourceKind } from "@apipilot/shared-domain";
import { getPerformanceRun, listPerformanceRuns, requestPerformanceCancel } from "../performance/performanceRunStore";
import { renderHtmlReport } from "../performance/report/renderHtmlReport";
import { cancelLiveRun } from "../performance/runPerformanceTest";
import { fail, handleKnownError } from "./performanceHttp";

/**
 * The read-only routes of runs recorded from the retired guided, quick and collection plans
 * (specs/037-request-chain-performance FR-037; contracts/changes-to-existing-apis.md "Routes kept,
 * read-only"), under their old bases. A legacy run can be listed, opened, cancelled while it is
 * still settling, and its report opened exactly as it was rendered. No route here starts, repeats
 * or restores a run: request-chain plans are the only way a run starts (constitution XVII).
 */
export function registerLegacyRunRoutes(router: Router, base: string, source: PerformancePlanSourceKind): void {
  router.get(`${base}/runs`, (_req, res) => {
    res.status(200).json({ runs: listPerformanceRuns(source) });
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
