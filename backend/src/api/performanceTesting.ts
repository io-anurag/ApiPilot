import { Router } from "express";
import { registerLegacyRunRoutes } from "./performanceRuns";

export type { PerformanceTestingDependencies } from "./performanceRoutes";

/**
 * The guided workflow's performance runs (AP-029, specs/031-k6-performance-testing). Its plan was
 * retired by AP-037 phase two (specs/037-request-chain-performance FR-036): the Performance Testing
 * stage now seeds request-chain plans, and only the runs recorded before stay readable here.
 */
const BASE = "/test-generation-workflow/performance";

export function createPerformanceTestingRouter(): Router {
  const router = Router();
  registerLegacyRunRoutes(router, BASE, "guided");
  return router;
}
