import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCollectionTest,
  collectionPerformanceClient,
  createEnvironmentFromCollection,
  fetchCollectionTest,
  rebuildCollectionTest,
} from "../../src/services/collectionPerformanceClient";
import { planFixture, stubFetch } from "./performanceFixtures";

/** AP-036 contracts/collection-performance-api.md (tasks T020). */

const BASE = "/api/collection-performance";

afterEach(() => vi.unstubAllGlobals());

function view() {
  return { collection: { id: "c-1", name: "APIFoundry", tier: "local", state: "current" }, plan: planFixture(), script: null };
}

describe("collectionPerformanceClient", () => {
  it("builds with the ordered selection and the replace flag, and reads the session's plan", async () => {
    const calls = stubFetch({
      [`POST ${BASE}`]: () => [200, { collectionTest: view() }],
      [`GET ${BASE}`]: () => [200, { collectionTest: view() }],
    });
    expect(await buildCollectionTest("c-1", ["r2", "r1"], true)).toMatchObject({ ok: true, collectionTest: { collection: { id: "c-1" } } });
    expect(calls[0]).toEqual({ method: "POST", url: BASE, body: { collectionId: "c-1", orderedRequestIds: ["r2", "r1"], replaceExisting: true } });
    expect(await fetchCollectionTest()).toMatchObject({ ok: true, collectionTest: { collection: { name: "APIFoundry" } } });
  });

  it("reads no plan as null, and maps the contract's error extras", async () => {
    stubFetch({
      [`GET ${BASE}`]: () => [404, { error: "collection_plan_not_found", message: "m" }],
      [`POST ${BASE}`]: () => [422, { error: "too_many_requests", message: "101 requests are selected.", count: 101 }],
      [`POST ${BASE}/script`]: () => [409, { error: "collection_plan_out_of_date", message: "m", state: "changed" }],
      [`PUT ${BASE}/plan`]: () => [400, { error: "not_supported_for_collection_plan", message: "m", field: "bodyEdits" }],
    });
    expect(await fetchCollectionTest()).toEqual({ ok: true, collectionTest: null });
    expect(await buildCollectionTest("c-1", [])).toEqual({ ok: false, error: "too_many_requests", message: "101 requests are selected.", count: 101 });
    expect(await collectionPerformanceClient.generateScript()).toMatchObject({ ok: false, error: "collection_plan_out_of_date", state: "changed" });
    expect(await collectionPerformanceClient.updatePlan({ conversionReviewed: true })).toMatchObject({ ok: false, field: "bodyEdits" });
  });

  it("rebuilds, listing what was not kept, and creates an environment whose response holds no value", async () => {
    const calls = stubFetch({
      [`POST ${BASE}/rebuild`]: () => [200, { collectionTest: view(), notKept: [{ stepId: "s_1", itemId: "r1", name: "Get", settings: ["expected-statuses"] }], droppedRequestIds: ["r9"] }],
      [`POST ${BASE}/environment`]: () => [201, { environment: { id: "env-1", name: "perf" } }],
    });
    expect(await rebuildCollectionTest()).toMatchObject({ ok: true, notKept: [{ stepId: "s_1", settings: ["expected-statuses"] }], droppedRequestIds: ["r9"] });
    expect(await createEnvironmentFromCollection("perf")).toEqual({ ok: true, environment: { id: "env-1", name: "perf" } });
    expect(calls[1].body).toEqual({ name: "perf" });
  });
});
