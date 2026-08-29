import { Router } from "express";
import type { AIProvider } from "@apipilot/shared-domain";
import { getAIProvider } from "../ai";

/** Testable factory — accepts any AIProvider so tests can inject a fake without touching env/config. */
export function createAiStatusRouter(provider: AIProvider): Router {
  const router = Router();

  router
    .route("/ai/status")
    .get((_req, res) => {
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
      } catch (error) {
        // Never leak a raw exception (constitution XIX, XX).
        // eslint-disable-next-line no-console
        console.error("Failed to read AI readiness:", error instanceof Error ? error.message : error);
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
