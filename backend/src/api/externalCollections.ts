import { Router } from "express";
import type { EnvironmentTier, UploadedCollectionSet } from "@apipilot/shared-domain";
import { upload } from "../uploadMiddleware";
import { reaffirmSession } from "../session/sessionMiddleware";
import { createLogger } from "../logger";
import {
  extractReferencedVariables,
  missingUploadedVariableValues,
  parseStoredCollection,
  parseUploadedCollection,
  parseUploadedEnvironment,
} from "../externalCollections/uploadedCollectionParsing";
import { ensureStableIds } from "../externalCollections/itemIdentity";
import { findDestructiveRequests } from "../externalCollections/destructiveRequests";
import {
  createUploadedCollection,
  getUploadedCollection,
  listUploadedCollections,
  markUploadedCollectionConfirmed,
  removeUploadedCollection,
  updateUploadedCollectionBody,
  updateUploadedCollectionVariables,
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
import { buildCollectionView } from "../externalCollections/collectionView";
import { applyRequestOverride } from "../externalCollections/requestOverride";
import { addFolder, addRequest, deleteItem, renameItem, reorderContainer } from "../externalCollections/collectionStructure";
import { assertCollectionNotRunning } from "../externalCollections/runLock";
import {
  CollectionLockedError,
  DuplicateNameError,
  FolderNotFoundError,
  InvalidCollectionError,
  InvalidEnvironmentError,
  InvalidOrderError,
  ItemNotFoundError,
  NoRunInProgressError,
  RequestNotFoundError,
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

      // Backfills a stable id on every request/folder (AP-028 research.md D2, D9) so every later
      // collection-editor operation (variable/field/structural edits) has a stable identity to
      // address from the moment a collection is stored — whether uploaded directly here or handed
      // off from the guided workflow, which reaches this same endpoint (research.md D1).
      let collectionWithStableIds: string;
      try {
        collectionWithStableIds = ensureStableIds(parseUploadedCollection(collectionFile.buffer.toString("utf-8")));
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
          collection: collectionWithStableIds,
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

  router.get("/external-collections/:id/collection", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    try {
      const uploadedCollection = getUploadedCollection(req.params.id);
      const collection = parseStoredCollection(uploadedCollection.collection);
      const collectionView = buildCollectionView(
        uploadedCollection.id,
        collection,
        uploadedCollection.collection,
        uploadedCollection.variableValues,
      );
      res.status(200).json({ collectionView });
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

  router.put("/external-collections/:id/variables", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    try {
      const existing = getUploadedCollection(req.params.id);
      assertCollectionNotRunning(existing.id);
      const body = req.body as Record<string, unknown> | undefined;
      const variableValues =
        typeof body?.variableValues === "object" && body.variableValues !== null
          ? (body.variableValues as Record<string, string>)
          : undefined;
      if (!variableValues) {
        logRequestFailed(req.method, req.path, startedAt, 400, "invalid_request");
        res.status(400).json({ error: "invalid_request", message: "Request must include a 'variableValues' object" });
        return;
      }
      updateUploadedCollectionVariables(existing.id, variableValues);
      respondWithFreshView(res, existing.id);
      logRequestSucceeded(req.method, req.path, startedAt, 200);
    } catch (err) {
      if (handleMutationError(err, req, res, startedAt)) return;
      throw err;
    }
  });

  /**
   * Shared error mapping for every AP-028 collection-mutation route below — each throws one of
   * this fixed set of errors; returns `true` once a response has been sent.
   */
  function handleMutationError(err: unknown, req: import("express").Request, res: import("express").Response, startedAt: number): boolean {
    if (err instanceof UploadedCollectionNotFoundError) {
      logRequestFailed(req.method, req.path, startedAt, 404, "uploaded_collection_not_found");
      res.status(404).json({ error: "uploaded_collection_not_found", message: err.message });
      return true;
    }
    if (err instanceof CollectionLockedError) {
      logRequestFailed(req.method, req.path, startedAt, 409, "collection_locked");
      res.status(409).json({ error: "collection_locked", message: err.message });
      return true;
    }
    if (err instanceof RequestNotFoundError) {
      logRequestFailed(req.method, req.path, startedAt, 404, "request_not_found");
      res.status(404).json({ error: "request_not_found", message: err.message });
      return true;
    }
    if (err instanceof ItemNotFoundError) {
      logRequestFailed(req.method, req.path, startedAt, 404, "item_not_found");
      res.status(404).json({ error: "item_not_found", message: err.message });
      return true;
    }
    if (err instanceof FolderNotFoundError) {
      logRequestFailed(req.method, req.path, startedAt, 404, "folder_not_found");
      res.status(404).json({ error: "folder_not_found", message: err.message });
      return true;
    }
    if (err instanceof InvalidOrderError) {
      logRequestFailed(req.method, req.path, startedAt, 400, "invalid_order");
      res.status(400).json({ error: "invalid_order", message: err.message });
      return true;
    }
    return false;
  }

  /** Re-parses and rebuilds the view for a just-mutated collection, for a mutation route's response. */
  function respondWithFreshView(res: import("express").Response, id: string): void {
    const updated = getUploadedCollection(id);
    const collection = parseStoredCollection(updated.collection);
    const collectionView = buildCollectionView(updated.id, collection, updated.collection, updated.variableValues);
    res.status(200).json({ collectionView });
  }

  router.put("/external-collections/:id/requests/:requestId", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    try {
      const existing = getUploadedCollection(req.params.id);
      assertCollectionNotRunning(existing.id);
      const body = req.body as Record<string, unknown> | undefined;
      if (typeof body?.method !== "string" || body.method.length === 0 || typeof body?.url !== "string" || body.url.length === 0) {
        logRequestFailed(req.method, req.path, startedAt, 400, "invalid_request");
        res.status(400).json({ error: "invalid_request", message: "Request must include a non-empty 'method' and 'url'" });
        return;
      }
      const headers = Array.isArray(body.headers) ? (body.headers as Array<{ key: string; value: string }>) : [];
      const collection = parseStoredCollection(existing.collection);
      const updatedCollectionJson = applyRequestOverride(collection, req.params.requestId, {
        method: body.method,
        url: body.url,
        headers,
        body: typeof body.body === "string" ? body.body : undefined,
        testScript: typeof body.testScript === "string" ? body.testScript : undefined,
      });
      updateUploadedCollectionBody(existing.id, updatedCollectionJson);
      respondWithFreshView(res, existing.id);
      logRequestSucceeded(req.method, req.path, startedAt, 200);
    } catch (err) {
      if (handleMutationError(err, req, res, startedAt)) return;
      throw err;
    }
  });

  router.post("/external-collections/:id/items", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    try {
      const existing = getUploadedCollection(req.params.id);
      assertCollectionNotRunning(existing.id);
      const body = req.body as Record<string, unknown> | undefined;
      // `kind: "folder"` is additive (default "request" preserves the original contract exactly)
      // and only ever needs a name — a folder has no method/URL/headers/body of its own.
      const kind = body?.kind === "folder" ? "folder" : "request";
      if (typeof body?.name !== "string" || body.name.length === 0) {
        logRequestFailed(req.method, req.path, startedAt, 400, "invalid_request");
        res.status(400).json({ error: "invalid_request", message: "Request must include a non-empty 'name'" });
        return;
      }
      if (kind === "request" && (typeof body?.method !== "string" || body.method.length === 0 || typeof body?.url !== "string")) {
        logRequestFailed(req.method, req.path, startedAt, 400, "invalid_request");
        res.status(400).json({ error: "invalid_request", message: "Request must include a non-empty 'name', 'method', and 'url'" });
        return;
      }
      const parentFolderId = typeof body.parentFolderId === "string" ? body.parentFolderId : null;
      const collection = parseStoredCollection(existing.collection);
      const { newItemId } =
        kind === "folder"
          ? addFolder(collection, parentFolderId, body.name)
          : addRequest(collection, parentFolderId, {
              name: body.name,
              method: body.method as string,
              url: body.url as string,
              headers: Array.isArray(body.headers) ? (body.headers as Array<{ key: string; value: string }>) : [],
              body: typeof body.body === "string" ? body.body : undefined,
            });
      updateUploadedCollectionBody(existing.id, JSON.stringify(collection.toJSON()));
      const updated = getUploadedCollection(existing.id);
      const rebuilt = parseStoredCollection(updated.collection);
      const collectionView = buildCollectionView(updated.id, rebuilt, updated.collection, updated.variableValues);
      res.status(201).json({ collectionView, newItemId });
      logRequestSucceeded(req.method, req.path, startedAt, 201);
    } catch (err) {
      if (handleMutationError(err, req, res, startedAt)) return;
      throw err;
    }
  });

  router.delete("/external-collections/:id/items/:itemId", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    try {
      const existing = getUploadedCollection(req.params.id);
      assertCollectionNotRunning(existing.id);
      const collection = parseStoredCollection(existing.collection);
      deleteItem(collection, req.params.itemId);
      updateUploadedCollectionBody(existing.id, JSON.stringify(collection.toJSON()));
      respondWithFreshView(res, existing.id);
      logRequestSucceeded(req.method, req.path, startedAt, 200);
    } catch (err) {
      if (handleMutationError(err, req, res, startedAt)) return;
      throw err;
    }
  });

  router.put("/external-collections/:id/items/:itemId/rename", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    try {
      const existing = getUploadedCollection(req.params.id);
      assertCollectionNotRunning(existing.id);
      const body = req.body as Record<string, unknown> | undefined;
      if (typeof body?.name !== "string" || body.name.length === 0) {
        logRequestFailed(req.method, req.path, startedAt, 400, "invalid_request");
        res.status(400).json({ error: "invalid_request", message: "Request must include a non-empty 'name'" });
        return;
      }
      const collection = parseStoredCollection(existing.collection);
      renameItem(collection, req.params.itemId, body.name);
      updateUploadedCollectionBody(existing.id, JSON.stringify(collection.toJSON()));
      respondWithFreshView(res, existing.id);
      logRequestSucceeded(req.method, req.path, startedAt, 200);
    } catch (err) {
      if (handleMutationError(err, req, res, startedAt)) return;
      throw err;
    }
  });

  router.put("/external-collections/:id/containers/:containerId/order", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    try {
      const existing = getUploadedCollection(req.params.id);
      assertCollectionNotRunning(existing.id);
      const body = req.body as Record<string, unknown> | undefined;
      if (!Array.isArray(body?.orderedIds)) {
        logRequestFailed(req.method, req.path, startedAt, 400, "invalid_request");
        res.status(400).json({ error: "invalid_request", message: "Request must include an 'orderedIds' array" });
        return;
      }
      const collection = parseStoredCollection(existing.collection);
      reorderContainer(collection, req.params.containerId, body.orderedIds as string[]);
      updateUploadedCollectionBody(existing.id, JSON.stringify(collection.toJSON()));
      respondWithFreshView(res, existing.id);
      logRequestSucceeded(req.method, req.path, startedAt, 200);
    } catch (err) {
      if (handleMutationError(err, req, res, startedAt)) return;
      throw err;
    }
  });

  router.post("/external-collections/:id/execution/start", (req, res) => {
    const startedAt = logRequestReceived(req.method, req.path);
    const requestBody = req.body as Record<string, unknown> | undefined;
    const confirmed = requestBody?.confirmed === true;
    // AP-028 follow-up (Postman-Runner-style selective run): `undefined` runs every request,
    // exactly as before this field existed (additive, backward compatible) — an explicit array
    // narrows the run to that id set, checked against the collection's own item ids below.
    const selectedItemIds = Array.isArray(requestBody?.selectedRequestIds)
      ? new Set((requestBody.selectedRequestIds as unknown[]).filter((id): id is string => typeof id === "string"))
      : undefined;
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

      // AP-028: a collection can be edited down to zero requests after upload (spec.md Edge
      // Cases: "the collection is allowed to become empty"), so this reads leniently and refuses
      // explicitly below rather than letting parseUploadedCollection's upload-time "≥1 request"
      // check throw uncaught here.
      const collection = parseStoredCollection(uploadedCollection.collection);
      let requestItemCount = 0;
      let selectedItemCount = 0;
      collection.forEachItem((item) => {
        requestItemCount += 1;
        if (!selectedItemIds || selectedItemIds.has(item.id)) selectedItemCount += 1;
      });
      if (requestItemCount === 0) {
        logRequestFailed(req.method, req.path, startedAt, 400, "empty_collection");
        res.status(400).json({ error: "empty_collection", message: "This collection has no requests to run." });
        return;
      }
      if (selectedItemIds && selectedItemCount === 0) {
        logRequestFailed(req.method, req.path, startedAt, 400, "no_requests_selected");
        res.status(400).json({ error: "no_requests_selected", message: "Select at least one request to run." });
        return;
      }

      const missing = missingUploadedVariableValues(
        extractReferencedVariables(collection, selectedItemIds),
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
        const requirement = buildConfirmationRequirement(collection, uploadedCollection.tier, selectedItemIds);
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
        const requirement = buildConfirmationRequirement(collection, uploadedCollection.tier, selectedItemIds);
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
      runUploadedCollectionExecution({ runId: run.id, uploadedCollection, selectedItemIds }).catch((error) => {
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
  selectedItemIds?: Set<string>,
): { environmentTier: EnvironmentTier; destructiveOperations: ReturnType<typeof findDestructiveRequests> } | undefined {
  const destructive = findDestructiveRequests(collection, selectedItemIds);
  const highRiskTier = tier === "staging" || tier === "production";
  if (!highRiskTier && destructive.length === 0) return undefined;
  return { environmentTier: tier, destructiveOperations: destructive };
}

/** Default router instance. */
export const externalCollectionsRouter = createExternalCollectionsRouter();
