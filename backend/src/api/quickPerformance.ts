import { Router } from "express";
import { prefillExpectedStatuses } from "../performance/plan/expectedStatuses";
import type { QuickPerformanceTestView } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { createQuickTest } from "../performance/quick/createQuickTest";
import { getQuickTest, type QuickPerformanceTest } from "../performance/quick/quickTestStore";
import { QuickTestExistsError } from "../performance/errors";
import { reaffirmSession } from "../session/sessionMiddleware";
import { upload } from "../uploadMiddleware";
import { fail, handleKnownError, logReceived, logSucceeded, PlanSourceUnavailableError } from "./performanceHttp";
import { registerLegacyRunRoutes } from "./performanceRuns";

const logger = createLogger("api.quickPerformance");

/**
 * AP-032 Quick Performance Test routes (specs/032-quick-performance-test
 * contracts/quick-performance-api.md): the session's uploaded specification and its generated
 * positive scenarios. Since AP-037 phase two (specs/037-request-chain-performance FR-036) the quick
 * test is a seeding source only: a request-chain plan is seeded from it, and the quick plan, script
 * and run trigger are gone. Runs recorded from quick plans before stay readable here (FR-037). It
 * never reads or changes the session's guided workflow (FR-021).
 */
const BASE = "/quick-performance";

function requireQuickTest(): QuickPerformanceTest {
  const test = getQuickTest();
  if (!test) throw new PlanSourceUnavailableError(404, "quick_test_not_found", "Upload a specification to start a quick performance test.");
  return test;
}

function viewOf(test: QuickPerformanceTest): QuickPerformanceTestView {
  return {
    specification: {
      ...test.specification,
      operations: test.apiModel.operations.map((operation) => ({
        method: operation.method.toUpperCase(),
        path: operation.path,
        ...(operation.operationId ? { operationId: operation.operationId } : {}),
        parameters: operation.parameters.map(({ name, location, required }) => ({ name, location, required })),
        hasRequestBody: operation.requestBody !== undefined,
        expectedStatuses: prefillExpectedStatuses(operation),
      })),
    },
  };
}

export function createQuickPerformanceRouter(): Router {
  const router = Router();

  router.post(BASE, upload.single("file"), reaffirmSession, async (req, res, next) => {
    const startedAt = logReceived(req);
    try {
      if (!req.file) {
        logger.info("quick_performance_upload_failed", { errorCategory: "invalid_yaml" });
        return fail(req, res, startedAt, 400, "invalid_yaml", "No file was uploaded under the 'file' field");
      }
      const test = await createQuickTest(req.file.buffer, req.file.originalname, req.query.replaceExisting === "true");
      res.status(200).json({ quickTest: viewOf(test) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof QuickTestExistsError) return handleKnownError(req, res, startedAt, err);
      // InvalidYamlError, UnsupportedVersionError and the rest go to app.ts's centralized handler,
      // so the status and body are the guided upload's for the same input (FR-002).
      logger.info("quick_performance_upload_failed", { errorCategory: err instanceof Error ? err.name : "unknown" });
      next(err);
    }
  });

  router.get(BASE, (req, res) => {
    const startedAt = logReceived(req);
    try {
      res.status(200).json({ quickTest: viewOf(requireQuickTest()) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  registerLegacyRunRoutes(router, BASE, "quick");
  return router;
}
