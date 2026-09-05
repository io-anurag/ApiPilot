import { Router } from "express";
import type { ApiModel, TestModel } from "@apipilot/shared-domain";
import { getAIProvider } from "../ai";
import { enhanceTestModel } from "../testDesign/enhanceTestModel";
import { createLogger } from "../logger";

const logger = createLogger("api.enhancedTestModels");

function isEnhancementRequest(
  value: unknown,
): value is { apiModel: ApiModel; testModel: TestModel } {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  const apiModel = body.apiModel as Record<string, unknown> | undefined;
  const testModel = body.testModel as Record<string, unknown> | undefined;
  const summary = apiModel?.summary as Record<string, unknown> | null | undefined;
  return (
    Array.isArray(apiModel?.operations) &&
    typeof apiModel?.securitySchemes === "object" &&
    apiModel.securitySchemes !== null &&
    typeof summary === "object" &&
    summary !== null &&
    Array.isArray(summary.issues) &&
    Array.isArray(testModel?.scenarios)
  );
}

/** Builds the router for POST /test-models/enhance; `provider` defaults to the process-wide AI provider but can be injected (e.g. a fake) for testing. */
export function createEnhancedTestModelsRouter(provider = getAIProvider()) {
  const router = Router();
  router
    .route("/test-models/enhance")
    .post(async (req, res) => {
      const startedAt = Date.now();
      logger.info("request_received", { method: req.method, path: req.path });
      if (!isEnhancementRequest(req.body)) {
        logger.error("request_failed", {
          method: req.method,
          path: req.path,
          statusCode: 400,
          errorCategory: "invalid_test_model_enhancement_request",
          durationMs: Date.now() - startedAt,
        });
        res.status(400).json({
          error: "invalid_test_model_enhancement_request",
          message:
            "Request must include apiModel.operations and testModel.scenarios arrays",
        });
        return;
      }
      const result = await enhanceTestModel(
        req.body.apiModel,
        req.body.testModel,
        provider,
      );
      res.status(200).json(result);
      logger.info("request_succeeded", {
        method: req.method,
        path: req.path,
        statusCode: 200,
        durationMs: Date.now() - startedAt,
      });
    })
    .all((_req, res) => {
      res.status(405).json({ error: "method_not_allowed" });
    });
  return router;
}

/** Default router instance wired to the process-wide AI provider (see `getAIProvider`). */
export const enhancedTestModelsRouter = createEnhancedTestModelsRouter();
