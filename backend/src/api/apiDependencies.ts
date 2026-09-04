import { Router } from "express";
import type { AIProvider, ApiModel } from "@apipilot/shared-domain";
import {
  analyzeDependencies,
  DependencyAnalysisTimeoutError,
} from "../dependencies/analyzeDependencies";

function isDependencyAnalysisRequest(value: unknown): value is { apiModel: ApiModel } {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  const apiModel = body.apiModel as Record<string, unknown> | undefined;
  const summary = apiModel?.summary as Record<string, unknown> | null | undefined;
  return (
    Array.isArray(apiModel?.operations) &&
    typeof apiModel?.securitySchemes === "object" &&
    apiModel.securitySchemes !== null &&
    typeof summary === "object" &&
    summary !== null &&
    Array.isArray(summary.issues)
  );
}

/** `provider` is only supplied when the caller wants the AI-assisted pass attempted (FR-005, FR-018). */
export function createApiDependenciesRouter(provider?: AIProvider) {
  const router = Router();
  router
    .route("/api-models/dependencies")
    .post(async (req, res) => {
      if (!isDependencyAnalysisRequest(req.body)) {
        res.status(400).json({
          error: "invalid_request",
          message:
            "Request must include apiModel.operations, apiModel.securitySchemes, and apiModel.summary.issues",
        });
        return;
      }
      try {
        const result = await analyzeDependencies(req.body.apiModel, provider);
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof DependencyAnalysisTimeoutError) {
          res.status(500).json({ error: "analysis_timeout", message: error.message });
          return;
        }
        throw error;
      }
    })
    .all((_req, res) => {
      res.status(405).json({ error: "method_not_allowed" });
    });
  return router;
}

export const apiDependenciesRouter = createApiDependenciesRouter();
