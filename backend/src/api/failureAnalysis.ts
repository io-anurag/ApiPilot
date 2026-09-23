import { Router, type NextFunction, type Request, type Response } from "express";
import type { AIProvider } from "@apipilot/shared-domain";
import { getAIProvider } from "../ai";
import { loadAIConfig } from "../ai/modelConfig";
import { createLogger } from "../logger";
import { getSessionId } from "../session/sessionContext";
import { getCurrentWorkflow } from "../testGenerationWorkflow/workflowStore";
import { getRun as getUploadedRun } from "../externalCollections/uploadedCollectionExecutionStore";
import { getUploadedCollection } from "../externalCollections/uploadedCollectionStore";
import { RunNotFoundError, UploadedCollectionNotFoundError } from "../externalCollections/errors";
import { analyzeFailure, type ViabilitySettings } from "../failureAnalysis/analyzeFailure";
import { failureAnalysisStore, listAnalyses } from "../failureAnalysis/failureAnalysisStore";
import { inProgressRegistry } from "../failureAnalysis/inProgressRegistry";
import {
  FailureAnalysisInProgressError,
  InvalidResultIndexError,
  ResultNotFailedError,
  ResultNotFoundError,
} from "../failureAnalysis/errors";

/**
 * AP-031 failure-analysis routes (specs/030-ai-failure-analysis contracts/failure-analysis-api.md).
 * Thin: parse, delegate to `analyzeFailure`, map typed errors. Like the AP-026 run-detail route,
 * none requires the uploaded collection to still exist.
 */

const logger = createLogger("api.failureAnalysis");

function logFailed(req: Request, startedAt: number, statusCode: number, errorCategory: string): void {
  logger.error("request_failed", {
    method: req.method,
    path: req.path,
    statusCode,
    errorCategory,
    durationMs: Date.now() - startedAt,
  });
}

function parseResultIndex(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidResultIndexError(value);
  return Number(value);
}

function viabilitySettings(): ViabilitySettings {
  const config = loadAIConfig();
  return {
    rates: {
      prefillMsPerToken: config.planning.prefillMsPerToken,
      decodeMsPerToken: config.planning.decodeMsPerToken,
    },
    safetyFactor: config.planning.viabilitySafetyFactor,
    budgetMs: config.model.inferenceTimeoutMs,
  };
}

function collectionVariables(uploadedCollectionSetId: string): Readonly<Record<string, string>> | undefined {
  try {
    return getUploadedCollection(uploadedCollectionSetId).variableValues;
  } catch (error) {
    if (error instanceof UploadedCollectionNotFoundError) return undefined;
    throw error;
  }
}

/** Builds the router; `provider` defaults to the process-wide AI provider and can be injected for tests. */
export function createFailureAnalysisRouter(provider: AIProvider = getAIProvider()) {
  const router = Router();

  router.post(
    "/external-collections/:id/execution/runs/:runId/results/:resultIndex/failure-analysis",
    async (req: Request, res: Response, next: NextFunction) => {
      const startedAt = Date.now();
      logger.info("request_received", { method: req.method, path: req.path });
      try {
        const resultIndex = parseResultIndex(req.params.resultIndex);
        const run = getUploadedRun(req.params.runId);
        const attempt = await analyzeFailure(
          {
            provider,
            store: failureAnalysisStore,
            registry: inProgressRegistry,
            now: () => new Date(),
            getWorkflow: getCurrentWorkflow,
            getCollectionVariableValues: () => collectionVariables(run.uploadedCollectionSetId),
            viability: viabilitySettings(),
          },
          { sessionId: getSessionId(), run, resultIndex },
        );
        res.status(200).json(attempt);
        logger.info("request_succeeded", {
          method: req.method,
          path: req.path,
          statusCode: 200,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        if (error instanceof InvalidResultIndexError) {
          logFailed(req, startedAt, 400, "invalid_result_index");
          res.status(400).json({ error: "invalid_result_index", message: error.message });
        } else if (error instanceof RunNotFoundError) {
          logFailed(req, startedAt, 404, "run_not_found");
          res.status(404).json({ error: "run_not_found", message: error.message });
        } else if (error instanceof ResultNotFoundError) {
          logFailed(req, startedAt, 404, "result_not_found");
          res.status(404).json({ error: "result_not_found", message: error.message });
        } else if (error instanceof ResultNotFailedError) {
          logFailed(req, startedAt, 409, "result_not_failed");
          res.status(409).json({ error: "result_not_failed", message: error.message, outcome: error.outcome });
        } else if (error instanceof FailureAnalysisInProgressError) {
          logFailed(req, startedAt, 409, "failure_analysis_in_progress");
          res.status(409).json({
            error: "failure_analysis_in_progress",
            message: error.message,
            runId: error.runId,
            resultIndex: error.resultIndex,
          });
        } else {
          next(error);
        }
      }
    },
  );

  router.get("/external-collections/:id/execution/runs/:runId/failure-analyses", (req, res, next) => {
    try {
      getUploadedRun(req.params.runId);
      res.status(200).json({ analyses: listAnalyses(req.params.runId) });
    } catch (error) {
      if (error instanceof RunNotFoundError) {
        logFailed(req, Date.now(), 404, "run_not_found");
        res.status(404).json({ error: "run_not_found", message: error.message });
        return;
      }
      next(error);
    }
  });

  router.get("/failure-analysis/in-progress", (_req, res) => {
    const inProgress = inProgressRegistry.get(getSessionId());
    if (!inProgress) {
      res.status(204).end();
      return;
    }
    res.status(200).json({ inProgress });
  });

  return router;
}

/** Default router instance, using the process-wide AI provider. */
export const failureAnalysisRouter = createFailureAnalysisRouter();
