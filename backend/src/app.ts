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
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof InvalidYamlError) {
      res.status(400).json({ error: "invalid_yaml", message: err.message });
      return;
    }
    if (err instanceof UnsupportedVersionError) {
      res.status(400).json({ error: "unsupported_version", message: err.message });
      return;
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "file_too_large",
        message: `Uploaded file exceeds the maximum allowed size of ${MAX_UPLOAD_BYTES} bytes`,
      });
      return;
    }
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { type?: string }).type === "entity.too.large"
    ) {
      res.status(413).json({
        error: "payload_too_large",
        message: `Request body exceeds the maximum allowed size of ${MAX_UPLOAD_BYTES} bytes`,
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("Unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "internal_server_error" });
  };
  app.use(errorHandler);

  return app;
}
