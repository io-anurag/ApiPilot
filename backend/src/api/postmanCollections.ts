import { Router } from "express";
import type { ApiModel, ExportFailureCode, ExportOptions, TestModel } from "@apipilot/shared-domain";
import { generateCollection } from "../postman/generateCollection";
import { createLogger } from "../logger";

const logger = createLogger("api.postmanCollections");

/**
 * Stateless export boundary (contracts/postman-collection-api.md). The route adapts and
 * validates the request shape, delegates the whole transformation to the generator, and maps
 * refusals to status codes. It holds no generation logic and persists nothing (FR-024).
 */

const FAILURE_STATUS: Record<ExportFailureCode, number> = {
  empty_approved_test_model: 400,
  unknown_operation: 400,
  unknown_variable: 400,
  workflow_intent_unsupported: 400,
  collection_validation_failed: 500,
};

function isApiModel(value: unknown): value is ApiModel {
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

function isTestModel(value: unknown): value is TestModel {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).scenarios)
  );
}

function isExportOptions(value: unknown): value is ExportOptions | undefined {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const options = value as Record<string, unknown>;
  if (options.baseUrl !== undefined && typeof options.baseUrl !== "string") return false;
  if (options.collectionName !== undefined && typeof options.collectionName !== "string") {
    return false;
  }
  if (options.variableValues === undefined) return true;
  if (typeof options.variableValues !== "object" || options.variableValues === null) return false;
  return Object.values(options.variableValues as Record<string, unknown>).every(
    (entry) => typeof entry === "string",
  );
}

interface ExportRequestBody {
  apiModel: ApiModel;
  testModel: TestModel;
  options?: ExportOptions;
}

function isExportRequestBody(value: unknown): value is ExportRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return isApiModel(body.apiModel) && isTestModel(body.testModel) && isExportOptions(body.options);
}

/** Builds the router for POST /test-models/postman-collection, the stateless Postman export endpoint. */
export function createPostmanCollectionsRouter() {
  const router = Router();

  router
    .route("/test-models/postman-collection")
    .post((req, res) => {
      const startedAt = Date.now();
      logger.info("request_received", { method: req.method, path: req.path });
      if (!isExportRequestBody(req.body)) {
        logger.error("request_failed", {
          method: req.method,
          path: req.path,
          statusCode: 400,
          errorCategory: "invalid_request",
          durationMs: Date.now() - startedAt,
        });
        res.status(400).json({
          error: "invalid_request",
          message:
            "Request must include apiModel.operations, testModel.scenarios, and, when present, string-valued options",
        });
        return;
      }

      const outcome = generateCollection(req.body.apiModel, req.body.testModel, req.body.options);
      if (!outcome.ok) {
        const { code, message, problems } = outcome.failure;
        logger.error("request_failed", {
          method: req.method,
          path: req.path,
          statusCode: FAILURE_STATUS[code],
          errorCategory: code,
          durationMs: Date.now() - startedAt,
        });
        res.status(FAILURE_STATUS[code]).json({
          error: code,
          message,
          ...(problems ? { problems } : {}),
        });
        return;
      }

      res.status(200).json(outcome.result);
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

/** Default router instance (this endpoint takes no AI provider — export is deterministic). */
export const postmanCollectionsRouter = createPostmanCollectionsRouter();