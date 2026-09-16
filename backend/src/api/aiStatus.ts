import { Router } from "express";
import type { AIProvider } from "@apipilot/shared-domain";
import { getAIProvider } from "../ai";
import { createLogger } from "../logger";
import { getAiDiagnosticsRepository } from "../persistence/aiDiagnosticsRepository";

const logger = createLogger("api.aiStatus");

/** Testable factory — accepts any AIProvider so tests can inject a fake without touching env/config. */
export function createAiStatusRouter(provider: AIProvider): Router {
  const router = Router();

  router
    .route("/ai/status")
    .get((req, res) => {
      const startedAt = Date.now();
      logger.info("request_received", { method: req.method, path: req.path });
      try {
        const readiness = provider.getReadiness();
        const diagnostics = getAiDiagnosticsRepository();
        const lastKnownReadiness = diagnostics.getLastKnownReadiness();
        const latestBenchmarkRun = diagnostics.getLatestBenchmarkRun();
        res.status(200).json({
          state: readiness.state,
          modelId: readiness.modelId ?? null,
          provider: provider.mode,
          acceleratorRequested: readiness.acceleratorRequested,
          acceleratorActive: readiness.acceleratorActive,
          reason: readiness.reason ?? null,
          updatedAt: readiness.updatedAt,
          // Historical/diagnostic only (specs/025-local-persistence-layer) — never a substitute
          // for the live `state` above, which always reflects a real load attempt in this
          // process (research.md D5).
          lastKnownReadiness: lastKnownReadiness
            ? {
                state: lastKnownReadiness.state,
                reason: lastKnownReadiness.reason ?? null,
                modelId: lastKnownReadiness.modelId ?? null,
                updatedAt: lastKnownReadiness.updatedAt,
              }
            : null,
          latestBenchmarkRun: latestBenchmarkRun
            ? {
                runAt: latestBenchmarkRun.runAt,
                selectedModelId: latestBenchmarkRun.selectedModelId,
                selectionRationale: latestBenchmarkRun.selectionRationale,
              }
            : null,
        });
        logger.info("request_succeeded", {
          method: req.method,
          path: req.path,
          statusCode: 200,
          durationMs: Date.now() - startedAt,
        });
      } catch {
        // Never leak a raw exception (constitution XIX, XX).
        logger.error("request_failed", {
          method: req.method,
          path: req.path,
          statusCode: 500,
          errorCategory: "internal_server_error",
          durationMs: Date.now() - startedAt,
        });
        res.status(500).json({ error: "internal_server_error" });
      }
    })
    .all((_req, res) => {
      res.status(405).json({ error: "method_not_allowed" });
    });

  return router;
}

/** GET /api/ai/status wired to the process-wide active provider (see api/aiStatus contract). */
export const aiStatusRouter = createAiStatusRouter(getAIProvider());
