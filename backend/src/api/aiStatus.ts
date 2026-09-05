import { Router } from "express";
import type { AIProvider } from "@apipilot/shared-domain";
import { getAIProvider } from "../ai";
import { createLogger } from "../logger";

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
        res.status(200).json({
          state: readiness.state,
          modelId: readiness.modelId ?? null,
          provider: provider.mode,
          acceleratorRequested: readiness.acceleratorRequested,
          acceleratorActive: readiness.acceleratorActive,
          reason: readiness.reason ?? null,
          updatedAt: readiness.updatedAt,
        });
        logger.info("request_succeeded", {
          method: req.method,
          path: req.path,
          statusCode: 200,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
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
