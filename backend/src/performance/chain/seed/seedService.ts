import type { ChainPlanView, Environment, MovedCredential } from "@apipilot/shared-domain";
import { PlanSourceUnavailableError } from "../../../api/performanceHttp";
import { getEnvironment, updateEnvironment } from "../../../execution/environmentStore";
import { NoRequestsSelectedError } from "../../../externalCollections/errors";
import { resolveRunOrder } from "../../../externalCollections/runOrder";
import { parseStoredCollection } from "../../../externalCollections/uploadedCollectionParsing";
import { getUploadedCollection } from "../../../externalCollections/uploadedCollectionStore";
import { getCurrentWorkflow } from "../../../testGenerationWorkflow/workflowStore";
import { InvalidChainPlanError } from "../../errors";
import { contextFromWorkflow } from "../../plan/buildPlan";
import { contextFromQuickTest, getQuickTest } from "../../quick/quickTestStore";
import { createPlan } from "../chainPlanStore";
import { assembleSeededPlan, type SeedInput } from "./assembleSeededPlan";
import { seedFromCollection } from "./seedFromCollection";
import { seedFromSpecification } from "./seedFromSpecification";
import { seedFromWorkflow } from "./seedFromWorkflow";

/**
 * Seeding a request-chain plan from one of its sources (specs/037-request-chain-performance FR-020,
 * contracts "POST /seed"). Each source is read once; the plan is never re-derived from it (FR-026).
 * Literal credentials found while seeding move into the named environment, or are dropped and listed
 * (Clarification 2026-10-03). Seeding sends nothing and runs nothing.
 */
export type SeedSourceInput = { kind: "specification" } | { kind: "workflow" } | { kind: "collection"; collectionId: string; orderedRequestIds: string[] };

export function parseSeedSource(raw: unknown): SeedSourceInput {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (source.kind === "specification" || source.kind === "workflow") return { kind: source.kind };
  if (source.kind === "collection") {
    if (typeof source.collectionId !== "string" || !Array.isArray(source.orderedRequestIds) || !source.orderedRequestIds.every((id) => typeof id === "string")) {
      throw new InvalidChainPlanError("source", "A collection source names the collection and the requests in run order.");
    }
    return { kind: "collection", collectionId: source.collectionId, orderedRequestIds: source.orderedRequestIds as string[] };
  }
  throw new InvalidChainPlanError("source", "Seed from a specification, the guided workflow or a collection.");
}

function readSource(source: SeedSourceInput, name: string, now: string): Omit<SeedInput, "environment"> {
  if (source.kind === "specification") {
    const test = getQuickTest();
    if (!test) throw new PlanSourceUnavailableError(404, "quick_test_not_found", "Upload a specification in Quick performance test first.");
    return seedFromSpecification(contextFromQuickTest(test), test.specification.filename, name, now);
  }
  if (source.kind === "workflow") {
    // The same gate as the guided performance plan: Postman generation is complete (AP-029).
    const workflow = getCurrentWorkflow();
    if (!workflow || workflow.stages.postmanGeneration.status !== "complete") {
      throw new PlanSourceUnavailableError(409, "workflow_not_ready", "Finish the guided workflow up to Postman generation first.");
    }
    return seedFromWorkflow(contextFromWorkflow(workflow), workflow.apiModel?.info?.title ?? "the guided workflow", name, now);
  }
  const stored = getUploadedCollection(source.collectionId);
  const collection = parseStoredCollection(stored.collection);
  if (source.orderedRequestIds.length === 0) throw new NoRequestsSelectedError();
  const ordered = resolveRunOrder(collection, source.orderedRequestIds) ?? [];
  return seedFromCollection({ id: stored.id, name: stored.name }, collection, ordered, name, now);
}

function storeMoved(environment: Environment, moves: { stepId: string; location: MovedCredential["location"]; valueName: string; value: string }[]): MovedCredential[] {
  if (moves.length === 0) return [];
  const variableValues = { ...environment.variableValues };
  for (const move of moves) variableValues[move.valueName] = move.value;
  updateEnvironment(environment.id, { name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl, variableValues, requestDelayMs: environment.requestDelayMs });
  return moves.map((move) => ({ stepId: move.stepId, location: move.location, valueName: move.valueName, environmentName: environment.name }));
}

export function seedPlan(input: { name: string; source: SeedSourceInput; environmentId?: string }, now: string): { view: ChainPlanView; movedCredentials: MovedCredential[]; reportItems: number } {
  const environment = input.environmentId ? getEnvironment(input.environmentId) : null;
  const read = readSource(input.source, input.name, now);
  const seeded = assembleSeededPlan({ ...read, environment: environment ? { name: environment.name, valueNames: Object.keys(environment.variableValues) } : null });
  const plan = { ...seeded.plan, targetEnvironmentId: environment?.id ?? null };
  const movedCredentials = environment ? storeMoved(environment, seeded.moves) : [];
  const view = createPlan(plan);
  return { view, movedCredentials, reportItems: plan.seedingReport?.items.length ?? 0 };
}
