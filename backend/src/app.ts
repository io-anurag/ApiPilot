import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { aiStatusRouter } from "./api/aiStatus";
import { healthRouter } from "./api/health";
import { specificationsRouter } from "./api/specifications";
import { testModelsRouter } from "./api/testModels";
import { versionRouter } from "./api/version";
import { InvalidYamlError, UnsupportedVersionError } from "./openapi/errors";
import { MAX_UPLOAD_BYTES } from "./uploadMiddleware";

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use("/api", healthRouter);
  app.use("/api", versionRouter);
  app.use("/api", specificationsRouter);
  app.use("/api", testModelsRouter);
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
    // eslint-disable-next-line no-console
    console.error("Unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "internal_server_error" });
  };
  app.use(errorHandler);

  return app;
}
