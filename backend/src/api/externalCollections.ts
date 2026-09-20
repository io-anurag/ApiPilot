import { Router } from "express";
import type { EnvironmentTier, UploadedCollectionSet } from "@apipilot/shared-domain";
import { upload } from "../uploadMiddleware";
import { reaffirmSession } from "../session/sessionMiddleware";
import { createLogger } from "../logger";
import {
  extractReferencedVariables,
  missingUploadedVariableValues,
  parseUploadedCollection,
  parseUploadedEnvironment,
} from "../externalCollections/uploadedCollectionParsing";
import { findDestructiveRequests } from "../externalCollections/destructiveRequests";
import {
  createUploadedCollection,
  getUploadedCollection,
  listUploadedCollections,
  markUploadedCollectionConfirmed,
  removeUploadedCollection,
} from "../externalCollections/uploadedCollectionStore";
import {
  createRun as createUploadedRun,
  getInProgressRun as getUploadedInProgressRun,
  getRun as getUploadedRun,
  listRuns as listUploadedRuns,
  requestCancel as requestUploadedCancel,
} from "../externalCollections/uploadedCollectionExecutionStore";
import { getInProgressRun as getGeneratedInProgressRun } from "../execution/executionRunStore";
import { runUploadedCollectionExecution } from "../externalCollections/runUploadedCollectionExecution";
import {
  DuplicateNameError,
  InvalidCollectionError,
  InvalidEnvironmentError,
  NoRunInProgressError,
  RunNotFoundError,
  UploadedCollectionNotFoundError,
} from "../externalCollections/errors";

const logger = createLogger("api.externalCollections");

const VALID_TIERS: EnvironmentTier[] = ["local", "dev", "qa", "staging", "production"];

function isValidTier(value: unknown): value is EnvironmentTier {
  return typeof value === "string" && (VALID_TIERS as string[]).includes(value);
}

/** Never includes `variableValues` or the raw `collection` body (contract, mirrors `Environment`'s own create/list response). */
function toSummary(uploadedCollection: UploadedCollectionSet) {
  const { id, name, tier, requestDelayMs, confirmedAt, createdAt } = uploadedCollection;
  return { id, name, tier, requestDelayMs, confirmedAt, createdAt };
}

function logRequestReceived(method: string, path: string): number {
  logger.info("request_received", { method, path });
  return Date.now();
}

function logRequestSucceeded(method: string, path: string, startedAt: number, statusCode: number): void {
  logger.info("request_succeeded", { method, path, statusCode, durationMs: Date.now() - startedAt });
}

function logRequestFailed(
  method: string,
  path: string,
  startedAt: number,
  statusCode: number,
  errorCategory: string,
): void {
  logger.error("request_failed", { method, path, statusCode, errorCategory, durationMs: Date.now() - startedAt });
}

/**
 * Standalone route family for AP-026 (specs/026-external-collection-execution): uploading and
 * running an externally-authored Postman collection/environment pair. Mounted independently of
 * `/api/test-generation-workflow/*` (FR-011) — no active `TestGenerationWorkflow` is required.
 */
export function createExternalCollectionsRouter(): Router {
  const router = Router();

  router.post(
    "/external-collections",
    upload.fields([{ name: "collection", maxCount: 1 }, { name: "environment", maxCount: 1 }]),
    reaffirmSession,
    (req, res) => {
      const startedAt = logRequestReceived(req.method, req.path);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const collectionFile = files?.collection?.[0];
      const environmentFile = files?.environment?.[0];
      const body = req.body as Record<string, unknown> | undefined;

      if (typeof body?.name !== "string" || body.name.length === 0 || !isValidTier(body?.tier) || !collectionFile || !environmentFile) {
        logRequestFailed(req.method, req.path, startedAt, 400, "invalid_request");
        res.status(400).json({
          error: "invalid_request",
          message: "Request must include 'name', a valid 'tier', a 'collection' file, and an 'environment' file",
        });
        return;
      }
      const requestDelayMs =
        typeof body.requestDelayMs === "string" ? Number.parseInt(body.requestDelayMs, 10) : 0;

      try {
        parseUploadedCollection(collectionFile.buffer.toString("utf-8"));
      } catch (err) {
        if (err instanceof InvalidCollectionError) {
          logRequestFailed(req.method, req.path, startedAt, 400, "invalid_collection");
          res.status(400).json({ error: "invalid_collection", message: err.message });
          return;
        }
        throw err;
      }

      let variableValues: Record<string, string>;
      try {
        const values = parseUploadedEnvironment(environmentFile.buffer.toString("utf-8"));
        variableValues = Object.fromEntries(
          values.filter((value) => value.enabled).map((value) => [value.key, value.value]),
        );
      } catch (err) {
        if (err instanceof InvalidEnvironmentError) {
          logRequestFailed(req.method, req.path, startedAt, 400, "invalid_environment");
          res.status(400).json({ error: "invalid_environment", message: err.message });
          return;
        }
        throw err;
      }

      try {
        const uploadedCollection = createUploadedCollection({
          name: body.name,
          tier: body.tier,
          collection: collectionFile.buffer.toString("utf-8"),
          variableValues,
          requestDelayMs: Number.isFinite(requestDelayMs) && requestDelayMs > 0 ? requestDelayMs : 0,
        });
        res.status(201).json({ uploadedCollection: toSummary(uploadedCollection) });
        logRequestSucceeded(req.method, req.path, startedAt, 201);
      } catch (err) {
        if (err instanceof DuplicateNameError) {
          logRequestFailed(req.method, req.path, startedAt, 409, "duplicate_name");
          res.status(409).json({ error: "duplicate_name", message: err.message });
          return;
        }
        throw err;
      }
    },
  );

  router.get("/external-collections", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    res.status(200).json({ uploadedCollections: listUploadedCollections().map(toSummary) });
    logRequestSucceeded(req.method, req.path, startedAt, 200);
  });

  router.delete("/external-collections/:id", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    try {
      removeUploadedCollection(req.params.id);
      res.status(204).send();
      logRequestSucceeded(req.method, req.path, startedAt, 204);
    } catch (err) {
      if (err instanceof UploadedCollectionNotFoundError) {
        logRequestFailed(req.method, req.path, startedAt, 404, "uploaded_collection_not_found");
        res.status(404).json({ error: "uploaded_collection_not_found", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/external-collections/:id/execution/start", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    const confirmed = (req.body as Record<string, unknown> | undefined)?.confirmed === true;
    try {
      const uploadedCollection = getUploadedCollection(req.params.id);

      // FR-015 (research.md D7): the slot is shared across both run kinds.
      const inProgress = getUploadedInProgressRun() ?? getGeneratedInProgressRun();
      if (inProgress) {
        logRequestFailed(req.method, req.path, startedAt, 409, "execution_in_progress");
        res.status(409).json({
          error: "execution_in_progress",
          message: "An execution run is already in progress.",
          runId: inProgress.id,
        });
        return;
      }

      const collection = parseUploadedCollection(uploadedCollection.collection);
      const missing = missingUploadedVariableValues(
        extractReferencedVariables(collection),
        uploadedCollection.variableValues,
      );
      if (missing.length > 0) {
        logRequestFailed(req.method, req.path, startedAt, 400, "missing_variable_values");
        res.status(400).json({
          error: "missing_variable_values",
          message: `The uploaded environment does not supply a value for: ${missing.join(", ")}.`,
          missing,
        });
        return;
      }

      // Gate 1 (FR-007) — evaluated only while never-before confirmed; permanently satisfied once
      // accepted. Deliberately does NOT let this same `confirmed:true` also satisfy gate 2 below
      // (research.md D10) — a brand-new upload against a risky tier requires two separate
      // confirmed resubmissions, one per gate.
      if (!uploadedCollection.confirmedAt) {
        if (!confirmed) {
          logRequestFailed(req.method, req.path, startedAt, 409, "unverified_content_confirmation_required");
          res.status(409).json({
            error: "unverified_content_confirmation_required",
            message:
              "This collection's requests and any embedded pre-request/test scripts have never " +
              "been confirmed. They were not generated or verified by ApiPilot and will execute " +
              "exactly as authored.",
          });
          return;
        }
        markUploadedCollectionConfirmed(uploadedCollection.id);
        const requirement = buildConfirmationRequirement(collection, uploadedCollection.tier);
        if (requirement) {
          logRequestFailed(req.method, req.path, startedAt, 409, "confirmation_required");
          res.status(409).json({
            error: "confirmation_required",
            message: "This execution requires explicit confirmation before it can start.",
            environmentTier: requirement.environmentTier,
            destructiveOperations: requirement.destructiveOperations,
          });
          return;
        }
      } else {
        // Gate 2 (FR-013) — evaluated every run start, exactly like the existing generated-collection behavior.
        const requirement = buildConfirmationRequirement(collection, uploadedCollection.tier);
        if (requirement && !confirmed) {
          logRequestFailed(req.method, req.path, startedAt, 409, "confirmation_required");
          res.status(409).json({
            error: "confirmation_required",
            message: "This execution requires explicit confirmation before it can start.",
            environmentTier: requirement.environmentTier,
            destructiveOperations: requirement.destructiveOperations,
          });
          return;
        }
      }

      const run = createUploadedRun({
        uploadedCollectionSetId: uploadedCollection.id,
        uploadedCollectionSnapshot: { name: uploadedCollection.name, tier: uploadedCollection.tier },
      });

      // Fire-and-poll (mirrors execution/start's identical rationale): the run continues after
      // this response is sent; runUploadedCollectionExecution() never rejects (it settles the run
      // defensively on any internal failure), so this .catch() is a defensive backstop only.
      runUploadedCollectionExecution({ runId: run.id, uploadedCollection }).catch((error) => {
        logger.error("uploaded_collection_execution_run_unhandled_error", {
          runId: run.id,
          errorCategory: error instanceof Error ? error.name : "unknown_error",
        });
      });

      res.status(200).json({ run });
      logRequestSucceeded(req.method, req.path, startedAt, 200);
    } catch (err) {
      if (err instanceof UploadedCollectionNotFoundError) {
        logRequestFailed(req.method, req.path, startedAt, 404, "uploaded_collection_not_found");
        res.status(404).json({ error: "uploaded_collection_not_found", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/external-collections/:id/execution/cancel", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    try {
      const inProgress = getUploadedInProgressRun();
      if (!inProgress) {
        throw new NoRunInProgressError();
      }
      const run = requestUploadedCancel(inProgress.id);
      res.status(202).json({ run });
      logRequestSucceeded(req.method, req.path, startedAt, 202);
    } catch (err) {
      if (err instanceof NoRunInProgressError) {
        logRequestFailed(req.method, req.path, startedAt, 409, "no_run_in_progress");
        res.status(409).json({ error: "no_run_in_progress", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/external-collections/:id/execution/runs", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    const runs = listUploadedRuns()
      .filter((run) => run.uploadedCollectionSetId === req.params.id)
      .map(({ results: _results, ...summary }) => summary);
    res.status(200).json({ runs });
    logRequestSucceeded(req.method, req.path, startedAt, 200);
  });

  router.get("/external-collections/:id/execution/runs/:runId", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    try {
      // Deliberately does not require the owning `UploadedCollectionSet` to still exist — a run's
      // own record must remain retrievable after its source is removed (FR-017, quickstart.md
      // Scenario 6).
      const run = getUploadedRun(req.params.runId);
      res.status(200).json({ run });
      logRequestSucceeded(req.method, req.path, startedAt, 200);
    } catch (err) {
      if (err instanceof RunNotFoundError) {
        logRequestFailed(req.method, req.path, startedAt, 404, "run_not_found");
        res.status(404).json({ error: "run_not_found", message: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}

function buildConfirmationRequirement(
  collection: ReturnType<typeof parseUploadedCollection>,
  tier: EnvironmentTier,
): { environmentTier: EnvironmentTier; destructiveOperations: ReturnType<typeof findDestructiveRequests> } | undefined {
  const destructive = findDestructiveRequests(collection);
  const highRiskTier = tier === "staging" || tier === "production";
  if (!highRiskTier && destructive.length === 0) return undefined;
  return { environmentTier: tier, destructiveOperations: destructive };
}

/** Default router instance. */
export const externalCollectionsRouter = createExternalCollectionsRouter();
