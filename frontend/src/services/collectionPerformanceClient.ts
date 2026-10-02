import type { CollectionPerformanceTestView, CollectionRebuildNotKept } from "@apipilot/shared-domain";
import { createPerformanceClient, json, request, type PerformanceClient, type Result } from "./performanceTestingClient";

/**
 * AP-036 Performance Test from a Postman Collection (specs/036-collection-performance-test
 * contracts/collection-performance-api.md): building, reading and rebuilding the session's collection
 * plan, and creating an environment from its collection. The plan, script and run calls are AP-029's
 * contract on the collection base (`collectionPerformanceClient`).
 */
const BASE = "/api/collection-performance";

export const collectionPerformanceClient: PerformanceClient = createPerformanceClient(BASE);

const toTest = (body: Record<string, unknown>) => ({ collectionTest: body.collectionTest as CollectionPerformanceTestView });

/** Builds the plan from a stored collection's ordered selection; `409 collection_plan_exists` unless `replaceExisting`. */
export function buildCollectionTest(
  collectionId: string,
  orderedRequestIds: string[],
  replaceExisting = false,
): Promise<Result<{ collectionTest: CollectionPerformanceTestView }>> {
  return request("buildCollectionTest", BASE, json("POST", { collectionId, orderedRequestIds, replaceExisting }), toTest);
}

/** The session's collection plan, or `null` when there is none. */
export async function fetchCollectionTest(): Promise<Result<{ collectionTest: CollectionPerformanceTestView | null }>> {
  const result = await request("fetchCollectionTest", BASE, undefined, toTest);
  if (!result.ok && result.error === "collection_plan_not_found") return { ok: true, collectionTest: null };
  return result;
}

/** Rebuilds from the collection's current content; names the steps whose settings could not be kept. */
export function rebuildCollectionTest(): Promise<
  Result<{ collectionTest: CollectionPerformanceTestView; notKept: CollectionRebuildNotKept[]; droppedRequestIds: string[] }>
> {
  return request("rebuildCollectionTest", `${BASE}/rebuild`, json("POST"), (body) => ({
    collectionTest: body.collectionTest as CollectionPerformanceTestView,
    notKept: (body.notKept ?? []) as CollectionRebuildNotKept[],
    droppedRequestIds: (body.droppedRequestIds ?? []) as string[],
  }));
}

/** FR-017: a new target environment with the collection's values, copied on the server. The response holds no value. */
export function createEnvironmentFromCollection(name: string): Promise<Result<{ environment: { id: string; name: string } }>> {
  return request("createEnvironmentFromCollection", `${BASE}/environment`, json("POST", { name }), (body) => ({
    environment: body.environment as { id: string; name: string },
  }));
}
