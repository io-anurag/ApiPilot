import type { UploadedCollectionSet } from "@apipilot/shared-domain";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import type { PerformanceTestingDependencies } from "../../../src/api/performanceTesting";
import { createApp } from "../../../src/app";
import { ensureStableIds } from "../../../src/externalCollections/itemIdentity";
import { parseUploadedCollection } from "../../../src/externalCollections/uploadedCollectionParsing";
import { createUploadedCollection } from "../../../src/externalCollections/uploadedCollectionStore";
import { apifoundryCollection, apifoundryEnvironment, APIFOUNDRY_REQUEST_IDS } from "../collections/collectionBuilders";
import { unavailableProbe } from "./agent";
import { establishSession } from "./session";

/**
 * AP-036 (specs/036-collection-performance-test tasks T005): stores a collection for the current
 * test session, as the upload route does, so unit tests can build a collection plan from it. The
 * caller must have entered a session (`enterTestSession`).
 */
export function storeCollection(
  collection: Record<string, unknown>,
  options: { name?: string; tier?: UploadedCollectionSet["tier"]; variableValues?: Record<string, string> } = {},
): UploadedCollectionSet {
  return createUploadedCollection({
    name: options.name ?? "Fixture collection",
    tier: options.tier ?? "local",
    collection: ensureStableIds(parseUploadedCollection(JSON.stringify(collection))),
    variableValues: options.variableValues ?? {},
    requestDelayMs: 0,
  });
}

/** The `variableValues` a Postman environment file gives an upload: its enabled entries. */
export function environmentValues(environment: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const entry of (environment.values as { key: string; value: string; enabled?: boolean }[]) ?? []) {
    if (entry.enabled !== false) values[entry.key] = entry.value;
  }
  return values;
}

/** Uploads a collection through `POST /api/external-collections`, as the browser does, and returns its id. */
export async function uploadCollection(
  agent: TestAgent,
  collection: Record<string, unknown>,
  environment: Record<string, unknown> | undefined,
  options: { name?: string; tier?: UploadedCollectionSet["tier"] } = {},
): Promise<string> {
  const response = await agent
    .post("/api/external-collections")
    .field("name", options.name ?? "APIFoundry")
    .field("tier", options.tier ?? "local")
    .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
    .attach("environment", Buffer.from(JSON.stringify(environment ?? { values: [] })), "environment.json");
  if (response.status !== 201 && response.status !== 200) throw new Error(`Upload failed with ${response.status}: ${JSON.stringify(response.body)}`);
  return response.body.uploadedCollection.id as string;
}

export const COLLECTION_BASE = "/api/collection-performance";

/**
 * AP-036: a supertest agent with its own session and the APIFoundry fixture uploaded (tasks T005).
 * `dynamicBody: false` uploads the literal-body variant User Story 1 uses.
 */
export async function collectionAgent(
  deps: Partial<PerformanceTestingDependencies> = {},
  options: { dynamicBody?: boolean; collection?: Record<string, unknown>; environment?: Record<string, unknown> } = {},
): Promise<{ agent: TestAgent; sessionId: string; collectionId: string }> {
  const agent = request.agent(createApp(undefined, { performance: { probe: unavailableProbe(), ...deps } }));
  const sessionId = await establishSession(agent);
  const collectionId = await uploadCollection(
    agent,
    options.collection ?? apifoundryCollection({ dynamicBody: options.dynamicBody ?? false }),
    options.environment ?? apifoundryEnvironment(),
  );
  return { agent, sessionId, collectionId };
}

/** Builds the session's collection plan from the given ordered ids (by default the fixture's eight). */
export function buildCollectionPlan(agent: TestAgent, collectionId: string, orderedRequestIds: readonly string[] = APIFOUNDRY_REQUEST_IDS, replaceExisting = false) {
  return agent.post(COLLECTION_BASE).send({ collectionId, orderedRequestIds, replaceExisting });
}

/** Marks the conversion reviewed, then generates the script. */
export async function reviewAndGenerate(agent: TestAgent) {
  await agent.put(`${COLLECTION_BASE}/plan`).send({ conversionReviewed: true });
  return agent.post(`${COLLECTION_BASE}/script`);
}
