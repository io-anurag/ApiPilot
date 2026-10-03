import { Router } from "express";
import { registerLegacyRunRoutes } from "./performanceRuns";

/**
 * AP-036 performance tests from a Postman collection (specs/036-collection-performance-test). Its
 * collection plan was retired by AP-037 phase two (specs/037-request-chain-performance FR-036): a
 * stored collection now seeds a request-chain plan (`POST /api/chain-plans/seed`). Only the runs
 * recorded from collection plans before stay readable here (FR-037).
 */
const BASE = "/collection-performance";

export function createCollectionPerformanceRouter(): Router {
  const router = Router();
  registerLegacyRunRoutes(router, BASE, "collection");
  return router;
}
