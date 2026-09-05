import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { aiStatusRouter } from "./api/aiStatus";
import { healthRouter } from "./api/health";
import { specificationsRouter } from "./api/specifications";
import { testModelsRouter } from "./api/testModels";
import {
  createEnhancedTestModelsRouter,
  enhancedTestModelsRouter,
} from "./api/enhancedTestModels";
import {
  createTestScenarioReviewsRouter,
  testScenarioReviewsRouter,
} from "./api/testScenarioReviews";
import type { AIProvider } from "@apipilot/shared-domain";
import { postmanCollectionsRouter } from "./api/postmanCollections";
import { createApiDependenciesRouter, apiDependenciesRouter } from "./api/apiDependencies";
import {
  createTestGenerationWorkflowRouter,
  testGenerationWorkflowRouter,
} from "./api/testGenerationWorkflow";
import { versionRouter } from "./api/version";
import { InvalidYamlError, UnsupportedVersionError } from "./openapi/errors";
import { MAX_UPLOAD_BYTES } from "./uploadMiddleware";
import { createLogger } from "./logger";

const logger = createLogger("api.errorHandler");

/** Assembles the Express app: JSON body parsing sized to the upload contract, every `/api` router, and the centralized error handler. `provider` (when supplied) is threaded into the routers that support AI-assisted behavior instead of each using the process-wide default. */
export function createApp(provider?: AIProvider) {
  const app = express();

  // Downstream endpoints (test-model generation/enhancement/review, Postman export) receive
  // the ApiModel/TestModel derived from an uploaded spec as a JSON body. Match express.json's
  // limit to the upload contract (MAX_UPLOAD_BYTES, FR-015) so a spec accepted at upload time
  // is not silently rejected one step later by body-parser's much smaller 100kb default.
  app.use(express.json({ limit: MAX_UPLOAD_BYTES }));
  app.use("/api", healthRouter);
  app.use("/api", versionRouter);
  app.use("/api", specificationsRouter);
  app.use("/api", testModelsRouter);
  app.use(
    "/api",
    provider ? createEnhancedTestModelsRouter(provider) : enhancedTestModelsRouter,
  );
  app.use(
    "/api",
    provider ? createTestScenarioReviewsRouter(provider) : testScenarioReviewsRouter,
  );
  app.use("/api", postmanCollectionsRouter);
  app.use(
    "/api",
    provider ? createApiDependenciesRouter(provider) : apiDependenciesRouter,
  );
  app.use(
    "/api",
    provider ? createTestGenerationWorkflowRouter(provider) : testGenerationWorkflowRouter,
  );
  app.use("/api", aiStatusRouter);

  // Centralized error-handling middleware (constitution XIX, Fail Safely):
  // never leak stack traces, always respond with a safe JSON shape.
  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    let statusCode: number;
    let errorCategory: string;
    let body: Record<string, unknown>;

    if (err instanceof InvalidYamlError) {
      statusCode = 400;
      errorCategory = "invalid_yaml";
      body = { error: "invalid_yaml", message: err.message };
    } else if (err instanceof UnsupportedVersionError) {
      statusCode = 400;
      errorCategory = "unsupported_version";
      body = { error: "unsupported_version", message: err.message };
    } else if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      statusCode = 413;
      errorCategory = "file_too_large";
      body = {
        error: "file_too_large",
        message: `Uploaded file exceeds the maximum allowed size of ${MAX_UPLOAD_BYTES} bytes`,
      };
    } else if (
      typeof err === "object" &&
      err !== null &&
      (err as { type?: string }).type === "entity.too.large"
    ) {
      statusCode = 413;
      errorCategory = "payload_too_large";
      body = {
        error: "payload_too_large",
        message: `Request body exceeds the maximum allowed size of ${MAX_UPLOAD_BYTES} bytes`,
      };
    } else {
      statusCode = 500;
      errorCategory = "internal_server_error";
      body = { error: "internal_server_error" };
    }

    // Server-side only: method/path/statusCode/errorCategory, never the raw error
    // message or stack (constitution XX) — the client response above is unaffected.
    logger.error("unhandled_error", {
      method: req.method,
      path: req.path,
      statusCode,
      errorCategory,
    });

    res.status(statusCode).json(body);
  };
  app.use(errorHandler);

  return app;
}
