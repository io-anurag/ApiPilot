import { Router } from "express";
import { createHealthStatus } from "@apipilot/shared-domain";

export const healthRouter = Router();

healthRouter
  .route("/health")
  .get((_req, res) => {
    res.status(200).json(createHealthStatus());
  })
  .all((_req, res) => {
    res.status(405).json({ error: "method_not_allowed" });
  });
