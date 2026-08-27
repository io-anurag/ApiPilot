import { Router } from "express";
import type { ApiModel } from "@apipilot/shared-domain";
import { generateTestModel } from "../testDesign/generateTestModel";

export const testModelsRouter = Router();

function isValidApiModel(value: unknown): value is ApiModel {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).operations)
  );
}

testModelsRouter
  .route("/test-models")
  .post((req, res) => {
    const apiModel = (req.body as Record<string, unknown> | undefined)?.apiModel;
    if (!isValidApiModel(apiModel)) {
      res.status(400).json({
        error: "invalid_api_model",
        message: "The request body must include a valid 'apiModel' with an 'operations' array",
      });
      return;
    }
    const testModel = generateTestModel(apiModel);
    res.status(200).json({ testModel });
  })
  .all((_req, res) => {
    res.status(405).json({ error: "method_not_allowed" });
  });
