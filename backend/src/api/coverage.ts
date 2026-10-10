import { Router, type Response } from "express";
import { createLogger } from "../logger";
import { listRuns as listGuidedRuns } from "../execution/executionRunStore";
import { listRuns as listUploadedRuns } from "../externalCollections/uploadedCollectionExecutionStore";
import { getCurrentWorkflow } from "../testGenerationWorkflow/workflowStore";
import { describeFilter, parseCoverageQuery } from "../apiCoverage/coverageQuery";
import { getFilteredCoverage, type CoverageSources } from "../apiCoverage/coverageService";
import { CategoryUnavailableError, InvalidCoverageFilterError, NoActiveWorkflowError, RunNotFoundError } from "../apiCoverage/errors";
import { coverageFileName, renderCoverageHtml } from "../apiCoverage/renderCoverageHtml";

const logger = createLogger("api.coverage");

const defaultSources: CoverageSources = {
  getWorkflow: getCurrentWorkflow,
  listUploadedRuns,
  listGuidedRuns,
  now: () => new Date(),
};

/** Maps the coverage domain errors to their documented responses (contracts/coverage-routes.md). */
function respondToError(err: unknown, res: Response, log: (status: number, category: string) => void): boolean {
  if (err instanceof InvalidCoverageFilterError) {
    log(400, "invalid_filter");
    res.status(400).json({ error: "invalid_filter", message: err.message });
    return true;
  }
  if (err instanceof CategoryUnavailableError) {
    log(400, "category_unavailable");
    res.status(400).json({ error: "category_unavailable", message: err.message });
    return true;
  }
  if (err instanceof RunNotFoundError) {
    log(404, "run_not_found");
    res.status(404).json({ error: "run_not_found", message: err.message });
    return true;
  }
  if (err instanceof NoActiveWorkflowError) {
    log(409, "no_active_workflow");
    res.status(409).json({ error: "no_active_workflow", message: err.message });
    return true;
  }
  return false;
}

/**
 * Read-only coverage routes (AP-046). Thin: parse and validate the query, call the coverage
 * domain, map typed errors. Nothing is stored, no AI is used, and no sensitive run content is
 * read into the response (specs/046 contracts/coverage-routes.md).
 */
export function createCoverageRouter(sources: CoverageSources = defaultSources): Router {
  const router = Router();

  router.get("/coverage", (req, res, next) => {
    const startedAt = Date.now();
    logger.info("request_received", { method: req.method, path: req.path });
    const log = (statusCode: number, errorCategory: string): void =>
      logger.error("request_failed", { method: req.method, path: req.path, statusCode, errorCategory, durationMs: Date.now() - startedAt });
    try {
      const query = parseCoverageQuery(req.query);
      const snapshot = getFilteredCoverage(sources, query.filter, query.runId);
      res.status(200).set("Cache-Control", "no-store").json(snapshot);
      logger.info("request_succeeded", {
        method: req.method,
        path: req.path,
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        operationCount: snapshot.operations.length,
        gapCount: snapshot.gaps.length,
      });
    } catch (err) {
      if (!respondToError(err, res, log)) next(err);
    }
  });

  router.get("/coverage/export", (req, res, next) => {
    const startedAt = Date.now();
    logger.info("request_received", { method: req.method, path: req.path });
    const log = (statusCode: number, errorCategory: string): void =>
      logger.error("request_failed", { method: req.method, path: req.path, statusCode, errorCategory, durationMs: Date.now() - startedAt });
    try {
      const query = parseCoverageQuery(req.query);
      if (query.format === undefined) throw new InvalidCoverageFilterError("format is required: html or json.");
      const filter = query.scope === "all" ? {} : query.filter;
      const snapshot = getFilteredCoverage(sources, filter, query.runId);
      const body =
        query.format === "html"
          ? renderCoverageHtml(snapshot, describeFilter(query.filter, query.scope))
          : JSON.stringify({ view: describeFilter(query.filter, query.scope), ...snapshot }, null, 2);
      res
        .status(200)
        .set({
          "Content-Type": query.format === "html" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${coverageFileName(snapshot, query.format)}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        .send(body);
      logger.info("request_succeeded", { method: req.method, path: req.path, statusCode: 200, durationMs: Date.now() - startedAt });
    } catch (err) {
      if (!respondToError(err, res, log)) next(err);
    }
  });

  return router;
}

export const coverageRouter = createCoverageRouter();
