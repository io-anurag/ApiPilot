import { Router } from "express";
import type { ApiModel, TestModel } from "@apipilot/shared-domain";
import { getAIProvider } from "../ai";
import { enhanceTestModel } from "../testDesign/enhanceTestModel";

function isEnhancementRequest(
  value: unknown,
): value is { apiModel: ApiModel; testModel: TestModel } {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  const apiModel = body.apiModel as Record<string, unknown> | undefined;
  const testModel = body.testModel as Record<string, unknown> | undefined;
  return Array.isArray(apiModel?.operations) && Array.isArray(testModel?.scenarios);
}

export function createEnhancedTestModelsRouter(provider = getAIProvider()) {
  const router = Router();
  router
    .route("/test-models/enhance")
    .post(async (req, res) => {
      if (!isEnhancementRequest(req.body)) {
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
    })
    .all((_req, res) => {
      res.status(405).json({ error: "method_not_allowed" });
    });
  return router;
}

export const enhancedTestModelsRouter = createEnhancedTestModelsRouter();
