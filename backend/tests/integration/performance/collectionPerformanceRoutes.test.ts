import type { CollectionPerformanceTestView, PerformancePlan, PerformanceRun } from "@apipilot/shared-domain";
import { describe, expect, it, vi } from "vitest";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { readyProbe } from "../../fixtures/performance/agent";
import { APIFOUNDRY_REQUEST_IDS, apifoundryCollection } from "../../fixtures/collections/collectionBuilders";
import { buildCollectionPlan, COLLECTION_BASE, collectionAgent, reviewAndGenerate, uploadCollection } from "../../fixtures/performance/collectionPlans";
import { TargetServer } from "../../fixtures/execution/targetServer";

/** AP-036 contracts/collection-performance-api.md (tasks T029). */

function view(response: { body: { collectionTest: CollectionPerformanceTestView } }): CollectionPerformanceTestView {
  return response.body.collectionTest;
}

function steps(plan: PerformancePlan) {
  return plan.journeys.flatMap((journey) => journey.steps);
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("POST /collection-performance (build)", () => {
  it("builds the plan from the ordered selection: the token request before the load, seven named steps, statuses from the collection's tests", async () => {
    const { agent, collectionId } = await collectionAgent();
    const built = await buildCollectionPlan(agent, collectionId);
    expect(built.status).toBe(200);
    const { collection, plan, script } = view(built);
    expect(collection).toEqual({ id: collectionId, name: "APIFoundry", tier: "local", state: "current" });
    expect(script).toBeNull();
    expect(plan.source).toBe("collection");
    expect(plan.journeys).toHaveLength(1);
    expect(plan.journeys[0].source).toEqual({ kind: "collection", collectionId, collectionName: "APIFoundry" });
    expect(steps(plan).map((step) => [step.collectionRequest?.folderPath, step.collectionRequest?.name])).toEqual([
      [["Customers"], "List customers"],
      [["Customers"], "Create customer"],
      [["Customers"], "Get customer"],
      [["Customers"], "Update customer"],
      [["Customers"], "Delete customer"],
      [[], "Health"],
      [[], "Version"],
    ]);
    expect(plan.collection!.credentialRequests.map((request) => [request.request.name, request.usedBy[0].captureName, request.usedBy[0].stepIds.length])).toEqual([["Get token", "access_token", 7]]);
    expect(steps(plan).every((step) => step.expectedStatuses.every((status) => status.source === "collection"))).toBe(true);
    expect(plan.userSuppliedValues.map((value) => value.name)).toEqual(["baseUrl", "client_id", "client_secret"]);
    const get = steps(plan)[2];
    expect(get.bindings?.find((binding) => binding.captureName === "customer_id")?.captureStepId).toBe(steps(plan)[1].id);
    expect(plan.collection!.review.reviewed).toBe(false);
  });

  it("refuses a malformed body, an unknown or empty selection, another session's collection and more than 100 requests", async () => {
    const { agent, collectionId } = await collectionAgent();
    expect((await agent.post(COLLECTION_BASE).send({ collectionId })).body.error).toBe("invalid_request");
    expect((await buildCollectionPlan(agent, collectionId, ["req-token", "req-token"])).body.error).toBe("invalid_run_order");
    expect((await buildCollectionPlan(agent, collectionId, ["req-token", "nope"])).body.error).toBe("invalid_run_order");
    expect((await buildCollectionPlan(agent, collectionId, [])).body.error).toBe("no_requests_selected");
    const other = await collectionAgent();
    const foreign = await buildCollectionPlan(agent, other.collectionId);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe("uploaded_collection_not_found");
    const tooMany = await buildCollectionPlan(agent, collectionId, Array.from({ length: 101 }, (_unused, index) => `r${index}`));
    expect(tooMany.status).toBe(422);
    expect(tooMany.body).toMatchObject({ error: "too_many_requests", count: 101 });
    expect(tooMany.body.message).toContain("101");
  });

  it("asks before replacing a plan, and replaces it when told to (FR-025)", async () => {
    const { agent, collectionId } = await collectionAgent();
    await buildCollectionPlan(agent, collectionId);
    const refused = await buildCollectionPlan(agent, collectionId, ["req-health"]);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("collection_plan_exists");
    expect(steps(view(await agent.get(COLLECTION_BASE)).plan)).toHaveLength(7);
    const replaced = await buildCollectionPlan(agent, collectionId, ["req-health"], true);
    expect(replaced.status).toBe(200);
    expect(steps(view(replaced).plan).map((step) => step.collectionRequest?.name)).toEqual(["Health"]);
  });

  it("sends nothing and runs no script while building, and needs no first-run confirmation (FR-005, FR-018)", async () => {
    const target = new TargetServer();
    const baseUrl = await target.start();
    try {
      const { agent } = await collectionAgent({}, { environment: { values: [{ key: "baseUrl", value: baseUrl, enabled: true }] } });
      const collectionId = await uploadCollection(agent, apifoundryCollection({ dynamicBody: false }), { values: [{ key: "baseUrl", value: baseUrl, enabled: true }] }, { name: "second" });
      expect((await buildCollectionPlan(agent, collectionId)).status).toBe(200);
      expect(target.requests).toEqual([]);
    } finally {
      await target.stop();
    }
  });
});

describe("the collection plan's routes", () => {
  it("answers 404 collection_plan_not_found on every route without a plan", async () => {
    const { agent } = await collectionAgent();
    for (const response of [
      await agent.get(COLLECTION_BASE),
      await agent.get(`${COLLECTION_BASE}/plan`),
      await agent.put(`${COLLECTION_BASE}/plan`).send({}),
      await agent.post(`${COLLECTION_BASE}/plan/reset`),
      await agent.post(`${COLLECTION_BASE}/rebuild`),
      await agent.post(`${COLLECTION_BASE}/script`),
      await agent.post(`${COLLECTION_BASE}/runs`).send({}),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body.error).toBe("collection_plan_not_found");
    }
  });

  it("gates the script on the review, then on credential and step statuses (FR-012, FR-018, R14)", async () => {
    const { agent, collectionId } = await collectionAgent();
    await buildCollectionPlan(agent, collectionId);
    const token = view(await agent.get(COLLECTION_BASE)).plan.collection!.credentialRequests[0].stepId;
    // The token request with no recognised assertion: its status comes from the engineer.
    const health = steps(view(await agent.get(COLLECTION_BASE)).plan).find((step) => step.collectionRequest?.name === "Health")!;
    expect((await agent.post(`${COLLECTION_BASE}/script`)).body.error).toBe("conversion_not_reviewed");
    const reviewed = await agent.put(`${COLLECTION_BASE}/plan`).send({ conversionReviewed: true });
    expect(reviewed.body.plan.collection.review.reviewed).toBe(true);
    const generated = await agent.post(`${COLLECTION_BASE}/script`);
    expect(generated.status).toBe(200);
    expect(generated.body.script).toMatchObject({ stepCount: 7, outOfDate: false });
    // A changed status is a setting, not a conversion change: the review stays.
    const changed = await agent.put(`${COLLECTION_BASE}/plan`).send({ expectedStatuses: { [token]: ["200", "201"], [health.id]: ["2XX"] } });
    expect(changed.body.plan.collection.review.reviewed).toBe(true);
    expect(changed.body.plan.collection.credentialRequests[0].expectedStatuses).toEqual([
      { code: "200", source: "collection" },
      { code: "201", source: "user" },
    ]);
    expect(changed.body.script.outOfDate).toBe(true);
  });

  it("names a credential request without an expected status in expected_status_missing", async () => {
    const collection = apifoundryCollection({ dynamicBody: false });
    const auth = (collection.item as { id: string; item: { id: string; event: unknown[] }[] }[])[0];
    auth.item[0].event = [{ listen: "test", script: { type: "text/javascript", exec: ['pm.environment.set("access_token", pm.response.json().access_token);'] } }];
    const { agent, collectionId } = await collectionAgent({}, { collection });
    const built = view(await buildCollectionPlan(agent, collectionId));
    const token = built.plan.collection!.credentialRequests[0];
    expect(token.expectedStatuses).toEqual([]);
    expect(built.plan.stepsNeedingExpectedStatus).toEqual([token.stepId]);
    const refused = await reviewAndGenerate(agent);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: "expected_status_missing", stepIds: [token.stepId] });
  });

  it("marks the plan out of date on a collection edit, not on a value save-back, and refuses the script and runs until rebuilt (FR-022, R13)", async () => {
    const { agent, collectionId } = await collectionAgent({ probe: readyProbe() });
    await buildCollectionPlan(agent, collectionId);
    await reviewAndGenerate(agent);
    expect((await agent.put(`/api/external-collections/${collectionId}/variables`).send({ variableValues: { baseUrl: "http://127.0.0.1:1", client_id: "x" } })).status).toBe(200);
    expect(view(await agent.get(COLLECTION_BASE)).collection.state).toBe("current");

    expect((await agent.put(`/api/external-collections/${collectionId}/items/req-health/rename`).send({ name: "Health check" })).status).toBe(200);
    const read = view(await agent.get(COLLECTION_BASE));
    expect(read.collection.state).toBe("changed");
    expect((await agent.get(`${COLLECTION_BASE}/plan`)).body.plan.collection.collectionState).toBe("changed");
    for (const response of [await agent.post(`${COLLECTION_BASE}/script`), await agent.post(`${COLLECTION_BASE}/runs`).send({ environmentId: "x" })]) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: "collection_plan_out_of_date", state: "changed" });
    }
    expect((await agent.put(`${COLLECTION_BASE}/plan`).send({ thinkTimeMs: 500 })).status).toBe(200);

    const rebuilt = await agent.post(`${COLLECTION_BASE}/rebuild`);
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.collectionTest.collection.state).toBe("current");
    expect(rebuilt.body.collectionTest.plan.thinkTimeMs).toBe(500);
    expect(rebuilt.body.collectionTest.plan.collection.review.reviewed).toBe(false);
    expect(steps(rebuilt.body.collectionTest.plan).map((step: { collectionRequest: { name: string } }) => step.collectionRequest.name)).toContain("Health check");
    expect(rebuilt.body.droppedRequestIds).toEqual([]);
  });

  it("keeps the engineer's settings for surviving requests on rebuild, names what it could not keep, and refuses once the collection is deleted", async () => {
    const { agent, collectionId } = await collectionAgent();
    const plan = view(await buildCollectionPlan(agent, collectionId)).plan;
    const version = steps(plan).find((step) => step.collectionRequest?.name === "Version")!;
    const health = steps(plan).find((step) => step.collectionRequest?.name === "Health")!;
    const profile = { kind: "load", stages: [{ durationMs: 30_000, targetVirtualUsers: 2 }] };
    await agent.put(`${COLLECTION_BASE}/plan`).send({ expectedStatuses: { [version.id]: ["2XX"], [health.id]: ["200", "204"] }, loadProfile: profile, excludedRequestIds: ["req-list-customers"] });
    expect((await agent.delete(`/api/external-collections/${collectionId}/items/req-version`)).status).toBe(200);
    const rebuilt = await agent.post(`${COLLECTION_BASE}/rebuild`);
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.droppedRequestIds).toEqual(["req-version"]);
    expect(rebuilt.body.notKept).toEqual([{ stepId: version.id, itemId: "req-version", name: "Version", settings: ["expected-statuses"] }]);
    const after = rebuilt.body.collectionTest.plan as PerformancePlan;
    expect(after.loadProfile.stages).toEqual(profile.stages);
    expect(after.collection!.excludedRequestIds).toEqual(["req-list-customers"]);
    expect(steps(after).find((step) => step.id === health.id)!.expectedStatuses.map((status) => status.code)).toEqual(["200", "204"]);

    expect((await agent.delete(`/api/external-collections/${collectionId}`)).status).toBe(204);
    expect(view(await agent.get(COLLECTION_BASE)).collection.state).toBe("deleted");
    const refused = await agent.post(`${COLLECTION_BASE}/rebuild`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("collection_deleted");
  });

  it("refuses every AP-033 and AP-035 field on PUT /plan, naming it (FR-020)", async () => {
    const { agent, collectionId } = await collectionAgent();
    await buildCollectionPlan(agent, collectionId);
    for (const field of ["bodyEdits", "parameterEdits", "userJourneys", "nextUserJourneyNumber", "journeyOrder", "editProposedJourney", "revertProposedJourney", "alsoStandalone", "excludedOperationKeys"]) {
      const refused = await agent.put(`${COLLECTION_BASE}/plan`).send({ [field]: [] });
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ error: "not_supported_for_collection_plan", field });
    }
  });

  it("resets to default settings, keeping the review reset (POST /plan/reset)", async () => {
    const { agent, collectionId } = await collectionAgent();
    await buildCollectionPlan(agent, collectionId);
    await agent.put(`${COLLECTION_BASE}/plan`).send({ conversionReviewed: true, thinkTimeMs: 250, excludedRequestIds: ["req-health"] });
    const reset = await agent.post(`${COLLECTION_BASE}/plan/reset`);
    expect(reset.status).toBe(200);
    expect(reset.body.plan.thinkTimeMs).toBe(0);
    expect(reset.body.plan.collection.excludedRequestIds).toEqual([]);
    expect(reset.body.plan.collection.review.reviewed).toBe(false);
  });

  it("refuses a step order that places a binding before its capture, naming the value (FR-008)", async () => {
    const { agent, collectionId } = await collectionAgent();
    const plan = view(await buildCollectionPlan(agent, collectionId)).plan;
    const ids = steps(plan).map((step) => step.id);
    const swapped = [ids[0], ids[2], ids[1], ...ids.slice(3)];
    const refused = await agent.put(`${COLLECTION_BASE}/plan`).send({ stepOrder: { [plan.journeys[0].id]: swapped } });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "dependency_order_violation", variable: "customer_id" });
    const moved = [...ids.slice(0, 5), ids[6], ids[5]];
    expect((await agent.put(`${COLLECTION_BASE}/plan`).send({ stepOrder: { [plan.journeys[0].id]: moved } })).body.plan.journeys[0].steps.map((step: { id: string }) => step.id)).toEqual(moved);
  });

  it("previews a step and a credential request with collection auth and references, never a value, and has no response fields", async () => {
    const { agent, collectionId } = await collectionAgent();
    const plan = view(await buildCollectionPlan(agent, collectionId)).plan;
    const get = steps(plan)[2];
    const preview = (await agent.get(`${COLLECTION_BASE}/plan/steps/${get.id}/request`)).body.request;
    expect(preview).toMatchObject({ method: "GET", pathTemplate: "/api/v1/customers/{{customer_id}}", bodyEdit: null, parameterEdit: null });
    expect(preview.auth).toMatchObject({ kind: "chained-login", location: "header", references: [{ kind: "credential", schemeName: plan.collection!.credentialRequests[0].stepId }] });
    const token = (await agent.get(`${COLLECTION_BASE}/plan/steps/${plan.collection!.credentialRequests[0].stepId}/request`)).body.request;
    expect(token.auth.kind).toBe("collection-auth");
    expect(token.body.references.map((reference: { name: string; kind: string }) => [reference.kind, reference.name])).toEqual([
      ["environment", "client_id"],
      ["environment", "client_secret"],
    ]);
    expect(JSON.stringify(token)).not.toContain("fixture-client-secret");
    const fields = await agent.get(`${COLLECTION_BASE}/plan/response-fields?operationKey=${encodeURIComponent(get.operationKey)}`);
    expect(fields.status).toBe(404);
    expect(fields.body.error).toBe("not_applicable");
  });

  it("opens the environments routes for a session with only a collection plan (R17)", async () => {
    const { agent, collectionId } = await collectionAgent();
    expect((await agent.get("/api/test-generation-workflow/environments")).status).toBe(409);
    await buildCollectionPlan(agent, collectionId);
    expect((await agent.get("/api/test-generation-workflow/environments")).status).toBe(200);
  });

  it("runs on the trigger with the collection source, lists only collection runs, keeps no excerpt in the snapshot, and shares the one-run slot", async () => {
    const runner = createFakeRunner({ lines: [], holdUntilCancelled: true });
    const { agent, collectionId } = await collectionAgent({ runner, probe: readyProbe(), tickIntervalMs: 50 });
    const collection = apifoundryCollection({ dynamicBody: false });
    (collection.item as { id: string; event?: unknown[] }[]).find((item) => item.id === "req-health")!.event = [
      { listen: "test", script: { type: "text/javascript", exec: ["pm.response.to.have.status(200);", 'console.log("kept out of the run");'] } },
    ];
    const withFinding = await uploadCollection(agent, collection, { values: [{ key: "baseUrl", value: "http://127.0.0.1:4600", enabled: true }] }, { name: "with-finding" });
    expect(collectionId).not.toBe(withFinding);
    const built = view(await buildCollectionPlan(agent, withFinding));
    expect(built.plan.collection!.findings.some((finding) => finding.excerpt?.includes("kept out of the run"))).toBe(true);
    expect((await reviewAndGenerate(agent)).status).toBe(200);
    const environment = await agent.post("/api/test-generation-workflow/environments").send({ name: "perf", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: {} });
    const started = await agent.post(`${COLLECTION_BASE}/runs`).send({ environmentId: environment.body.environment.id });
    expect(started.status).toBe(200);
    const run = started.body.run as PerformanceRun;
    expect(run.planSource).toBe("collection");
    expect(JSON.stringify(run.planSnapshot)).not.toContain("kept out of the run");
    expect(run.planSnapshot.collection!.findings.every((finding) => finding.excerpt === null)).toBe(true);

    const busy = await agent.post(`${COLLECTION_BASE}/runs`).send({ environmentId: environment.body.environment.id });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ error: "execution_in_progress", runId: run.id });
    expect((await agent.get(`${COLLECTION_BASE}/runs`)).body.runs.map((summary: { id: string }) => summary.id)).toEqual([run.id]);
    expect((await agent.get("/api/quick-performance/runs")).body.runs).toEqual([]);
    await agent.post(`${COLLECTION_BASE}/runs/${run.id}/cancel`);
    const settled = await waitFor(
      async () => (await agent.get(`${COLLECTION_BASE}/runs/${run.id}`)).body.run as PerformanceRun,
      (value) => value.status !== "in-progress",
    );
    expect(settled.status).toBe("cancelled");
    expect(runner.starts[0].env.APIPILOT_RUN_TAG).toMatch(/^[0-9a-f]{6}$/);
  });

  it("builds the same plan and script twice from the same collection and choices (FR-023)", async () => {
    const { agent, collectionId } = await collectionAgent();
    const first = view(await buildCollectionPlan(agent, collectionId));
    const firstScript = (await reviewAndGenerate(agent)).body.script.scriptSha256;
    const second = view(await buildCollectionPlan(agent, collectionId, APIFOUNDRY_REQUEST_IDS, true));
    expect(second.plan.fingerprint).toBe(first.plan.fingerprint);
    expect((await reviewAndGenerate(agent)).body.script.scriptSha256).toBe(firstScript);
  });
});

/** AP-036 User Story 2, FR-013 (tasks T051). */
describe("dynamic variables in a collection plan", () => {
  it("shows the customer POST's name and email as generated at run time, never as environment values", async () => {
    const { agent, collectionId } = await collectionAgent({}, { dynamicBody: true });
    const plan = view(await buildCollectionPlan(agent, collectionId)).plan;
    const create = steps(plan).find((step) => step.collectionRequest?.name === "Create customer")!;
    const preview = (await agent.get(`${COLLECTION_BASE}/plan/steps/${create.id}/request`)).body.request;
    expect(preview.body.references.map((reference: { kind: string; variable?: string }) => [reference.kind, reference.variable])).toEqual([
      ["generated-value", "$randomFullName"],
      ["generated-value", "$randomEmail"],
    ]);
    expect(plan.userSuppliedValues.map((value) => value.name)).toEqual(["baseUrl", "client_id", "client_secret"]);
    expect(plan.collection!.generatedValueCount).toBe(2);
  });

  it("leaves out a request edited to use a variable ApiPilot cannot generate, after a rebuild", async () => {
    const { agent, collectionId } = await collectionAgent({}, { dynamicBody: true });
    await buildCollectionPlan(agent, collectionId);
    const edited = await agent
      .put(`/api/external-collections/${collectionId}/requests/req-health`)
      .send({ method: "GET", url: "{{baseUrl}}/health?color={{$randomColor}}", headers: [] });
    expect(edited.status).toBe(200);
    const rebuilt = (await agent.post(`${COLLECTION_BASE}/rebuild`)).body.collectionTest.plan as PerformancePlan;
    expect(rebuilt.collection!.leftOut).toEqual([
      { itemId: "req-health", name: "Health", folderPath: [], method: "GET", path: "/health", reason: "unsupported-dynamic-variable", detail: "$randomColor" },
    ]);
  });
});

/** AP-036 User Story 4, FR-017 (research R17; tasks T063). */
describe("POST /collection-performance/environment", () => {
  it("creates an environment with the collection's values, returning only its id and name", async () => {
    const { agent, collectionId } = await collectionAgent();
    await buildCollectionPlan(agent, collectionId);
    const created = await agent.post(`${COLLECTION_BASE}/environment`).send({ name: "perf-from-collection" });
    expect(created.status).toBe(201);
    expect(Object.keys(created.body.environment).sort()).toEqual(["id", "name"]);
    expect(JSON.stringify(created.body)).not.toContain("fixture-client-secret");
    const values = await agent.get(`${COLLECTION_BASE}/plan/values?environmentId=${created.body.environment.id}`);
    expect(values.body.values.map((value: { name: string; present: boolean }) => [value.name, value.present])).toEqual([
      ["baseUrl", true],
      ["client_id", true],
      ["client_secret", true],
    ]);
    expect(JSON.stringify(values.body.values)).not.toContain("fixture-client-secret");
  });

  it("refuses a missing name, a taken name, and a deleted collection", async () => {
    const { agent, collectionId } = await collectionAgent();
    await buildCollectionPlan(agent, collectionId);
    expect((await agent.post(`${COLLECTION_BASE}/environment`).send({ name: "  " })).body.error).toBe("invalid_request");
    expect((await agent.post(`${COLLECTION_BASE}/environment`).send({ name: "taken" })).status).toBe(201);
    const duplicate = await agent.post(`${COLLECTION_BASE}/environment`).send({ name: "taken" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("duplicate_environment_name");
    await agent.delete(`/api/external-collections/${collectionId}`);
    const deleted = await agent.post(`${COLLECTION_BASE}/environment`).send({ name: "after-delete" });
    expect(deleted.status).toBe(409);
    expect(deleted.body.error).toBe("collection_deleted");
  });

  it("refuses when the base-URL variable resolves to nothing", async () => {
    const { agent, collectionId } = await collectionAgent({}, { environment: { values: [{ key: "client_id", value: "x", enabled: true }] } });
    await buildCollectionPlan(agent, collectionId);
    const refused = await agent.post(`${COLLECTION_BASE}/environment`).send({ name: "no-base" });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("base_url_missing");
  });

  it("keeps the environment as it was when the collection changes afterwards", async () => {
    const { agent, collectionId } = await collectionAgent();
    await buildCollectionPlan(agent, collectionId);
    const created = await agent.post(`${COLLECTION_BASE}/environment`).send({ name: "snapshot" });
    await agent.put(`/api/external-collections/${collectionId}/variables`).send({ variableValues: { baseUrl: "http://changed.example", client_id: "changed" } });
    const environments = (await agent.get("/api/test-generation-workflow/environments")).body.environments as { id: string; baseUrl: string; variableValues: Record<string, string> }[];
    const environment = environments.find((candidate) => candidate.id === created.body.environment.id)!;
    expect(environment.baseUrl).toBe("http://127.0.0.1:4600");
    expect(environment.variableValues.client_id).toBe("fixture-client-id");
  });
});

/** AP-036 contract Logging, constitution XX, FR-026 (tasks T069). */
describe("logging of the collection plan's routes", () => {
  it("logs no collection or request name, URL, variable name, script text, excerpt or value", async () => {
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" "))),
    );
    try {
      const collection = apifoundryCollection({ dynamicBody: true });
      const { agent } = await collectionAgent();
      const collectionId = await uploadCollection(agent, collection, { values: [{ key: "baseUrl", value: "http://127.0.0.1:4600", enabled: true }, { key: "client_secret", value: "SEEDED-SECRET-LOG-7d" , enabled: true }] }, { name: "Secret Collection Name" });
      logged.length = 0;
      await buildCollectionPlan(agent, collectionId);
      const plan = (await agent.get(`${COLLECTION_BASE}/plan`)).body.plan as PerformancePlan;
      await agent.put(`${COLLECTION_BASE}/plan`).send({ addedCaptures: { [plan.journeys[0].steps[0].id]: [{ name: "hidden_capture", source: { kind: "header", name: "X-Hidden-Header" } }] } });
      await agent.get(`${COLLECTION_BASE}/plan/steps/${plan.journeys[0].steps[2].id}/request`);
      await reviewAndGenerate(agent);
      await agent.post(`${COLLECTION_BASE}/environment`).send({ name: "Secret Environment Name" });
      await agent.post(`${COLLECTION_BASE}/rebuild`);
      const text = logged.join("\n");
      expect(text).toContain("collection_plan_built");
      for (const forbidden of [
        "Secret Collection Name",
        "Create customer",
        "/api/v1/customers",
        "customer_id",
        "access_token",
        "client_secret",
        "pm.collectionVariables",
        "hidden_capture",
        "x-hidden-header",
        "SEEDED-SECRET-LOG-7d",
        "Secret Environment Name",
      ]) {
        expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
