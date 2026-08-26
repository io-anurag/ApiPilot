import { Router } from "express";
import { createVersionInfo } from "@apipilot/shared-domain";

export const versionRouter = Router();

// Static for now — no build-time git metadata injection exists yet at this stage.
const APP_VERSION = "0.1.0";
const APP_COMMIT = "unknown";

versionRouter.get("/version", (_req, res) => {
  res.status(200).json(createVersionInfo(APP_VERSION, APP_COMMIT));
});
