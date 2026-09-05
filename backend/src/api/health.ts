import { Router } from "express";
import { createHealthStatus } from "@apipilot/shared-domain";
import { createLogger } from "../logger";

const logger = createLogger("api.health");

/** Liveness probe: reports process health status; takes no request body or query parameters. */
export const healthRouter = Router();

healthRouter
  .route("/health")
  .get((req, res) => {
    const startedAt = Date.now();
    logger.info("request_received", { method: req.method, path: req.path });
    res.status(200).json(createHealthStatus());
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
