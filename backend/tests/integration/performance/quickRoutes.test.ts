import { beforeEach, describe, expect, it } from "vitest";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { MAX_UPLOAD_BYTES } from "../../../src/uploadMiddleware";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { QUICK_BASE, quickAgent, quickSteps, uploadQuick } from "../../fixtures/performance/quickAgent";
import { openApiFixtureBuffer } from "../../fixtures/performance/specification";

/** AP-032 contracts/quick-performance-api.md (FR-001 to FR-008, FR-021; tasks T020). */

const EMPTY_SPECIFICATION = Buffer.from('openapi: 3.0.3\ninfo:\n  title: Empty\n  version: "1"\npaths: {}\n');

describe("quick performance test routes", () => {
  beforeEach(() => resetStore());

  it("builds a quick plan from an upload: every operation a single-step journey, no review stage, no script yet", async () => {
    const { agent } = await quickAgent({ runner: createFakeRunner({ lines: [] }) });
    const created = await uploadQuick(agent);
    expect(created.status).toBe(200);
    const { quickTest } = created.body;
    expect(quickTest.specification).toMatchObject({ filename: "quick-performance.yaml", operationCount: 13, info: { title: "Quick Performance Fixture" } });
    expect(quickTest.plan.source).toBe("quick");
    expect(quickTest.script).toBeNull();
    expect(quickTest.plan.journeys.every((journey: { source: { kind: string }; steps: unknown[] }) => journey.source.kind === "operation" && journey.steps.length === 1)).toBe(true);
    expect(quickSteps(quickTest.plan)).toHaveLength(12);
    expect(quickTest.plan.excludedOperationKeys).toEqual(["POST /auth/login"]);
    expect(quickTest.plan.credentialProducerOperationKeys).toEqual(["POST /auth/login"]);
    expect(JSON.stringify(quickTest)).not.toContain("k6/http");

    const read = await agent.get(QUICK_BASE);
    expect(read.status).toBe(200);
    expect(read.body.quickTest).toEqual(quickTest);
    expect((await agent.get(`${QUICK_BASE}/plan`)).body.plan).toEqual(quickTest.plan);
  });

  it("gives the guided upload's error for the same bad input, and stores nothing (FR-002, US1 AS5)", async () => {
    const guided = await quickAgent();
    const { agent } = await quickAgent();
    const cases: { buffer?: Buffer; filename: string }[] = [
      { buffer: openApiFixtureBuffer("invalid-yaml.txt"), filename: "invalid-yaml.txt" },
      { buffer: openApiFixtureBuffer("unsupported-version.yaml"), filename: "unsupported-version.yaml" },
    ];
    for (const input of cases) {
      const quick = await uploadQuick(agent, input);
      const reference = await guided.agent.post("/api/test-generation-workflow").attach("file", input.buffer!, input.filename);
      expect(quick.status).toBe(reference.status);
      expect(quick.body).toEqual(reference.body);
      expect((await agent.get(QUICK_BASE)).status).toBe(404);
    }

    const noFile = await agent.post(QUICK_BASE);
    const noFileReference = await guided.agent.post("/api/test-generation-workflow");
    expect(noFile.status).toBe(400);
    expect(noFile.body).toEqual(noFileReference.body);

    const tooLarge = await uploadQuick(agent, { buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x20), filename: "big.yaml" });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error).toBe("file_too_large");
    const missing = await agent.get(QUICK_BASE);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("quick_test_not_found");
  });

  it("asks before replacing a quick test, and replaces it when told to (FR-021)", async () => {
    const { agent } = await quickAgent();
    await uploadQuick(agent);
    const refused = await uploadQuick(agent, { buffer: EMPTY_SPECIFICATION, filename: "empty.yaml" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("quick_test_exists");
    expect((await agent.get(QUICK_BASE)).body.quickTest.specification.filename).toBe("quick-performance.yaml");

    const replaced = await uploadQuick(agent, { buffer: EMPTY_SPECIFICATION, filename: "empty.yaml", replaceExisting: true });
    expect(replaced.status).toBe(200);
    expect(replaced.body.quickTest.specification.filename).toBe("empty.yaml");
  });

  it("refuses every plan and script route without a quick test", async () => {
    const { agent } = await quickAgent();
    for (const response of [
      await agent.get(`${QUICK_BASE}/plan`),
      await agent.put(`${QUICK_BASE}/plan`).send({}),
      await agent.post(`${QUICK_BASE}/plan/reset`),
      await agent.get(`${QUICK_BASE}/plan/values?environmentId=x`),
      await agent.get(`${QUICK_BASE}/plan/steps/s_x/request`),
      await agent.get(`${QUICK_BASE}/plan/removed-operation?operationKey=GET%20%2Fx`),
      await agent.post(`${QUICK_BASE}/script`),
      await agent.get(`${QUICK_BASE}/script/download?file=script`),
      await agent.post(`${QUICK_BASE}/runs`).send({ environmentId: "x" }),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body.error).toBe("quick_test_not_found");
    }
  });

  it("builds a plan with no journeys when nothing can be load-tested, and generates nothing", async () => {
    const { agent } = await quickAgent();
    const created = await uploadQuick(agent, { buffer: EMPTY_SPECIFICATION, filename: "empty.yaml" });
    expect(created.status).toBe(200);
    expect(created.body.quickTest.plan.journeys).toEqual([]);
    const generated = await agent.post(`${QUICK_BASE}/script`);
    expect(generated.status).toBe(422);
    expect(generated.body.error).toBe("nothing_to_test");
  });

  it("previews a step's request, and refuses an unknown step (FR-008)", async () => {
    const { agent } = await quickAgent();
    const plan = (await uploadQuick(agent)).body.quickTest.plan;
    const step = quickSteps(plan).find((candidate) => candidate.operationKey === "GET /orders/{orderId}")!;
    const preview = await agent.get(`${QUICK_BASE}/plan/steps/${step.id}/request`);
    expect(preview.status).toBe(200);
    expect(preview.body.request).toMatchObject({ stepId: step.id, method: "GET", pathTemplate: "/orders/{orderId}" });
    const unknown = await agent.get(`${QUICK_BASE}/plan/steps/s_nope/request`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("step_not_found");
  });

  it("previews a removed operation as it would be if restored, without changing the plan (FR-024a)", async () => {
    const { agent } = await quickAgent();
    const plan = (await uploadQuick(agent)).body.quickTest.plan;
    const key = (operationKey: string) => encodeURIComponent(operationKey);

    // The login starts removed as a credential producer.
    const login = await agent.get(`${QUICK_BASE}/plan/removed-operation?operationKey=${key("POST /auth/login")}`);
    expect(login.status).toBe(200);
    expect(login.body.step).toMatchObject({ operationKey: "POST /auth/login", method: "POST", path: "/auth/login" });
    expect(login.body.request).toMatchObject({ stepId: login.body.step.id, method: "POST", pathTemplate: "/auth/login" });

    // An operation removed by the user previews like the step it was.
    const target = quickSteps(plan).find((candidate) => candidate.operationKey === "GET /orders/{orderId}")!;
    const removed = await agent.put(`${QUICK_BASE}/plan`).send({ excludedOperationKeys: [...plan.excludedOperationKeys, target.operationKey] });
    expect(removed.status).toBe(200);
    const preview = await agent.get(`${QUICK_BASE}/plan/removed-operation?operationKey=${key(target.operationKey)}`);
    expect(preview.status).toBe(200);
    expect(preview.body.step).toEqual(target);
    expect(preview.body.request).toMatchObject({ stepId: target.id, method: "GET", pathTemplate: "/orders/{orderId}" });

    // Reading a preview never changes the plan.
    expect((await agent.get(`${QUICK_BASE}/plan`)).body.plan).toEqual(removed.body.plan);
  });

  it("refuses a removed-operation preview for an operation that is not removed, or with no key", async () => {
    const { agent } = await quickAgent();
    await uploadQuick(agent);
    const inPlan = await agent.get(`${QUICK_BASE}/plan/removed-operation?operationKey=${encodeURIComponent("GET /orders/{orderId}")}`);
    expect(inPlan.status).toBe(404);
    expect(inPlan.body.error).toBe("operation_not_removed");
    const missing = await agent.get(`${QUICK_BASE}/plan/removed-operation`);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("invalid_request");
  });

  it("registers the readiness and run routes for the quick path", async () => {
    const { agent } = await quickAgent();
    expect((await agent.get(`${QUICK_BASE}/readiness`)).status).toBe(200);
    const runs = await agent.get(`${QUICK_BASE}/runs`);
    expect(runs.status).toBe(200);
    expect(runs.body).toEqual({ runs: [] });
  });

  it("rejects a scope field on the quick plan (FR-022)", async () => {
    const { agent } = await quickAgent();
    await uploadQuick(agent);
    const response = await agent.put(`${QUICK_BASE}/plan`).send({ scope: "all" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });
});
