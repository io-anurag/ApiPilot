import { readFileSync } from "node:fs";
import path from "node:path";
import type { ApiModel, PerformancePlan, PostmanRequestItem } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import {
  renderScript,
  renderScriptFrom,
  scriptInputsFromContext,
  SYSTEM_TAGS,
  type RenderedStepInput,
  type RenderedTokenSource,
  type ScriptInputs,
} from "../../../src/performance/k6/renderScript";
import { checkUserScript } from "../../../src/performance/userScript/checkUserScript";
import { buildPlan } from "../../../src/performance/plan/buildPlan";
import { applyPlanUpdate } from "../../../src/performance/plan/planUpdate";
import { stepRequestFor } from "../../../src/performance/plan/planStepRequest";
import { buildStepRequestPreview } from "../../../src/performance/plan/requestPreview";
import { planAuth, type PerformanceContext, type RequestTemplate } from "../../../src/performance/plan/stepRequest";
import { generateCollection } from "../../../src/postman/generateCollection";
import { percentEncode } from "../../../src/postman/parameterSerialization";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import { operationsWithDiscoverableProducer, twoBearerSchemes } from "../../fixtures/postman/credentialFixtures";
import { journeyFixture, planFixture, SEEDED_CAPTURED_ID, SEEDED_CLIENT_ID, SEEDED_CLIENT_SECRET, stepFixture } from "../../fixtures/performance/builders";
import { lifecyclePlan, REPLACE } from "../../fixtures/performance/userJourneyPlans";
import { performanceContext, quickContext, userJourneysContext } from "../../fixtures/performance/context";
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
    // AP-029 FR-022a (amended 2026-10-01): names are read through the literal VALUE_ENV table.
    expect(script).toContain("__ENV[VALUE_ENV[name]]");
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
      { name: "apipilot_cut_short", value: 1, tags: { step: producer.id, journey: plan.journeys[0].id, capture: "orderId" } },
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

/**
 * AP-029 FR-022a (amended 2026-10-01; specs/034-run-user-k6-script research R23, tasks T017): the
 * generated script passes AP-034's check, so its run-time lookups use `Map`s, `const` literal
 * tables and an own-field response walk, with behaviour unchanged.
 */
describe("renderScript runtime that passes the AP-034 check", () => {
  /** Replaces the producer's rendered body path (AP-035 data shape: a list of field names and positions). */
  function withProducerField(script: string, field: string): string {
    const parts = field.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
    return script.replace(/"body": \[\s*"orderId"\s*\]/, `"body": ${JSON.stringify(parts)}`);
  }

  it("declares each value's environment variable in a literal VALUE_ENV table, in plan order", async () => {
    const { plan, context } = await readyPlan();
    const { script } = renderScript(plan, context);
    const match = /^const VALUE_ENV = ([\s\S]*?);\n/m.exec(script);
    expect(match).not.toBeNull();
    const table = JSON.parse(match![1]) as Record<string, string>;
    expect(Object.entries(table)).toEqual(plan.userSuppliedValues.map((value, index) => [value.name, `APIPILOT_V_${index}`]));
  });

  it("reads no property by a run-time key on a non-literal object", async () => {
    for (const { plan, context } of [await readyPlan(), await quickReadyPlan()]) {
      const { script } = renderScript(plan, context);
      for (const construct of ["VALUE_INDEX", "scope.vars[", "scope.tokens[", "vuTokens[", "data.tokens[", "value[part]"]) {
        expect(script).not.toContain(construct);
      }
    }
  });

  it("does not count an inherited name such as toString or length as an extracted value", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    for (const field of ["toString", "length"]) {
      const k6 = loadScript(withProducerField(script, field), { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget() });
      k6.iterate(k6.setup(), 0);
      expect(k6.checks.filter((c) => c.name === "extraction").map((c) => c.passed)).toEqual([false]);
      expect(k6.metrics.filter((m) => m.name === "apipilot_cut_short")).toHaveLength(1);
      expect(k6.requests.some((r) => r.url.includes("/orders/"))).toBe(false);
    }
  });

  it("still extracts through an array index such as items.0.id", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(withProducerField(script, "items.0.id"), {
      env: envFor(valueIndex, ALL_VALUES),
      respond: stubTarget({ orders: { status: 201, body: { items: [{ id: "item-7" }] } } }),
    });
    k6.iterate(k6.setup(), 0);
    expect(k6.requests.some((r) => r.url.endsWith("/orders/item-7"))).toBe(true);
  });

  it("passes setup tokens to every virtual user as an array that survives k6's JSON hand-off", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const vu1 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget(), vu: 1 });
    const data = vu1.setup() as { tokens: unknown };
    expect(Array.isArray(data.tokens)).toBe(true);
    const vu2 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget(), vu: 2 });
    vu2.iterate(data, 0);
    expect(vu2.requests.filter((r) => !r.tags.apipilot_kind).every((r) => r.headers.Authorization === "Bearer tok-1")).toBe(true);
  });
});

/** AP-035 FR-010, FR-018, FR-033 (specs/035-user-defined-journeys research R7; tasks T007). */
describe("renderScript capture rule for every journey (AP-035 FR-033)", () => {
  /** The runtime text, with AP-029's one plan-dependent line (Basic auth used or not) normalized. */
  function runtimeOf(script: string): string {
    return script
      .slice(script.indexOf('const missingData = new Counter("apipilot_missing_data");'))
      .replace(/^ {4}headers\.Authorization = "Basic ".*$/m, "    // Basic auth is not used by this plan.");
  }

  it("attempts no capture on an unexpected status, even when the field is there, and cuts the journey short", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget({ orders: { status: 500, body: { orderId: ORDER_ID } } }) });
    k6.iterate(k6.setup(), 0);
    expect(k6.requests.some((r) => r.url.includes(`/orders/${ORDER_ID}`))).toBe(false);
    expect(k6.metrics.filter((m) => m.name === "apipilot_capture").map((m) => m.tags.outcome)).toEqual(["failed"]);
    expect(k6.metrics.filter((m) => m.name === "apipilot_cut_short")).toHaveLength(1);
  });

  it.each([
    ["an object", { id: 1 }],
    ["an array", [1, 2]],
    ["null", null],
    ["an empty string", ""],
  ])("fails a capture of %s", async (_label, value) => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget({ orders: { status: 201, body: { orderId: value } } }) });
    k6.iterate(k6.setup(), 0);
    expect(k6.requests.some((r) => r.url.includes("/orders/") && !r.url.endsWith("/orders"))).toBe(false);
    expect(k6.metrics.filter((m) => m.name === "apipilot_cut_short").map((m) => m.tags.capture)).toEqual(["orderId"]);
  });

  it.each([
    ["a number", 42, "42"],
    ["a boolean", true, "true"],
  ])("sends %s as its text", async (_label, value, text) => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget({ orders: { status: 201, body: { orderId: value } } }) });
    k6.iterate(k6.setup(), 0);
    expect(k6.requests.some((r) => r.url.endsWith(`/orders/${text}`))).toBe(true);
    expect(k6.metrics.filter((m) => m.name === "apipilot_capture")).toEqual([
      { name: "apipilot_capture", value: 1, tags: { step: plan.journeys[0].steps[0].id, journey: plan.journeys[0].id, capture: "orderId", outcome: "ok" } },
    ]);
  });

  it("fails every body capture of a response that is not JSON", async () => {
    const { plan, context } = await readyPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, { env: envFor(valueIndex, ALL_VALUES), respond: stubTarget({ orders: { status: 201, body: "<html>created</html>" } }) });
    k6.iterate(k6.setup(), 0);
    expect(k6.metrics.filter((m) => m.name === "apipilot_capture").map((m) => m.tags.outcome)).toEqual(["failed"]);
  });

  it("uses the same runtime text for every plan: only the data differs (FR-018)", async () => {
    const guided = renderScript(...Object.values(await readyPlan()) as [PerformancePlan, PerformanceContext]).script;
    const quick = renderScript(...Object.values(await quickReadyPlan()) as [PerformancePlan, PerformanceContext]).script;
    // The basic-auth line is the one documented per-plan variation of the runtime.
    const normalized = (text: string) => runtimeOf(text).replace(/^ {4}headers\.Authorization = "Basic ".*$/m, "    // Basic auth is not used by this plan.");
    expect(normalized(guided)).toBe(normalized(quick));
    expect(runtimeOf(guided).length).toBeGreaterThan(1000);
  });

  it("still passes AP-034's script check (AP-029 FR-022a)", async () => {
    const { checkUserScript } = await import("../../../src/performance/userScript/checkUserScript");
    for (const { plan, context } of [await readyPlan(), await quickReadyPlan()]) {
      const result = checkUserScript(Buffer.from(renderScript(plan, context).script, "utf-8"));
      expect(result.accepted ? [] : result.problems).toEqual([]);
      expect(result.accepted).toBe(true);
    }
  });
});

/** AP-035 FR-017 to FR-021, SC-002 to SC-005 (specs/035-user-defined-journeys; tasks T019). */
describe("renderScript with a user-defined journey (AP-035)", () => {
  const BASE = "http://127.0.0.1:4600";

  async function lifecycle() {
    const { plan, context } = await lifecyclePlan();
    const rendered = renderScript(plan, context);
    return { plan, context, ...rendered, env: envFor(rendered.valueIndex, { baseUrl: BASE }) };
  }

  /** A target whose create returns `id`, numbered per virtual user and iteration, or nothing when `drop` says so. */
  function customers(vuOf: () => number, iterationOf: () => number, drop: (n: number) => boolean = () => false) {
    let created = 0;
    return (request: SandboxRequest): SandboxResponse => {
      if (request.method === "POST" && request.url.endsWith("/api/v1/customers")) {
        created += 1;
        return { status: 201, body: drop(created) ? { name: "x" } : { id: `vu${vuOf()}-it${iterationOf()}`, name: "x" }, headers: { Location: `/api/v1/customers/vu${vuOf()}` } };
      }
      return { status: request.method === "DELETE" ? 204 : 200, body: {} };
    };
  }

  it("sends each virtual user's own id from the same iteration to the bound steps (FR-017, SC-002)", async () => {
    const { script, env } = await lifecycle();
    for (const vu of [1, 2]) {
      let iteration = 0;
      const k6 = loadScript(script, { env, vu, respond: customers(() => vu, () => iteration) });
      const data = k6.setup();
      for (iteration = 0; iteration < 3; iteration++) k6.iterate(data, iteration);
      const bound = k6.requests.filter((r) => r.method === "PUT" || r.method === "DELETE");
      expect(bound).toHaveLength(6);
      bound.forEach((request, index) => expect(request.url).toBe(`${BASE}/api/v1/customers/vu${vu}-it${Math.floor(index / 2)}`));
    }
  });

  it("sends no bound step after a failed capture and counts the journey as cut short by the capture (FR-019, SC-003)", async () => {
    const { plan, script, env } = await lifecycle();
    const journey = plan.journeys.find((candidate) => candidate.source.kind === "user")!;
    const k6 = loadScript(script, { env, respond: customers(() => 1, () => 0, () => true) });
    k6.iterate(k6.setup(), 0);
    expect(k6.requests.some((r) => r.method === "PUT" || r.method === "DELETE")).toBe(false);
    expect(k6.metrics.filter((m) => m.name === "apipilot_cut_short")).toEqual([
      { name: "apipilot_cut_short", value: 1, tags: { step: journey.steps[0].id, journey: journey.id, capture: "customer_id" } },
    ]);
    expect(k6.metrics.filter((m) => m.name === "apipilot_capture").map((m) => m.tags)).toEqual([
      { step: journey.steps[0].id, journey: journey.id, capture: "customer_id", outcome: "failed" },
    ]);
  });

  it("keeps a captured value out of every tag, check and the script, apart from the bound requests (SC-005, FR-020)", async () => {
    const { script, env } = await lifecycle();
    const k6 = loadScript(script, {
      env,
      respond: (request) =>
        request.method === "POST" && request.url.endsWith("/customers") ? { status: 201, body: { id: SEEDED_CAPTURED_ID } } : { status: 200, body: {} },
    });
    k6.iterate(k6.setup(), 0);
    expect(script).not.toContain(SEEDED_CAPTURED_ID);
    expect(JSON.stringify(k6.metrics)).not.toContain(SEEDED_CAPTURED_ID);
    expect(JSON.stringify(k6.checks)).not.toContain(SEEDED_CAPTURED_ID);
    const carrying = k6.requests.filter((r) => JSON.stringify(r).includes(SEEDED_CAPTURED_ID));
    expect(carrying.map((r) => r.method)).toEqual(["PUT", "DELETE"]);
    expect(carrying.every((r) => r.url.endsWith(`/${SEEDED_CAPTURED_ID}`) && !JSON.stringify(r.tags).includes(SEEDED_CAPTURED_ID))).toBe(true);
  });

  it("leaves an incomplete journey out of the script (FR-025)", async () => {
    const { plan, context } = await lifecyclePlan();
    const incomplete = applyPlanUpdate(plan, { excludedOperationKeys: [REPLACE] }, context);
    const journey = incomplete.journeys.find((candidate) => candidate.source.kind === "user")!;
    expect(renderScript(incomplete, context).script).not.toContain(journey.id);
  });

  it("renders byte-identical files 10 times and matches the reviewed golden script (SC-004)", async () => {
    const { plan, context } = await lifecyclePlan();
    const first = renderScript(plan, context);
    for (let index = 0; index < 9; index++) expect(renderScript(plan, context)).toEqual(first);
    expect(first.script).toBe(readFileSync(path.join(GOLDEN, "user-journeys-script.js"), "utf-8"));
  });
});

/** AP-035 User Story 2: header captures and body, query and header bindings (FR-007, FR-011, FR-013; research R8; tasks T039). */
describe("renderScript with captures from headers and bindings anywhere", () => {
  const BASE = "http://127.0.0.1:4600";

  async function ordersPlan() {
    const context = await userJourneysContext();
    const plan = applyPlanUpdate(
      buildPlan(context),
      {
        userJourneys: [
          {
            name: "Orders",
            steps: [
              {
                operationKey: "POST /api/v1/customers",
                captures: [
                  { name: "customer_id", source: { kind: "body", path: "id" } },
                  { name: "customer_url", source: { kind: "header", name: "LOCATION" } },
                ],
              },
              { operationKey: "POST /api/v1/orders", bindings: [{ target: { kind: "body", fieldPath: "customerId" }, captureStepIndex: 0, captureName: "customer_id" }] },
              { operationKey: "GET /api/v1/orders/{id}", bindings: [{ target: { kind: "query", name: "customer" }, captureStepIndex: 0, captureName: "customer_id" }, { target: { kind: "path", name: "id" }, captureStepIndex: 0, captureName: "customer_url" }] },
            ],
          },
        ],
      },
      context,
    );
    return { plan, context };
  }

  it("matches a header regardless of case and takes the whole value; fills body and query targets, escaped (R8, FR-011)", async () => {
    const { plan, context } = await ordersPlan();
    const { script, valueIndex } = renderScript(plan, context);
    const k6 = loadScript(script, {
      env: envFor(valueIndex, { baseUrl: BASE }),
      respond: (request) =>
        request.method === "POST" && request.url.endsWith("/api/v1/customers")
          ? { status: 201, body: { id: 'c "1"/ü' }, headers: { Location: "/api/v1/customers/c1, /api/v1/customers/c2" } }
          : { status: request.url.includes("/orders/") ? 200 : 201, body: {} },
    });
    k6.iterate(k6.setup(), 0);
    const order = k6.requests.find((r) => r.method === "POST" && r.url.endsWith("/api/v1/orders"))!;
    expect(JSON.parse(order.body!)).toMatchObject({ customerId: 'c "1"/ü' });
    const read = k6.requests.find((r) => r.method === "GET" && r.url.includes("/api/v1/orders/"))!;
    expect(read.url).toBe(`${BASE}/api/v1/orders/${encodeURIComponent("/api/v1/customers/c1, /api/v1/customers/c2")}?customer=${encodeURIComponent('c "1"/ü')}`);
  });

  it("lists a bound body field under \"Replaced at run time\" with the capture as its source (FR-013)", async () => {
    const { plan, context } = await ordersPlan();
    const order = plan.journeys.find((journey) => journey.source.kind === "user")!.steps[1];
    const preview = buildStepRequestPreview(plan, context, order.id);
    expect(preview.bodyEdit!.replacements).toEqual([
      { fieldPath: "customerId", reference: expect.objectContaining({ kind: "capture", captureName: "customer_id", producerStepId: plan.journeys.find((journey) => journey.source.kind === "user")!.steps[0].id }) },
    ]);
  });

  it("counts a repeated operation as its own step in the script (FR-002)", async () => {
    const context = await userJourneysContext();
    const plan = applyPlanUpdate(buildPlan(context), { userJourneys: [{ name: "Twice", steps: [{ operationKey: "GET /api/v1/customers/{id}" }, { operationKey: "GET /api/v1/customers/{id}" }] }] }, context);
    const { script } = renderScript(plan, context);
    const journey = plan.journeys.find((candidate) => candidate.source.kind === "user")!;
    expect(journey.steps).toHaveLength(2);
    for (const step of journey.steps) expect(script).toContain(`"id": "${step.id}"`);
  });
});

/**
 * AP-036 (specs/036-collection-performance-test research R2, R9, R10; tasks T007): the renderer's
 * explicit inputs and the one runtime change every plan shares.
 */
describe("renderScript inputs and the AP-036 runtime additions", () => {
  const BASE = "http://127.0.0.1:4600";
  const TOKEN_A = "apipilot_t_aaaa_access_token";
  const TOKEN_B = "apipilot_t_aaaa_tenant";
  const TOKEN_C = "apipilot_t_bbbb_session";

  function template(overrides: Partial<RequestTemplate> = {}): RequestTemplate {
    return { method: "GET", url: "{{baseUrl}}/items", headers: [], auth: { kind: "none" }, ...overrides };
  }

  function stepInput(overrides: Partial<RenderedStepInput> = {}): RenderedStepInput {
    return { operationKey: "GET /items", request: template(), expected: ["200"], needs: ["baseUrl"], dependsOn: [], captures: [], tokenSchemes: [], ...overrides };
  }

  function tokenSource(scheme: string, overrides: Partial<RenderedTokenSource> = {}): RenderedTokenSource {
    return {
      scheme,
      kind: "collection-request",
      request: template({ method: "POST", url: "{{baseUrl}}/auth/token" }),
      needs: ["baseUrl"],
      captures: [{ key: TOKEN_A, name: "access_token", source: { body: ["access_token"] } }],
      expected: ["200"],
      ...overrides,
    };
  }

  function render(inputs: Partial<ScriptInputs>, step: RenderedStepInput = stepInput()) {
    const plan = planFixture({ journeys: [journeyFixture({ id: "j_items", steps: [stepFixture({ id: "s_items" })] })] });
    return renderScriptFrom(plan, { steps: new Map([["s_items", step]]), tokenSources: [], unique: [], dynamic: [], ...inputs });
  }

  /** The runtime text, with AP-029's one plan-dependent line (Basic auth used or not) normalized. */
  function runtimeOf(script: string): string {
    return script
      .slice(script.indexOf('const missingData = new Counter("apipilot_missing_data");'))
      .replace(/^ {4}headers\.Authorization = "Basic ".*$/m, "    // Basic auth is not used by this plan.");
  }

  it("renders a context's plan exactly as its explicit inputs (R2)", async () => {
    const { plan, context } = await readyPlan();
    expect(renderScript(plan, context)).toEqual(renderScriptFrom(plan, scriptInputsFromContext(plan, context)));
  });

  it("renders DYNAMIC as {} when no dynamic variable is used, and keeps one runtime text for every plan (R9, AP-035 FR-018)", async () => {
    const guided = await readyPlan();
    const guidedScript = renderScript(guided.plan, guided.context).script;
    expect(guidedScript).toContain("const DYNAMIC = {};");
    const journeys = await lifecyclePlan();
    const dynamic = render({ dynamic: [{ token: "apipilot_dyn_0", kind: "$guid" }] }, stepInput({ request: template({ url: "{{baseUrl}}/items/{{apipilot_dyn_0}}" }) })).script;
    expect(dynamic).toContain('"apipilot_dyn_0": {\n    "kind": "$guid"\n  }');
    expect(runtimeOf(renderScript(journeys.plan, journeys.context).script)).toBe(runtimeOf(guidedScript));
    expect(runtimeOf(dynamic)).toBe(runtimeOf(guidedScript));
  });

  it("checks a credential request's status and takes each capture before the load (R8, R10)", () => {
    const source = tokenSource("s_aaaa", {
      captures: [
        { key: TOKEN_A, name: "access_token", source: { body: ["access_token"] } },
        { key: TOKEN_B, name: "tenant", source: { header: "x-tenant" } },
      ],
    });
    const step = stepInput({ request: template({ auth: { kind: "bearer", token: `{{${TOKEN_A}}}` }, headers: [{ key: "X-Tenant", value: `{{${TOKEN_B}}}` }] }), tokenSchemes: ["s_aaaa"] });
    const { script, valueIndex } = render({ tokenSources: [source] }, step);
    const k6 = loadScript(script, {
      env: envFor(valueIndex, { baseUrl: BASE }),
      respond: (request) =>
        request.url.endsWith("/auth/token") ? { status: 200, body: { access_token: "tok-1" }, headers: { "X-Tenant": "acme" } } : { status: 200, body: {} },
    });
    k6.iterate(k6.setup());
    const sent = k6.requests.find((request) => request.url.endsWith("/items"))!;
    expect(sent.headers.Authorization).toBe("Bearer tok-1");
    expect(sent.headers["X-Tenant"]).toBe("acme");
    expect(k6.metrics.filter((metric) => metric.name === "apipilot_token_refresh").map((metric) => metric.tags.outcome)).toEqual(["no-lifetime"]);
  });

  it("counts setup-failed for an unexpected status or a non-scalar capture, and leaves the token empty (R8, FR-029)", () => {
    const step = stepInput({ request: template({ auth: { kind: "bearer", token: `{{${TOKEN_A}}}` } }), tokenSchemes: ["s_aaaa"] });
    for (const [response, capture] of [
      [{ status: 500, body: { access_token: "tok-1" } }, ""],
      [{ status: 200, body: { access_token: { nested: true } } }, "access_token"],
    ] as const) {
      const { script, valueIndex } = render({ tokenSources: [tokenSource("s_aaaa")] }, step);
      const k6 = loadScript(script, {
        env: envFor(valueIndex, { baseUrl: BASE }),
        respond: (request) => (request.url.endsWith("/auth/token") ? response : { status: 401, body: {} }),
      });
      k6.iterate(k6.setup());
      expect(k6.metrics.filter((metric) => metric.name === "apipilot_token_refresh").map((metric) => metric.tags)).toEqual([
        { outcome: "setup-failed", scheme: "s_aaaa", capture },
      ]);
      expect(k6.requests.find((request) => request.url.endsWith("/items"))!.headers.Authorization).toBe("Bearer ");
    }
  });

  it("acquires a credential request that uses an earlier one's value after it, and refreshes every source a step uses (R8, R10)", () => {
    const first = tokenSource("s_aaaa");
    const second = tokenSource("s_bbbb", {
      request: template({ method: "POST", url: "{{baseUrl}}/sessions", auth: { kind: "bearer", token: `{{${TOKEN_A}}}` } }),
      captures: [{ key: TOKEN_C, name: "session", source: { body: ["session"] } }],
    });
    const step = stepInput({ request: template({ headers: [{ key: "X-Session", value: `{{${TOKEN_C}}}` }], auth: { kind: "bearer", token: `{{${TOKEN_A}}}` } }), tokenSchemes: ["s_aaaa", "s_bbbb"] });
    const { script, valueIndex } = render({ tokenSources: [first, second] }, step);
    let issued = 0;
    const k6 = loadScript(script, {
      env: envFor(valueIndex, { baseUrl: BASE }),
      respond: (request) => {
        if (request.url.endsWith("/auth/token")) return { status: 200, body: { access_token: `tok-${++issued}`, expires_in: 10 } };
        if (request.url.endsWith("/sessions")) return { status: 200, body: { session: `ses-for-${request.headers.Authorization}`, expires_in: 10 } };
        return { status: 200, body: {} };
      },
    });
    const data = k6.setup();
    expect(k6.requests.map((request) => request.url.slice(BASE.length))).toEqual(["/auth/token", "/sessions"]);
    expect(k6.requests[1].headers.Authorization).toBe("Bearer tok-1");
    k6.iterate(data);
    k6.clock.now += 9_900;
    k6.iterate(data, 1);
    const refreshes = k6.metrics.filter((metric) => metric.name === "apipilot_token_refresh" && metric.tags.outcome === "ok").map((metric) => metric.tags.scheme);
    expect(refreshes).toEqual(["s_aaaa", "s_bbbb"]);
    const last = k6.requests[k6.requests.length - 1];
    expect(last.headers.Authorization).toBe("Bearer tok-2");
    expect(last.headers["X-Session"]).toBe("ses-for-Bearer tok-2");
  });

  it("fills a form body's references URL-encoded (R11)", () => {
    const step = stepInput({ request: template({ method: "POST", body: "name={{who}}&fixed=a%20b", bodyKind: "form" }), needs: ["baseUrl", "who"] });
    const plan = planFixture({
      journeys: [journeyFixture({ id: "j_items", steps: [stepFixture({ id: "s_items" })] })],
      userSuppliedValues: [
        { name: "baseUrl", secret: false, neededBySteps: ["s_items"], source: "base-url" },
        { name: "who", secret: false, neededBySteps: ["s_items"], source: "collection-variable" },
      ],
    });
    const { script, valueIndex } = renderScriptFrom(plan, { steps: new Map([["s_items", step]]), tokenSources: [], unique: [], dynamic: [] });
    const k6 = loadScript(script, { env: envFor(valueIndex, { baseUrl: BASE, who: "Ada & Grace/ü" }), respond: () => ({ status: 200, body: {} }) });
    k6.iterate(k6.setup());
    expect(k6.requests[0].body).toBe("name=Ada%20%26%20Grace%2F%C3%BC&fixed=a%20b");
  });

  describe("dynamic values (R9, FR-013, SC-006)", () => {
    const KINDS = ["$guid", "$randomUUID", "$timestamp", "$isoTimestamp", "$randomInt", "$randomFirstName", "$randomLastName", "$randomFullName", "$randomUserName", "$randomEmail", "$randomPhoneNumber", "$randomAlphaNumeric", "$randomBoolean"];
    const dynamic = KINDS.map((kind, k) => ({ token: `apipilot_dyn_${k}`, kind }));
    const body = `{${dynamic.map((entry, k) => `"v${k}":"{{${entry.token}}}"`).join(",")}}`;

    function generated(options: { vu: number; iteration: number; tag?: string }): string[] {
      const step = stepInput({ request: template({ method: "POST", body, bodyKind: "json" }) });
      const { script, valueIndex } = render({ dynamic }, step);
      const k6 = loadScript(script, {
        env: { ...envFor(valueIndex, { baseUrl: BASE }), ...(options.tag === undefined ? {} : { APIPILOT_RUN_TAG: options.tag }) },
        respond: () => ({ status: 200, body: {} }),
        vu: options.vu,
      });
      k6.iterate(k6.setup(), options.iteration);
      const sent = JSON.parse(k6.requests[0].body!) as Record<string, string>;
      return KINDS.map((_kind, k) => sent[`v${k}`]);
    }

    it("generates each kind in its format, reproducibly for the same virtual user, iteration, occurrence and tag", () => {
      const values = generated({ vu: 3, iteration: 7, tag: "a1b2c3" });
      const [guid, uuid, timestamp, iso, int, first, last, full, user, email, phone, alpha, bool] = values;
      for (const value of [guid, uuid]) expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(guid).toBe("00000003-0000-4a1b-82c3-000000000007");
      expect(timestamp).toBe(String(Math.floor(Date.parse("2026-09-27T12:00:00.000Z") / 1000)));
      expect(iso).toBe("2026-09-27T12:00:00.000Z");
      expect(Number(int)).toBeGreaterThanOrEqual(0);
      expect(Number(int)).toBeLessThanOrEqual(1000);
      expect(first).toMatch(/^[A-Z][a-z]+$/);
      expect(last).toMatch(/^[A-Z][a-z]+$/);
      expect(full).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(user).toMatch(/^[a-z]+\.[a-z]+_ra1b2c3_vu3_it7_8$/);
      expect(email).toMatch(/^[a-z]+\.[a-z]+\+ra1b2c3-vu3-it7-9@example\.com$/);
      expect(phone).toMatch(/^\d{3}-\d{3}-\d{4}$/);
      expect(alpha).toMatch(/^[0-9a-z]$/);
      expect(["true", "false"]).toContain(bool);
      expect(generated({ vu: 3, iteration: 7, tag: "a1b2c3" })).toEqual(values);
    });

    it("makes the unique kinds unique over 10 virtual users × 10 iterations × every occurrence, and different between run tags", () => {
      const UNIQUE_KINDS = [0, 1, 8, 9];
      const seen = new Set<string>();
      let count = 0;
      for (let vu = 1; vu <= 10; vu++) {
        for (let iteration = 0; iteration < 10; iteration++) {
          const values = generated({ vu, iteration, tag: "0f0f0f" });
          for (const index of UNIQUE_KINDS) {
            seen.add(values[index]);
            count += 1;
          }
        }
      }
      expect(seen.size).toBe(count);
      const other = generated({ vu: 1, iteration: 0, tag: "abcdef" });
      const same = generated({ vu: 1, iteration: 0, tag: "0f0f0f" });
      for (const index of UNIQUE_KINDS) expect(other[index]).not.toBe(same[index]);
    });

    it("treats a run tag that is not 6 lowercase hex characters as no tag", () => {
      const none = generated({ vu: 2, iteration: 1 });
      expect(none[0]).toBe("00000002-0000-4000-8000-000000000001");
      expect(none[9]).toMatch(/^[a-z]+\.[a-z]+\+vu2-it1-9@example\.com$/);
      for (const tag of ["ABCDEF", "abc", "a1b2c3d", "zzzzzz", "'; x"]) expect(generated({ vu: 2, iteration: 1, tag })).toEqual(none);
    });

    it("gives two occurrences of one variable their own values (US2 AS2)", () => {
      const twice = [
        { token: "apipilot_dyn_0", kind: "$randomEmail" },
        { token: "apipilot_dyn_1", kind: "$randomEmail" },
      ];
      const step = stepInput({ request: template({ method: "POST", body: '{"a":"{{apipilot_dyn_0}}","b":"{{apipilot_dyn_1}}"}', bodyKind: "json" }) });
      const { script, valueIndex } = render({ dynamic: twice }, step);
      const k6 = loadScript(script, { env: envFor(valueIndex, { baseUrl: BASE }), respond: () => ({ status: 200, body: {} }) });
      k6.iterate(k6.setup());
      const sent = JSON.parse(k6.requests[0].body!) as { a: string; b: string };
      expect(sent.a).not.toBe(sent.b);
    });
  });

  it("keeps every golden and a dynamic-value script accepted by AP-034's check, which lists APIPILOT_RUN_TAG (FR-022a, R9)", async () => {
    for (const file of ["script.js", "user-journeys-script.js"]) {
      const result = checkUserScript(readFileSync(path.join(GOLDEN, file)));
      expect(result.accepted).toBe(true);
      expect(result.envNames.map((entry) => entry.name)).toContain("APIPILOT_RUN_TAG");
    }
    const dynamic = render({ dynamic: [{ token: "apipilot_dyn_0", kind: "$randomEmail" }] }, stepInput({ request: template({ method: "POST", body: '{"e":"{{apipilot_dyn_0}}"}', bodyKind: "json" }) }));
    expect(checkUserScript(Buffer.from(dynamic.script)).accepted).toBe(true);
  });
});
