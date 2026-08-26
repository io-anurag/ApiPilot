import express, { type ErrorRequestHandler } from "express";
import { healthRouter } from "./api/health";
import { versionRouter } from "./api/version";

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use("/api", healthRouter);
  app.use("/api", versionRouter);

  // Centralized error-handling middleware (constitution XIX, Fail Safely):
  // never leak stack traces, always respond with a safe JSON shape.
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // eslint-disable-next-line no-console
    console.error("Unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "internal_server_error" });
  };
  app.use(errorHandler);

  return app;
}
