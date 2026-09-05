import { Router } from "express";
import type { ApiModel } from "@apipilot/shared-domain";
import { generateTestModel } from "../testDesign/generateTestModel";
import { createLogger } from "../logger";

const logger = createLogger("api.testModels");

/** POST /test-models: runs the deterministic test designer over a supplied ApiModel and returns the resulting TestModel. */
export const testModelsRouter = Router();

function isValidApiModel(value: unknown): value is ApiModel {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Record<string, unknown>;
  const summary = model.summary as Record<string, unknown> | null | undefined;
  return (
    Array.isArray(model.operations) &&
    typeof model.securitySchemes === "object" &&
    model.securitySchemes !== null &&
    typeof summary === "object" &&
    summary !== null &&
    Array.isArray(summary.issues)
  );
}

testModelsRouter
  .route("/test-models")
  .post((req, res) => {
    const startedAt = Date.now();
    logger.info("request_received", { method: req.method, path: req.path });
    const apiModel = (req.body as Record<string, unknown> | undefined)?.apiModel;
    if (!isValidApiModel(apiModel)) {
      logger.error("request_failed", {
        method: req.method,
        path: req.path,
        statusCode: 400,
        errorCategory: "invalid_api_model",
        durationMs: Date.now() - startedAt,
      });
      res.status(400).json({
        error: "invalid_api_model",
        message: "The request body must include a valid 'apiModel' with an 'operations' array",
      });
      return;
    }
    const testModel = generateTestModel(apiModel);
    res.status(200).json({ testModel });
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
