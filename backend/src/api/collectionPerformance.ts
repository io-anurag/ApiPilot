import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { CollectionPerformanceTestView, CollectionPlanInfo, CollectionRebuildNotKept, PerformancePlan } from "@apipilot/shared-domain";
import { DuplicateEnvironmentNameError } from "../execution/errors";
import { UploadedCollectionNotFoundError } from "../externalCollections/errors";
import { resolveRunOrder } from "../externalCollections/runOrder";
import { parseStoredCollection } from "../externalCollections/uploadedCollectionParsing";
import { getUploadedCollection } from "../externalCollections/uploadedCollectionStore";
import { createLogger } from "../logger";
import { defaultCollectionChoices, MAX_COLLECTION_STEPS, type CollectionPlanChoices, type CollectionSource } from "../performance/collection/assembleCollectionPlan";
import { assembleFor, choicesFor, collectionEngine } from "../performance/collection/collectionEngine";
import { getCollectionTest, hasCollectionPlan, setCollectionTest, updateCollectionTest, type CollectionPerformanceTest } from "../performance/collection/collectionPlanStore";
import { seedEnvironmentFromCollection } from "../performance/collection/seedEnvironment";
import {
  CollectionDeletedError,
  CollectionPlanExistsError,
  CollectionPlanOutOfDateError,
  ConversionNotReviewedError,
  InvalidPlanUpdateError,
  TooManyCollectionRequestsError,
} from "../performance/errors";
import { sha256Hex } from "../performance/plan/identifiers";
import { fail, handleKnownError, logReceived, logSucceeded, PlanSourceUnavailableError } from "./performanceHttp";
import { registerPerformanceRoutes, scriptStatus, type PerformancePlanSource, type PerformanceTestingDependencies, type PlanHandle } from "./performanceRoutes";

const logger = createLogger("api.collectionPerformance");

/**
 * AP-036 Performance Test from a Postman Collection (specs/036-collection-performance-test
 * contracts/collection-performance-api.md, research R1, R13, R18): a third plan source beside the
 * guided and quick ones. Building a plan reads a collection stored in Import & Run Collection, and
 * never runs a script or sends a request (FR-005). The plan, script and run routes are AP-029's,
 * registered for the `collection` source; a run starts only on `POST /collection-performance/runs`,
 * the engineer's explicit per-run trigger (constitution XVII, as extended for AP-036 on 2026-10-02).
 */
const BASE = "/collection-performance";

function requireCollectionTest(): CollectionPerformanceTest {
  const test = getCollectionTest();
  if (!test) throw new PlanSourceUnavailableError(404, "collection_plan_not_found", "Set up a performance test from a collection in Import & Run Collection first.");
  return test;
}

/** R13: the stored collection's state, recomputed on every read: unchanged, edited, or deleted. */
export function collectionStateOf(test: CollectionPerformanceTest): CollectionPlanInfo["collectionState"] {
  try {
    const stored = getUploadedCollection(test.collection.id);
    return sha256Hex(stored.collection) === sha256Hex(test.snapshot) ? "current" : "changed";
  } catch (error) {
    if (error instanceof UploadedCollectionNotFoundError) return "deleted";
    throw error;
  }
}

/** The plan as read: its `collectionState` derived now. Neither it nor the review is fingerprinted. */
function withState(plan: PerformancePlan, state: CollectionPlanInfo["collectionState"]): PerformancePlan {
  return plan.collection ? { ...plan, collection: { ...plan.collection, collectionState: state } } : plan;
}

function sourceOf(test: CollectionPerformanceTest): CollectionSource {
  return { ...test.collection, json: test.snapshot };
}

function viewOf(test: CollectionPerformanceTest, state = collectionStateOf(test)): CollectionPerformanceTestView {
  return { collection: { ...test.collection, state }, plan: withState(test.plan, state), script: scriptStatus(test.plan, test.script) };
}

function collectionHandle(): PlanHandle {
  const test = requireCollectionTest();
  const state = collectionStateOf(test);
  const gate = (action: "script" | "run") => {
    if (state !== "current") throw new CollectionPlanOutOfDateError(state);
    if (action === "script" && !requireCollectionTest().plan.collection?.review.reviewed) throw new ConversionNotReviewedError();
  };
  return {
    engine: collectionEngine({ source: sourceOf(test), choices: test.choices, state }, () => gate("script")),
    plan: () => withState(requireCollectionTest().plan, state),
    savePlan: (plan) => updateCollectionTest({ plan, choices: choicesFor(plan) ?? requireCollectionTest().choices }),
    script: () => requireCollectionTest().script,
    saveScript: (script) => updateCollectionTest({ script }),
    onPlanChanged: () => undefined,
    onPlanReset: () => undefined,
    onScriptGenerated: () => undefined,
    gate,
  };
}

const collectionSource: PerformancePlanSource = { kind: "collection", require: collectionHandle };

interface BuildRequest {
  collectionId: string;
  orderedRequestIds: unknown[];
  replaceExisting: boolean;
}

function parseBuild(body: unknown): BuildRequest {
  const record = (typeof body === "object" && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  if (typeof record.collectionId !== "string" || record.collectionId.length === 0 || !Array.isArray(record.orderedRequestIds)) {
    throw new InvalidPlanUpdateError("Send the collection's id and its ordered selected request ids.");
  }
  if (record.replaceExisting !== undefined && typeof record.replaceExisting !== "boolean") throw new InvalidPlanUpdateError("replaceExisting must be true or false.");
  return { collectionId: record.collectionId, orderedRequestIds: record.orderedRequestIds, replaceExisting: record.replaceExisting === true };
}

/** R13, contract `POST /collection-performance/rebuild`: the settings a rebuild keeps, and what it could not keep. */
function rebuiltChoices(previous: CollectionPlanChoices, knownIds: ReadonlySet<string>): { choices: CollectionPlanChoices; droppedRequestIds: string[] } {
  const orderedRequestIds = previous.orderedRequestIds.filter((id) => knownIds.has(id));
  const droppedRequestIds = previous.orderedRequestIds.filter((id) => !knownIds.has(id));
  return {
    droppedRequestIds,
    choices: {
      ...defaultCollectionChoices(orderedRequestIds),
      excludedRequestIds: previous.excludedRequestIds.filter((id) => knownIds.has(id)),
      ...(previous.stepOrder ? { stepOrder: previous.stepOrder } : {}),
      expectedStatusCodes: new Map(previous.expectedStatusCodes),
      thinkTimeMs: previous.thinkTimeMs,
      loadProfile: previous.loadProfile,
      thresholds: previous.thresholds,
      addedCaptures: new Map(previous.addedCaptures),
      addedBindings: new Map(previous.addedBindings),
      reviewedConversionDigest: null,
    },
  };
}

function notKeptOf(previous: CollectionPerformanceTest, rebuilt: ReturnType<typeof assembleFor>): CollectionRebuildNotKept[] {
  const before = [...previous.plan.journeys.flatMap((journey) => journey.steps), ...(previous.plan.collection?.credentialRequests ?? []).map((request) => ({ id: request.stepId, collectionRequest: request.request }))];
  const result: CollectionRebuildNotKept[] = [];
  for (const step of before) {
    const now = rebuilt.requests.get(step.id);
    const settings: CollectionRebuildNotKept["settings"] = [];
    if (previous.choices.expectedStatusCodes.has(step.id) && !now) settings.push("expected-statuses");
    const added = previous.choices.addedCaptures.get(step.id) ?? [];
    if (added.some((capture) => !now?.step.captures?.some((kept) => kept.name === capture.name && kept.origin?.kind === "user"))) settings.push("captures");
    const bindings = previous.choices.addedBindings.get(step.id) ?? [];
    if (bindings.some((binding) => !rebuilt.appliedBindings.some((kept) => kept.stepId === step.id && kept.name === binding.name))) settings.push("bindings");
    if (settings.length > 0 && step.collectionRequest) result.push({ stepId: step.id, itemId: step.collectionRequest.itemId, name: step.collectionRequest.name, settings });
  }
  return result;
}

export function createCollectionPerformanceRouter(dependencies: PerformanceTestingDependencies): Router {
  const router = Router();

  router.post(BASE, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const request = parseBuild(req.body);
      const stored = getUploadedCollection(request.collectionId);
      if (request.orderedRequestIds.length > MAX_COLLECTION_STEPS) throw new TooManyCollectionRequestsError(request.orderedRequestIds.length);
      const orderedRequestIds = resolveRunOrder(parseStoredCollection(stored.collection), request.orderedRequestIds);
      if (!orderedRequestIds) throw new InvalidPlanUpdateError("orderedRequestIds must be a list.");
      // FR-025: a session holds one collection plan; replacing it is confirmed first. Runs are kept.
      if (hasCollectionPlan() && !request.replaceExisting) throw new CollectionPlanExistsError();
      const source: CollectionSource = { id: stored.id, name: stored.name, tier: stored.tier, json: stored.collection };
      const choices = defaultCollectionChoices(orderedRequestIds);
      const assembly = assembleFor(source, choices, "current");
      const test: CollectionPerformanceTest = { id: randomUUID(), collection: { id: stored.id, name: stored.name, tier: stored.tier }, snapshot: stored.collection, choices, plan: assembly.plan };
      setCollectionTest(test);
      logger.info("collection_plan_built", {
        collectionPlanSteps: assembly.plan.journeys.reduce((total, journey) => total + journey.steps.length, 0),
        leftOutCount: assembly.plan.collection!.leftOut.length,
        findingCount: assembly.plan.collection!.findings.length,
        credentialRequestCount: assembly.plan.collection!.credentialRequests.length,
      });
      res.status(200).json({ collectionTest: viewOf(test, "current") });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.get(BASE, (req, res) => {
    const startedAt = logReceived(req);
    try {
      res.status(200).json({ collectionTest: viewOf(requireCollectionTest()) });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  router.post(`${BASE}/rebuild`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const previous = requireCollectionTest();
      if (collectionStateOf(previous) === "deleted") throw new CollectionDeletedError();
      const stored = getUploadedCollection(previous.collection.id);
      const knownIds = new Set<string>();
      parseStoredCollection(stored.collection).forEachItem((item) => {
        knownIds.add(String(item.id));
      });
      const { choices, droppedRequestIds } = rebuiltChoices(previous.choices, knownIds);
      const source: CollectionSource = { id: stored.id, name: stored.name, tier: stored.tier, json: stored.collection };
      const assembly = assembleFor(source, choices, "current");
      const notKept = notKeptOf(previous, assembly);
      const test = updateCollectionTest({ snapshot: stored.collection, choices, plan: assembly.plan });
      setCollectionTest({ ...test, collection: { id: stored.id, name: stored.name, tier: stored.tier } });
      logger.info("collection_plan_rebuilt", {
        collectionPlanSteps: assembly.plan.journeys.reduce((total, journey) => total + journey.steps.length, 0),
        leftOutCount: assembly.plan.collection!.leftOut.length,
        findingCount: assembly.plan.collection!.findings.length,
        credentialRequestCount: assembly.plan.collection!.credentialRequests.length,
      });
      res.status(200).json({ collectionTest: viewOf(requireCollectionTest(), "current"), notKept, droppedRequestIds });
      logSucceeded(req, startedAt, 200);
    } catch (err) {
      handleKnownError(req, res, startedAt, err);
    }
  });

  // R17, FR-017: values are copied on the server; the response holds the environment's id and name only.
  router.post(`${BASE}/environment`, (req, res) => {
    const startedAt = logReceived(req);
    try {
      const test = requireCollectionTest();
      const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length === 0) throw new InvalidPlanUpdateError("Give the environment a name.");
      if (collectionStateOf(test) === "deleted") throw new CollectionDeletedError();
      const stored = getUploadedCollection(test.collection.id);
      const environment = seedEnvironmentFromCollection(name, stored, test.snapshot, assembleFor(sourceOf(test), test.choices));
      logger.info("collection_environment_created", { valueCount: Object.keys(environment.variableValues).length });
      res.status(201).json({ environment: { id: environment.id, name: environment.name } });
      logSucceeded(req, startedAt, 201);
    } catch (err) {
      if (err instanceof DuplicateEnvironmentNameError) return fail(req, res, startedAt, 409, "duplicate_environment_name", err.message);
      handleKnownError(req, res, startedAt, err);
    }
  });

  registerPerformanceRoutes(router, BASE, collectionSource, dependencies);
  return router;
}
