import { Router } from "express";
import type { QuickPerformanceTestView } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { createQuickTest } from "../performance/quick/createQuickTest";
import { contextFromQuickTest, getQuickTest, updateQuickTest, type QuickPerformanceTest } from "../performance/quick/quickTestStore";
import { QuickTestExistsError } from "../performance/errors";
import { reaffirmSession } from "../session/sessionMiddleware";
import { upload } from "../uploadMiddleware";
import { fail, handleKnownError, logReceived, logSucceeded, PlanSourceUnavailableError } from "./performanceHttp";
import {
  registerPerformanceRoutes,
  scriptStatus,
  type PerformancePlanSource,
  type PerformanceTestingDependencies,
  type PlanHandle,
} from "./performanceRoutes";

const logger = createLogger("api.quickPerformance");

/**
 * AP-032 Quick Performance Test routes (specs/032-quick-performance-test
 * contracts/quick-performance-api.md): a standalone route family, like AP-026's Import & Run, that
 * builds an AP-029 performance plan straight from an uploaded specification. It never reads or
 * changes the session's guided workflow (FR-021). The plan, script and run routes are AP-029's,
 * registered for the quick source (research Q2); a run starts only on `POST /quick-performance/runs`,
 * the user's explicit per-run trigger (constitution XVII exception, extended 2026-09-27).
 */
const BASE = "/quick-performance";

function requireQuickTest(): QuickPerformanceTest {
  const test = getQuickTest();
  if (!test) throw new PlanSourceUnavailableError(404, "quick_test_not_found", "Upload a specification to start a quick performance test.");
  return test;
}

function viewOf(test: QuickPerformanceTest): QuickPerformanceTestView {
  return { specification: test.specification, plan: test.plan, script: scriptStatus(test.plan, test.script) };
}

function quickHandle(): PlanHandle {
  const test = requireQuickTest();
  return {
    context: contextFromQuickTest(test),
    // A quick test's scenarios are fixed at upload, so its plan is never rebuilt from upstream changes.
    plan: () => requireQuickTest().plan,
    savePlan: (plan) => updateQuickTest({ plan }),
    script: () => requireQuickTest().script,
    saveScript: (script) => updateQuickTest({ script }),
    onPlanChanged: () => undefined,
    onPlanReset: () => undefined,
    onScriptGenerated: () => undefined,
  };
}

const quickSource: PerformancePlanSource = { kind: "quick", require: quickHandle };

export function createQuickPerformanceRouter(dependencies: PerformanceTestingDependencies): Router {
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

  registerPerformanceRoutes(router, BASE, quickSource, dependencies);
  return router;
}
