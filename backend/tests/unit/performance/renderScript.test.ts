import { readFileSync } from "node:fs";
import path from "node:path";
import type { ApiModel, PerformancePlan, PostmanRequestItem } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { renderScript, SYSTEM_TAGS } from "../../../src/performance/k6/renderScript";
import { buildPlan } from "../../../src/performance/plan/buildPlan";
import { applyPlanUpdate } from "../../../src/performance/plan/planUpdate";
import { stepRequestFor } from "../../../src/performance/plan/planStepRequest";
import { buildStepRequestPreview } from "../../../src/performance/plan/requestPreview";
import { planAuth, type PerformanceContext } from "../../../src/performance/plan/stepRequest";
import { generateCollection } from "../../../src/postman/generateCollection";
import { percentEncode } from "../../../src/postman/parameterSerialization";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import { operationsWithDiscoverableProducer, twoBearerSchemes } from "../../fixtures/postman/credentialFixtures";
import { SEEDED_CLIENT_ID, SEEDED_CLIENT_SECRET } from "../../fixtures/performance/builders";
import { performanceContext, quickContext } from "../../fixtures/performance/context";
import { loadScript, type SandboxRequest, type SandboxResponse } from "../../fixtures/performance/k6Sandbox";

/** FR-009, FR-010, FR-011, FR-014 to FR-016, FR-020, FR-021 (research D7, D8, D11 to D14, D25, D26; tasks T030, T063, T083). */

const GOLDEN = path.join(__dirname, "..", "..", "fixtures", "performance", "golden");
const ORDER_ID = "00000000-0000-4000-8000-000000000001";

async function readyPlan(update: Record<string, unknown> = {}): Promise<{ plan: PerformancePlan; context: PerformanceContext }> {
  const context = await performanceContext();
  let plan = buildPlan(context);
  plan = applyPlanUpdate(plan, { expectedStatuses: { [plan.journeys[1].steps[0].id]: ["200"] }, ...update }, context);
  return { plan, context };
}

async function quickReadyPlan(): Promise<{ plan: PerformancePlan; context: PerformanceContext }> {
  const context = await quickContext();
  let plan = buildPlan(context);
  const status = plan.journeys.flatMap((journey) => journey.steps).find((step) => step.operationKey === "GET /status")!;
  plan = applyPlanUpdate(plan, { expectedStatuses: { [status.id]: ["200"] } }, context);
  return { plan, context };
}

function envFor(valueIndex: Record<string, number>, values: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (valueIndex[name] !== undefined) env[`APIPILOT_V_${valueIndex[name]}`] = value;
  }
  return env;
}

const ALL_VALUES = { baseUrl: "http://127.0.0.1:4600", clientId: SEEDED_CLIENT_ID, clientSecret: SEEDED_CLIENT_SECRET, warehouseId: "wh 1/ü" };

function stubTarget(overrides: { orders?: SandboxResponse; token?: SandboxResponse } = {}) {
  return (request: SandboxRequest): SandboxResponse => {
    if (request.url.endsWith("/oauth/token")) return overrides.token ?? { status: 200, body: { access_token: "tok-1", expires_in: 300 } };
    if (request.method === "POST" && request.url.endsWith("/orders")) return overrides.orders ?? { status: 201, body: { orderId: ORDER_ID } };
    return { status: 200, body: {} };
  };
}

describe("renderScript", () => {
  it("matches the reviewed golden script and environment template", async () => {
    const { plan, context } = await readyPlan();
    const rendered = renderScript(plan, context);
    expect(rendered.script).toBe(readFileSync(path.join(GOLDEN, "script.js"), "utf-8"));
    expect(rendered.environmentTemplate).toBe(readFileSync(path.join(GOLDEN, "environment-template.json"), "utf-8"));
  });

  it("matches the golden files once line endings are normalized (AP-032 T019: the stepRequestFor refactor changed no byte)", async () => {
    const { plan, context } = await readyPlan();
    const rendered = renderScript(plan, context);
    const lf = (text: string) => text.replace(/\r\n/g, "\n");
    expect(rendered.script).toBe(lf(readFileSync(path.join(GOLDEN, "script.js"), "utf-8")));
    expect(rendered.environmentTemplate).toBe(lf(readFileSync(path.join(GOLDEN, "environment-template.json"), "utf-8")));
  });

  it("embeds, for every step, exactly the request stepRequestFor builds (AP-032 FR-008: the preview shows what is sent)", async () => {
    for (const { plan, context } of [await readyPlan(), await quickReadyPlan()]) {
      const script = renderScript(plan, context).script;
      const match = /^const JOURNEYS = ([\s\S]*?);\n\n/m.exec(script);
      expect(match).not.toBeNull();
      const rendered = JSON.parse(match![1]) as { steps: { id: string; request: unknown }[] }[];
      const auth = planAuth(context);
      for (const journey of rendered) {
        for (const step of journey.steps) expect(step.request).toEqual(stepRequestFor(plan, context, auth, step.id).built.template);
      }
    }
  });

  it("renders byte-identical output 10 times from an unchanged plan (SC-001)", async () => {
    const { plan, context } = await readyPlan();
    const outputs = new Set(Array.from({ length: 10 }, () => JSON.stringify(renderScript(plan, context))));
    expect(outputs.size).toBe(1);
  });

  it("imports only k6 built-in modules and never a URL (research D8)", async () => {
    const { plan, context } = await readyPlan();
    const imports = [...renderScript(plan, context).script.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const module of imports) expect(["k6", "k6/http", "k6/metrics", "k6/encoding"]).toContain(module);
    expect(renderScript(plan, context).script).not.toMatch(/import\s*\(|require\(|https?:\/\/[^"\s]*\.js/);
  });

  it("keeps url and name out of the system tags (FR-040, D11)", async () => {
    const { plan, context } = await readyPlan();
    const script = renderScript(plan, context).script;
    expect(SYSTEM_TAGS).toEqual(["status", "method", "error_code", "check", "group"]);
    expect(script).toContain('"systemTags": [\n    "status",\n    "method",\n    "error_code",\n    "check",\n    "group"\n  ]');
  });

  it("contains no secret, even one present in the environment, and reads values only from __ENV (FR-021, D7)", async () => {
    const { plan, context } = await readyPlan();
    const { script, environmentTemplate, valueIndex } = renderScript(plan, context);
    for (const text of [script, environmentTemplate]) {
      expect(text).not.toContain(SEEDED_CLIENT_SECRET);
      expect(text).not.toContain(SEEDED_CLIENT_ID);
    }
    expect(valueIndex).toEqual({ baseUrl: 0, clientId: 1, clientSecret: 2, warehouseId: 3 });
    expect(script).toContain('__ENV["APIPILOT_V_" + index]');
    expect(script).not.toMatch(/--env|-e /);
    expect(JSON.parse(environmentTemplate)).toEqual({
      baseUrl: { env: "APIPILOT_V_0", secret: false, value: "" },
      clientId: { env: "APIPILOT_V_1", secret: true, value: "" },
      clientSecret: { env: "APIPILOT_V_2", secret: true, value: "" },
      warehouseId: { env: "APIPILOT_V_3", secret: false, value: "" },
    });
  });

  it("runs every journey in order on one iteration, with OAuth2 acquired once in setup (FR-006a, FR-009)", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget() });
    const data = k6.setup();
    expect(k6.requests).toHaveLength(1);
    const token = k6.requests[0];
    expect(token.url).toBe("http://127.0.0.1:4600/oauth/token");
    expect(token.body).toBe("grant_type=client_credentials");
    expect(token.headers.Authorization).toBe(`Basic ${Buffer.from(`${SEEDED_CLIENT_ID}:${SEEDED_CLIENT_SECRET}`).toString("base64")}`);
    expect(token.tags).toEqual({ apipilot_kind: "token-setup" });

    k6.iterate(data, 0);
    const sent = k6.requests.slice(1);
    expect(sent.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST http://127.0.0.1:4600/orders",
      `GET http://127.0.0.1:4600/orders/${ORDER_ID}`,
      "GET http://127.0.0.1:4600/status",
      `GET http://127.0.0.1:4600/warehouses/${percentEncode("wh 1/ü")}`,
    ]);
    for (const request of sent) {
      expect(request.headers.Authorization).toBe("Bearer tok-1");
      expect(request.tags.step).toMatch(/^s_/);
      expect(request.tags.journey).toMatch(/^j_/);
    }
    expect(sent[0].responseType).toBe("text");
    expect(sent[1].responseType).toBe("none");
    expect(k6.checks.every((c) => c.passed)).toBe(true);
  });

  it("makes customerEmail unique per virtual user and iteration, and identical across re-runs (FR-016)", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget(), vu: 3 });
    const data = k6.setup();
    k6.iterate(data, 7);
    const body = JSON.parse(k6.requests.find((r) => r.method === "POST" && r.url.endsWith("/orders"))!.body!);
    expect(body).toEqual({ customerEmail: "user+vu3-it7@example.com", quantity: 1 });
  });

  it("checks each response against the step's expected codes only (FR-012a, D14)", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, {
      env: envFor(valueIndex, ALL_VALUES),
      respond: (request) => (request.url.endsWith("/status") ? { status: 503 } : stubTarget()(request)),
    });
    k6.iterate(k6.setup(), 0);
    const statusStep = plan.journeys[1].steps[0].id;
    expect(k6.checks.filter((c) => c.tags.step === statusStep)).toEqual([{ name: "status", passed: false, tags: expect.any(Object) }]);
  });

  it("reports a missing value as missing data, sends nothing for that step, and runs the rest (FR-014)", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const withoutWarehouse: Record<string, string> = { ...ALL_VALUES };
    delete withoutWarehouse.warehouseId;
    const k6 = loadScript(script, { env: envFor(valueIndex, withoutWarehouse), respond: stubTarget() });
    k6.iterate(k6.setup(), 0);
    const warehouseStep = plan.journeys[2].steps[0].id;
    expect(k6.requests.some((r) => r.url.includes("/warehouses/"))).toBe(false);
    expect(k6.metrics.filter((m) => m.name === "apipilot_missing_data")).toEqual([
      { name: "apipilot_missing_data", value: 1, tags: { step: warehouseStep, journey: plan.journeys[2].id, variable: "warehouseId" } },
    ]);
    expect(k6.requests.filter((r) => r.url.endsWith("/status"))).toHaveLength(1);
  });

  it("cuts a journey short when an extraction fails, and continues with the next journey (FR-010, D25)", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget({ orders: { status: 500, body: {} } }) });
    k6.iterate(k6.setup(), 0);
    const [producer, consumer] = plan.journeys[0].steps;
    expect(k6.requests.some((r) => r.url.includes(`/orders/`))).toBe(false);
    expect(k6.metrics.filter((m) => m.name === "apipilot_cut_short")).toEqual([
      { name: "apipilot_cut_short", value: 1, tags: { step: producer.id, journey: plan.journeys[0].id } },
    ]);
    expect(k6.metrics.filter((m) => m.name === "apipilot_not_attempted").map((m) => m.tags.step)).toEqual([consumer.id]);
    expect(k6.requests.filter((r) => r.url.endsWith("/status"))).toHaveLength(1);
  });

  it("refreshes a token per virtual user between 70% and 80% of its stated lifetime, outside step metrics (FR-015, D12)", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const vu1 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget({ token: { status: 200, body: { access_token: "tok", expires_in: 100 } } }), vu: 1 });
    const data = vu1.setup();
    vu1.iterate(data, 0);
    vu1.clock.now += 69_000;
    vu1.iterate(data, 1);
    expect(vu1.requests.filter((r) => r.tags.apipilot_kind === "token-refresh")).toHaveLength(0);
    vu1.clock.now += 1_500;
    vu1.iterate(data, 2);
    const refreshes = vu1.requests.filter((r) => r.tags.apipilot_kind === "token-refresh");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].tags.step).toBeUndefined();
    expect(vu1.metrics.filter((m) => m.name === "apipilot_token_refresh").map((m) => m.tags.outcome)).toEqual(["ok"]);

    const vu2 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget({ token: { status: 200, body: { access_token: "tok", expires_in: 100 } } }), vu: 2 });
    const data2 = vu2.setup();
    vu2.iterate(data2, 0);
    vu2.clock.now += 70_500;
    vu2.iterate(data2, 1);
    expect(vu2.requests.filter((r) => r.tags.apipilot_kind === "token-refresh")).toHaveLength(0);
  });

  it("does not refresh a token with no stated lifetime, and says so (FR-015)", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget({ token: { status: 200, body: { access_token: "tok" } } }) });
    const data = k6.setup();
    k6.clock.now += 10 * 3_600_000;
    k6.iterate(data, 0);
    expect(k6.requests.filter((r) => r.tags.apipilot_kind === "token-refresh")).toHaveLength(0);
    expect(k6.metrics.filter((m) => m.name === "apipilot_token_refresh").map((m) => m.tags.outcome)).toEqual(["no-lifetime"]);
  });

  it("keeps the old token when a refresh fails, and counts the failure", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    let issued = 0;
    const k6 = loadScript(script, {
      env: envFor(valueIndex, ALL_VALUES),
      respond: (request) => {
        if (request.url.endsWith("/oauth/token")) {
          issued += 1;
          return issued === 1 ? { status: 200, body: { access_token: "first", expires_in: 10 } } : { status: 429 };
        }
        return stubTarget()(request);
      },
    });
    const data = k6.setup();
    k6.clock.now += 20_000;
    k6.iterate(data, 0);
    expect(k6.metrics.filter((m) => m.name === "apipilot_token_refresh").map((m) => m.tags.outcome)).toEqual(["failed"]);
    expect(k6.requests.filter((r) => !r.tags.apipilot_kind).every((r) => r.headers.Authorization === "Bearer first")).toBe(true);
  });

  it("pauses the think time between requests, never after the last one (FR-008, D25)", async () => {
    const { plan, context } = await readyPlan({ thinkTimeMs: 2000 });
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget() });
    k6.iterate(k6.setup(), 0);
    const sentInIteration = k6.requests.filter((r) => !r.tags.apipilot_kind).length;
    expect(k6.sleeps).toEqual(Array.from({ length: sentInIteration - 1 }, () => 2));
  });

  it("follows the plan's journey order (FR-007)", async () => {
    const context = await performanceContext();
    let plan = buildPlan(context);
    plan = applyPlanUpdate(plan, { expectedStatuses: { [plan.journeys[1].steps[0].id]: ["200"] } }, context);
    const reversed = [...plan.journeys].reverse().map((journey) => journey.id);
    plan = applyPlanUpdate(plan, { journeyOrder: reversed }, context);
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget() });
    k6.iterate(k6.setup(), 0);
    expect(k6.requests.filter((r) => !r.tags.apipilot_kind).map((r) => r.tags.journey)).toEqual([
      reversed[0],
      reversed[1],
      reversed[2],
      reversed[2],
    ]);
  });

  it("builds each request exactly as the Postman generator does for the same scenario (FR-011)", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget() });
    k6.iterate(k6.setup(), 0);

    const statusStep = plan.journeys[1].steps[0];
    const approved = { scenarios: context.approvedScenarios };
    const outcome = generateCollection(context.apiModel, approved);
    expect(outcome.ok).toBe(true);
    const items = outcome.ok ? outcome.result.collection.item.flatMap((folder) => ("item" in folder ? folder.item : [folder])) : [];
    const postmanStatus = (items as PostmanRequestItem[]).find((item) => item.provenance?.scenarioId === statusStep.scenarioId)!;
    const k6Status = k6.requests.find((r) => r.tags.step === statusStep.id)!;
    expect(k6Status.method).toBe(postmanStatus.request.method);
    expect(k6Status.url).toBe(postmanStatus.request.url.raw.replace("{{baseUrl}}", ALL_VALUES.baseUrl));
    const nonAuthHeaders = Object.fromEntries(Object.entries(k6Status.headers).filter(([key]) => key !== "Authorization"));
    expect(nonAuthHeaders).toEqual(Object.fromEntries(postmanStatus.request.header.map((h) => [h.key, h.value])));
  });
});

describe("renderScript with chained login and distinct per-role credentials (FR-009)", () => {
  async function credentialContext(): Promise<PerformanceContext> {
    const apiModel: ApiModel = {
      operations: operationsWithDiscoverableProducer,
      securitySchemes: twoBearerSchemes,
      summary: { operationCount: 4, schemaCount: 0, securitySchemeCount: 2, issues: [] },
    };
    return { apiModel, approvedScenarios: generateTestModel(apiModel).scenarios.map((s, i) => ({ ...s, id: `c${String(i).padStart(3, "0")}` })), workflows: [], relationships: [], source: "guided" };
  }

  it("gets the chained-login token from its producer in setup, and a static token from the environment", async () => {
    const context = await credentialContext();
    const plan = buildPlan(context);
    const steps = plan.journeys.flatMap((journey) => journey.steps);
    expect(Object.fromEntries(steps.map((step) => [step.operationKey, step.auth]))).toMatchObject({
      "GET /orders": { kind: "static-credential", schemeName: "bearerAuth" },
      "GET /reports": { kind: "chained-login", schemeName: "adminAuth" },
    });
    expect(plan.userSuppliedValues.map((value) => [value.name, value.secret])).toContainEqual(["token", true]);
    expect(plan.userSuppliedValues.map((value) => value.name)).not.toContain("adminToken");

    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, {
      env: envFor(valueIndex, { baseUrl: "http://t", token: "static-tok" }),
      respond: (request) => (request.url.endsWith("/auth/admin-login") ? { status: 200, body: { adminToken: "admin-tok" } } : { status: 200, body: {} }),
    });
    const data = k6.setup();
    expect(k6.requests.map((r) => [r.url, r.tags.apipilot_kind])).toEqual([["http://t/auth/admin-login", "token-setup"]]);
    k6.iterate(data, 0);
    const byPath = Object.fromEntries(k6.requests.filter((r) => !r.tags.apipilot_kind).map((r) => [new URL(r.url).pathname, r.headers.Authorization]));
    expect(byPath["/orders"]).toBe("Bearer static-tok");
    expect(byPath["/reports"]).toBe("Bearer admin-tok");
  });
});

/** AP-033 FR-006, FR-013, FR-015 (specs/033-edit-step-request-body research R3, R5; tasks T019, T034). */
describe("renderScript with an edited body", () => {
  async function editedPlan(body: unknown): Promise<{ plan: PerformancePlan; context: PerformanceContext; stepId: string }> {
    const { plan, context } = await readyPlan();
    const stepId = plan.journeys.flatMap((journey) => journey.steps).find((step) => step.operationKey === "POST /orders")!.id;
    const edited = applyPlanUpdate(plan, { bodyEdits: { [stepId]: { kind: "json", text: JSON.stringify(body) } } }, context);
    return { plan: edited, context, stepId };
  }

  function journeysOf(script: string): { steps: { id: string; request: { body?: string } }[] }[] {
    return JSON.parse(/^const JOURNEYS = ([\s\S]*?);\n\n/m.exec(script)![1]);
  }

  it("embeds and sends the edited body, still varying the unique field, exactly as the preview shows", async () => {
    const { plan, context, stepId } = await editedPlan({ customerEmail: "buyer@example.com", quantity: 5 });
    const { script, valueIndex } = renderScript(plan, context);
    const embedded = journeysOf(script).flatMap((journey) => journey.steps).find((step) => step.id === stepId)!;
    expect(embedded.request).toEqual(stepRequestFor(plan, context, planAuth(context), stepId).built.template);
    expect(embedded.request.body).toBe(buildStepRequestPreview(plan, context, stepId).body!.text);

    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget(), vu: 3 });
    k6.iterate(k6.setup(), 7);
    const sent = JSON.parse(k6.requests.find((r) => r.method === "POST" && r.url.endsWith("/orders"))!.body!);
    expect(sent.quantity).toBe(5);
    expect(sent.customerEmail).toBe("buyer+vu3-it7@example.com");
  });

  it("renders byte-identical files for the same edits", async () => {
    const first = await editedPlan({ customerEmail: "buyer@example.com", quantity: 5 });
    const second = await editedPlan({ customerEmail: "buyer@example.com", quantity: 5 });
    expect(renderScript(first.plan, first.context)).toEqual(renderScript(second.plan, second.context));
  });

  it("keeps hostile body content as data: the script still loads and sends it byte for byte (FR-013, R5)", async () => {
    const hostile = 'q" b\\ `t` ${1} </script> */     ); throw new Error("ran"); (';
    const { plan, context, stepId } = await editedPlan({ customerEmail: "buyer@example.com", quantity: 1, note: hostile });
    const { script, valueIndex } = renderScript(plan, context);
    const embedded = journeysOf(script).flatMap((journey) => journey.steps).find((step) => step.id === stepId)!;
    expect(JSON.parse(embedded.request.body!).note).toBe(hostile);

    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget() });
    k6.iterate(k6.setup(), 0);
    const sent = JSON.parse(k6.requests.find((r) => r.method === "POST" && r.url.endsWith("/orders"))!.body!);
    expect(sent.note).toBe(hostile);
  });
});
