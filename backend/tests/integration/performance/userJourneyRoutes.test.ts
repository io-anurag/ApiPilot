import express from "express";
import request from "supertest";
import type { PerformancePlan } from "@apipilot/shared-domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPerformanceRoutes, type PlanHandle } from "../../../src/api/performanceRoutes";
import { buildPlan, rebuildPlan } from "../../../src/performance/plan/buildPlan";
import { applyPlanUpdate } from "../../../src/performance/plan/planUpdate";
import type { PerformanceContext } from "../../../src/performance/plan/stepRequest";
import { userJourneysContext } from "../../fixtures/performance/context";
import { resetQuickTestsForTest } from "../../../src/performance/quick/quickTestStore";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { readyProbe } from "../../fixtures/performance/agent";
import { SEEDED_CAPTURED_ID } from "../../fixtures/performance/builders";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { QUICK_BASE, quickAgent, quickSteps, uploadQuick, type QuickAgent } from "../../fixtures/performance/quickAgent";
import { USER_JOURNEYS_SPECIFICATION_FILENAME, userJourneysSpecificationBuffer } from "../../fixtures/performance/specification";
import { CREATE, lifecycleInput, REMOVE, REPLACE } from "../../fixtures/performance/userJourneyPlans";

/** AP-035 contracts/plan-journeys-api.md (FR-001 to FR-016, FR-020, FR-027; SC-005; tasks T022, T059). */

interface PlanBody {
  journeys: { id: string; source: { kind: string }; steps: { id: string; operationKey: string }[] }[];
  userJourneys?: { id: string; steps: { id: string }[] }[];
  fingerprint: string;
}

async function uploaded(): Promise<QuickAgent["agent"]> {
  const { agent } = await quickAgent({ runner: createFakeRunner({ lines: [] }), probe: readyProbe() });
  const created = await uploadQuick(agent, { buffer: userJourneysSpecificationBuffer(), filename: USER_JOURNEYS_SPECIFICATION_FILENAME });
  expect(created.status).toBe(200);
  return agent;
}

async function withLifecycle(agent: QuickAgent["agent"]) {
  const response = await agent.put(`${QUICK_BASE}/plan`).send({ userJourneys: [lifecycleInput()] });
  expect(response.status).toBe(200);
  return response.body as { plan: PlanBody; script: unknown };
}

describe("user-defined journey routes (quick path)", () => {
  const logged: string[] = [];
  beforeEach(() => {
    resetStore();
    resetQuickTestsForTest();
    logged.length = 0;
    for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  });
  afterEach(() => vi.restoreAllMocks());

  it("creates a journey with server ids, marks a generated script out of date, and keeps a refused update from changing the plan", async () => {
    const agent = await uploaded();
    expect((await agent.post(`${QUICK_BASE}/script`)).status).toBe(200);
    const { plan, script } = await withLifecycle(agent);
    const journey = plan.journeys.find((candidate) => candidate.source.kind === "user")!;
    expect(journey.steps.map((step) => step.operationKey)).toEqual([CREATE, REPLACE, REMOVE]);
    expect(plan.userJourneys![0].id).toMatch(/^j_[0-9a-f]{16}$/);
    expect(script).toMatchObject({ outOfDate: true });

    const refused = await agent.put(`${QUICK_BASE}/plan`).send({ userJourneys: [{ name: "Bad", steps: [{ operationKey: CREATE, captures: [{ name: "1st", source: { kind: "body", path: "id" } }] }] }] });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "capture_name_invalid", name: "1st" });
    expect((await agent.get(`${QUICK_BASE}/plan`)).body.plan.fingerprint).toBe(plan.fingerprint);
  });

  it("maps every refusal to its contract code and extras", async () => {
    const agent = await uploaded();
    const { plan } = await withLifecycle(agent);
    const definition = plan.userJourneys![0];
    const bad = await agent.put(`${QUICK_BASE}/plan`).send({ userJourneys: [{ id: definition.id, name: "J", steps: [{ id: definition.steps[1].id, operationKey: REPLACE, bindings: [{ target: { kind: "path", name: "id" }, captureStepId: definition.steps[0].id, captureName: "customer_id" }] }] }] });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: "capture_in_use", capture: "customer_id" });
    const order = await agent.put(`${QUICK_BASE}/plan`).send({ stepOrder: { [definition.id]: [definition.steps[1].id, definition.steps[0].id, definition.steps[2].id] } });
    expect(order.body).toMatchObject({ error: "dependency_order_violation", variable: "customer_id" });
    const unknown = await agent.put(`${QUICK_BASE}/plan`).send({ userJourneys: [{ name: "J", steps: [{ operationKey: "GET /nowhere" }] }] });
    expect(unknown.body).toMatchObject({ error: "unknown_operation", operationKey: "GET /nowhere" });
    const standalone = await agent.put(`${QUICK_BASE}/plan`).send({ alsoStandalone: ["GET /api/v1/orders/{id}"] });
    expect(standalone.body).toMatchObject({ error: "invalid_standalone" });
  });

  it("lists documented response fields, refusing a missing or unknown operation", async () => {
    const agent = await uploaded();
    const fields = await agent.get(`${QUICK_BASE}/plan/response-fields`).query({ operationKey: CREATE });
    expect(fields.status).toBe(200);
    expect(fields.body).toEqual({ fields: [{ path: "id", type: "string", statusCodes: ["201"] }, { path: "name", type: "string", statusCodes: ["201"] }], truncated: false });
    expect((await agent.get(`${QUICK_BASE}/plan/response-fields`)).body.error).toBe("invalid_request");
    expect((await agent.get(`${QUICK_BASE}/plan/response-fields`).query({ operationKey: "GET /nowhere" })).body.error).toBe("unknown_operation");
  });

  it("previews a bound path parameter as the capture and its step, never a value (FR-012)", async () => {
    const agent = await uploaded();
    const { plan } = await withLifecycle(agent);
    const [create, replace] = plan.journeys.find((candidate) => candidate.source.kind === "user")!.steps;
    const preview = (await agent.get(`${QUICK_BASE}/plan/steps/${replace.id}/request`)).body.request;
    expect(preview.parameters.find((parameter: { name: string }) => parameter.name === "id").value).toMatchObject({
      kind: "capture",
      captureName: "customer_id",
      producerStepId: create.id,
      source: { kind: "body", path: "id" },
      secret: false,
    });
  });

  it("records the definitions in the run snapshot, and no captured value anywhere (FR-027, FR-020, SC-005)", async () => {
    const agent = await uploaded();
    await withLifecycle(agent);
    expect((await agent.post(`${QUICK_BASE}/script`)).status).toBe(200);
    const environment = await agent.post("/api/test-generation-workflow/environments").send({ name: "local", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: {} });
    const started = await agent.post(`${QUICK_BASE}/runs`).send({ environmentId: environment.body.environment.id });
    expect(started.status).toBe(200);
    const snapshot = started.body.run.planSnapshot as PlanBody;
    expect(snapshot.userJourneys).toHaveLength(1);
    expect(snapshot.journeys.some((journey) => journey.source.kind === "user")).toBe(true);
    const run = (await agent.get(`${QUICK_BASE}/runs/${started.body.run.id}`)).body.run;
    expect(JSON.stringify(run)).not.toContain(SEEDED_CAPTURED_ID);
    expect(logged.join("\n")).not.toContain(SEEDED_CAPTURED_ID);
  });

  it("replaces the plan and its journeys when a new specification is uploaded (spec Edge Cases)", async () => {
    const agent = await uploaded();
    await withLifecycle(agent);
    const replaced = await uploadQuick(agent, { buffer: userJourneysSpecificationBuffer(), filename: USER_JOURNEYS_SPECIFICATION_FILENAME, replaceExisting: true });
    expect(replaced.status).toBe(200);
    expect(replaced.body.quickTest.plan.userJourneys).toBeUndefined();
    expect(quickSteps(replaced.body.quickTest.plan).every((step) => step.operationKey !== undefined)).toBe(true);
  });

  it("logs no capture name, field path, header name or journey name (contract Logging, constitution XX)", async () => {
    const agent = await uploaded();
    const journey = lifecycleInput("Secret Project Name");
    (journey.steps as Record<string, unknown>[])[0].captures = [
      { name: "customer_id", source: { kind: "body", path: "id" } },
      { name: "location_seen", source: { kind: "header", name: "X-Hidden-Header" } },
    ];
    expect((await agent.put(`${QUICK_BASE}/plan`).send({ userJourneys: [journey] })).status).toBe(200);
    await agent.put(`${QUICK_BASE}/plan`).send({ userJourneys: [{ name: "Bad", steps: [{ operationKey: CREATE, captures: [{ name: "x", source: { kind: "body", path: "secret[*]" } }] }] }] });
    const text = logged.join("\n");
    for (const forbidden of ["Secret Project Name", "location_seen", "x-hidden-header", "secret[*]"]) expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });
});

/** AP-035 FR-016 (contracts/plan-journeys-api.md `POST /script`; tasks T041), through a plan source held in memory. */
describe("POST /script with a binding whose target no longer exists", () => {
  async function appWith(planFor: (context: PerformanceContext) => PerformancePlan) {
    const context = await userJourneysContext();
    let plan = planFor(context);
    const router = express.Router();
    const handle: PlanHandle = {
      context,
      plan: () => plan,
      savePlan: (next) => void (plan = next),
      script: () => undefined,
      saveScript: () => undefined,
      onPlanChanged: () => undefined,
      onPlanReset: () => undefined,
      onScriptGenerated: () => undefined,
    };
    registerPerformanceRoutes(router, "/p", { kind: "quick", require: () => handle }, { runner: createFakeRunner({ lines: [] }), probe: readyProbe(), tickIntervalMs: 1000, now: () => new Date(0) });
    const app = express();
    app.use(express.json());
    app.use(router);
    return { app, context };
  }

  function boundOrders(context: PerformanceContext): PerformancePlan {
    return applyPlanUpdate(
      buildPlan(context),
      { userJourneys: [{ name: "Orders", steps: [{ operationKey: CREATE, captures: [{ name: "customer_id", source: { kind: "body", path: "id" } }] }, { operationKey: "POST /api/v1/orders", bindings: [{ target: { kind: "body", fieldPath: "customerId" }, captureStepIndex: 0, captureName: "customer_id" }] }] }] },
      context,
    );
  }

  it("refuses with 422 binding_target_missing and the step ids, after nothing_to_test and expected_status_missing", async () => {
    const { app } = await appWith((context) => {
      const withoutField = {
        ...context,
        approvedScenarios: context.approvedScenarios.map((scenario) =>
          scenario.operationPath === "/api/v1/orders" && scenario.operationMethod.toLowerCase() === "post" ? { ...scenario, request: { ...scenario.request, body: { items: [] } } } : scenario,
        ),
      };
      return rebuildPlan(boundOrders(context), withoutField, { keepOrder: true });
    });
    const refused = await request(app).post("/p/script");
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("binding_target_missing");
    expect(refused.body.stepIds).toHaveLength(1);
  });

  it("generates the script once every binding has its target", async () => {
    const { app } = await appWith(boundOrders);
    expect((await request(app).post("/p/script")).status).toBe(200);
  });
});
