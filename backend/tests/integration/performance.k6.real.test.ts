import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createK6Probe } from "../../src/performance/k6/readiness";
import { buildChildEnv, buildK6Args, createK6Runner } from "../../src/performance/k6/runner";
import { parseMetricsLine } from "../../src/performance/k6/metricsStream";
import { renderScript } from "../../src/performance/k6/renderScript";
import { buildPlan } from "../../src/performance/plan/buildPlan";
import { applyPlanUpdate } from "../../src/performance/plan/planUpdate";
import { createAggregate } from "../../src/performance/report/aggregate";
import { performanceContext } from "../fixtures/performance/context";
import { TargetServer } from "../fixtures/execution/targetServer";
import { QUICK_BASE, quickSteps, uploadQuick } from "../fixtures/performance/quickAgent";
import { customersTarget } from "../fixtures/execution/customersTarget";
import { SEEDED_CAPTURED_ID } from "../fixtures/performance/builders";
import { lifecyclePlan } from "../fixtures/performance/userJourneyPlans";

/**
 * Opt-in real-k6 check (specs/031-k6-performance-testing research D24, quickstart scenario 9,
 * tasks T092). Runs only with `K6_TEST_REAL=1` and a k6 1.0.0+ on PATH or in K6_BINARY_PATH:
 * `npm run test:k6-real -w backend`. Never part of `npm test`.
 */
const REAL_K6_ENABLED = process.env.K6_TEST_REAL === "1";

describe.runIf(REAL_K6_ENABLED)("real k6", () => {
  const target = new TargetServer();
  let baseUrl = "";
  let workDir = "";

  beforeAll(async () => {
    target.configure("POST", "/oauth/token", { status: 200, body: { access_token: "real-k6-token", expires_in: 5 } });
    target.configure("POST", "/orders", { status: 201, body: { orderId: "00000000-0000-4000-8000-000000000001" } });
    // AP-032 quick-performance.yaml: the login issues the bearer token; POST /products answers 201.
    target.configure("POST", "/auth/login", { status: 200, body: { accessToken: "real-k6-login-token" } });
    target.configure("POST", "/products", { status: 201, body: {} });
    baseUrl = await target.start();
    workDir = mkdtempSync(path.join(tmpdir(), "apipilot-k6-real-"));
  });

  afterAll(async () => {
    await target.stop();
    rmSync(workDir, { recursive: true, force: true });
  });

  async function scriptFor(stages: { durationMs: number; targetVirtualUsers: number }[]) {
    const context = await performanceContext();
    let plan = buildPlan(context);
    const statusStep = plan.journeys.flatMap((j) => j.steps).find((s) => s.operationKey === "GET /status")!;
    plan = applyPlanUpdate(plan, { expectedStatuses: { [statusStep.id]: ["200"] }, loadProfile: { kind: "load", stages } }, context);
    return { plan, rendered: renderScript(plan, context) };
  }

  function valuesEnv(valueIndex: Record<string, number>): Record<string, string> {
    const values: Record<string, string> = { baseUrl, clientId: "id", clientSecret: "secret", warehouseId: "wh-1" };
    return buildChildEnv(process.env, Object.fromEntries(Object.entries(valueIndex).map(([name, index]) => [`APIPILOT_V_${index}`, values[name]])));
  }

  it("accepts the installed k6, runs with --no-usage-report, streams parseable metrics with no url tag, and refreshes tokens per virtual user", async () => {
    const probe = await createK6Probe()({ recheck: true });
    expect(probe.readiness.state).toBe("ready");
    expect(buildK6Args(workDir)).toContain("--no-usage-report");

    const { plan, rendered } = await scriptFor([{ durationMs: 20_000, targetVirtualUsers: 3 }]);
    const runDir = mkdtempSync(path.join(workDir, "run-"));
    const scriptPath = path.join(runDir, "script.js");
    writeFileSync(scriptPath, rendered.script);
    const lines: string[] = [];
    const handle = createK6Runner().start({
      runDir,
      scriptPath,
      metricsPath: path.join(runDir, "metrics.ndjson"),
      binaryPath: probe.binaryPath!,
      env: valuesEnv(rendered.valueIndex),
      onLine: (line) => lines.push(line),
      onStderrLine: () => undefined,
    });
    const exit = await handle.done;
    expect(exit.exitCode).toBe(0);

    const aggregate = createAggregate(plan, 20_000, Date.now() - 25_000);
    let points = 0;
    for (const line of lines) {
      const parsed = parseMetricsLine(line);
      expect(parsed.kind).not.toBe("unreadable");
      if (parsed.kind !== "point") continue;
      points += 1;
      expect(parsed.point.tags.url).toBeUndefined();
      expect(parsed.point.tags.name).toBeUndefined();
      aggregate.ingest(parsed.point);
    }
    expect(points).toBeGreaterThan(0);
    const result = aggregate.toResult(Date.now());
    expect(result.totals.requests).toBeGreaterThan(0);
    // 5 s tokens refreshed at 70%–80% by each of 3 virtual users over 20 s: several refreshes each.
    expect(result.tokenRefreshes.count).toBeGreaterThanOrEqual(6);
    expect(result.steps.every((step) => step.errorsByCategory.every((entry) => entry.category !== "authentication"))).toBe(true);
    // FR-036 (amended 2026-09-30): a real k6 stream gives every status, the request phases, a per-step timeline and the run's bytes.
    const sent = result.steps.filter((step) => step.requests > 0);
    expect(sent.length).toBeGreaterThan(0);
    for (const step of sent) {
      expect(step.statusesReceived!.reduce((sum, entry) => sum + entry.count, 0)).toBe(step.requests);
      expect(step.phaseTimings!.map((timing) => timing.phase)).toContain("waiting");
      expect(step.timeline!.reduce((sum, point) => sum + point.requests, 0)).toBe(step.requests);
    }
    expect(result.totals.dataReceivedBytes).toBeGreaterThan(0);
    expect(result.totals.iterationDurationMs).not.toBeNull();
  }, 120_000);

  it("stops k6 within 10 seconds of a cancel (SC-008)", async () => {
    const probe = await createK6Probe()({ recheck: true });
    const { rendered } = await scriptFor([{ durationMs: 120_000, targetVirtualUsers: 2 }]);
    const runDir = mkdtempSync(path.join(workDir, "run-"));
    const scriptPath = path.join(runDir, "script.js");
    writeFileSync(scriptPath, rendered.script);
    const handle = createK6Runner().start({
      runDir,
      scriptPath,
      metricsPath: path.join(runDir, "metrics.ndjson"),
      binaryPath: probe.binaryPath!,
      env: valuesEnv(rendered.valueIndex),
      onLine: () => undefined,
      onStderrLine: () => undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const cancelledAt = Date.now();
    handle.cancel();
    const exit = await handle.done;
    expect(exit.cancelled).toBe(true);
    expect(Date.now() - cancelledAt).toBeLessThan(10_000);
  }, 60_000);

  it("runs a quick performance test end to end through its routes, and records it as a quick run (AP-032 FR-020, quickstart 9)", async () => {
    const agent = request.agent(createApp());
    expect((await uploadQuick(agent)).status).toBe(200);
    const plan = (await agent.get(`${QUICK_BASE}/plan`)).body.plan;
    const status = quickSteps(plan).find((step) => step.operationKey === "GET /status")!;
    await agent.put(`${QUICK_BASE}/plan`).send({
      expectedStatuses: { [status.id]: ["200"] },
      loadProfile: { kind: "smoke", stages: [{ durationMs: 5_000, targetVirtualUsers: 1 }] },
    });
    expect((await agent.post(`${QUICK_BASE}/script`)).status).toBe(200);
    const environment = await agent.post("/api/test-generation-workflow/environments").send({
      name: "quick-real",
      tier: "local",
      baseUrl,
      variableValues: { username: "u", password: "p", orderId: "o-1", productId: "p-1" },
    });
    const started = await agent.post(`${QUICK_BASE}/runs`).send({ environmentId: environment.body.environment.id });
    expect(started.status).toBe(200);
    let run = started.body.run;
    for (let attempt = 0; attempt < 120 && run.status === "in-progress"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      run = (await agent.get(`${QUICK_BASE}/runs/${run.id}`)).body.run;
    }
    expect(run.status).toBe("completed");
    expect(run.planSource).toBe("quick");
    expect(run.result.totals.requests).toBeGreaterThan(0);
  }, 120_000);

  it("sends an edited body through a real k6 run (AP-033 FR-006, quickstart 9)", async () => {
    const agent = request.agent(createApp());
    expect((await uploadQuick(agent, { replaceExisting: true })).status).toBe(200);
    const plan = (await agent.get(`${QUICK_BASE}/plan`)).body.plan;
    const status = quickSteps(plan).find((step) => step.operationKey === "GET /status")!;
    const orders = quickSteps(plan).find((step) => step.operationKey === "POST /orders")!;
    const saved = await agent.put(`${QUICK_BASE}/plan`).send({
      expectedStatuses: { [status.id]: ["200"] },
      loadProfile: { kind: "smoke", stages: [{ durationMs: 3_000, targetVirtualUsers: 1 }] },
      bodyEdits: { [orders.id]: { kind: "json", text: JSON.stringify({ customerEmail: "edited@example.com", quantity: 9, note: "AP-033 edited" }) } },
    });
    expect(saved.status).toBe(200);
    expect((await agent.post(`${QUICK_BASE}/script`)).status).toBe(200);
    const environment = await agent.post("/api/test-generation-workflow/environments").send({
      name: "quick-real-edited",
      tier: "local",
      baseUrl,
      variableValues: { username: "u", password: "p", orderId: "o-1", productId: "p-1" },
    });
    const received = target.requests.length;
    const started = await agent.post(`${QUICK_BASE}/runs`).send({ environmentId: environment.body.environment.id });
    expect(started.status).toBe(200);
    let run = started.body.run;
    for (let attempt = 0; attempt < 120 && run.status === "in-progress"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      run = (await agent.get(`${QUICK_BASE}/runs/${run.id}`)).body.run;
    }
    expect(run.status).toBe("completed");
    const sent = target.requests.slice(received).filter((entry) => entry.method === "POST" && entry.path.endsWith("/orders"));
    expect(sent.length).toBeGreaterThan(0);
    for (const entry of sent) {
      expect(entry.body).toMatchObject({ quantity: 9, note: "AP-033 edited" });
      // The unique field is still varied per virtual user and iteration.
      expect((entry.body as { customerEmail: string }).customerEmail).toMatch(/^edited\+vu\d+-it\d+@example\.com$/);
    }
  }, 120_000);

  it("sends edited query parameters through a real k6 run (AP-033 FR-020, amended 2026-09-30)", async () => {
    const agent = request.agent(createApp());
    expect((await uploadQuick(agent, { replaceExisting: true })).status).toBe(200);
    const plan = (await agent.get(`${QUICK_BASE}/plan`)).body.plan;
    const status = quickSteps(plan).find((step) => step.operationKey === "GET /status")!;
    const orders = quickSteps(plan).find((step) => step.operationKey === "GET /orders")!;
    const saved = await agent.put(`${QUICK_BASE}/plan`).send({
      expectedStatuses: { [status.id]: ["200"] },
      loadProfile: { kind: "smoke", stages: [{ durationMs: 3_000, targetVirtualUsers: 1 }] },
      parameterEdits: { [orders.id]: { parameters: [{ location: "query", name: "state", action: "set", value: "closed" }] } },
    });
    expect(saved.status).toBe(200);
    expect((await agent.post(`${QUICK_BASE}/script`)).status).toBe(200);
    const environment = await agent.post("/api/test-generation-workflow/environments").send({
      name: "quick-real-parameters",
      tier: "local",
      baseUrl,
      variableValues: { username: "u", password: "p", orderId: "o-1", productId: "p-1" },
    });
    const received = target.requests.length;
    const started = await agent.post(`${QUICK_BASE}/runs`).send({ environmentId: environment.body.environment.id });
    expect(started.status).toBe(200);
    let run = started.body.run;
    for (let attempt = 0; attempt < 120 && run.status === "in-progress"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      run = (await agent.get(`${QUICK_BASE}/runs/${run.id}`)).body.run;
    }
    expect(run.status).toBe("completed");
    const sent = target.requests.slice(received).filter((entry) => entry.method === "GET" && entry.path.endsWith("/orders"));
    expect(sent.length).toBeGreaterThan(0);
    for (const entry of sent) expect(entry.query).toBe("state=closed");
    expect(run.planSnapshot.parameterEdits).toEqual([]);
    expect(quickSteps(run.planSnapshot).find((step: { id: string }) => step.id === orders.id)).toMatchObject({ parametersEdited: true });
  }, 120_000);

  // AP-034 (specs/034-run-user-k6-script research R10, R13, R21, R23; tasks T064).
  const USER_SCRIPT = [
    'import http from "k6/http";',
    'import { check, group, sleep } from "k6";',
    'import { Counter } from "k6/metrics";',
    'import exec from "k6/execution";',
    'import encoding from "k6/encoding";',
    'import crypto from "k6/crypto";',
    'import { SharedArray } from "k6/data";',
    'import { parseHTML } from "k6/html";',
    'import { setTimeout } from "k6/timers";',
    "",
    'export const options = { vus: 1, duration: "1s", thresholds: { http_req_duration: ["p(95)<0.001"] } };',
    'const items = new SharedArray("items", function () { return ["a", "b"]; });',
    'const hits = new Counter("hits");',
    "",
    "export default function () {",
    "  console.log(__ENV.API_KEY);",
    '  group("items", function () {',
    "    const res = http.get(`${__ENV.BASE_URL}/items/${items[exec.vu.idInTest % 2]}`, { headers: { \"X-Api-Key\": __ENV.API_KEY }, tags: { name: \"GET /items/{id}\" } });",
    '    check(res, { "status 200": (r) => r.status === 200 });',
    "  });",
    "  http.get(`${__ENV.BASE_URL}/plain?x=1`);",
    "  hits.add(1);",
    '  const doc = parseHTML("<p>x</p>");',
    '  const encoded = encoding.b64encode(crypto.sha256("x", "hex"));',
    "  setTimeout(function () {}, 0);",
    '  if (!doc || !encoded) console.log("unexpected");',
    "  sleep(0.2);",
    "}",
    "",
  ].join("\n");

  async function settleUserScriptRun(agent: ReturnType<typeof request.agent>, runId: string) {
    let run = (await agent.get(`/api/user-scripts/runs/${runId}`)).body.run;
    for (let attempt = 0; attempt < 120 && run.status === "in-progress"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      run = (await agent.get(`/api/user-scripts/runs/${runId}`)).body.run;
    }
    return run;
  }

  it("runs a user-supplied script: every allowed module, name and url tags, --stage override, exit 99, console never stored (AP-034)", async () => {
    target.requests.length = 0;
    const agent = request.agent(createApp());
    const uploaded = await agent.post("/api/user-scripts/upload?name=real").set("Content-Type", "application/octet-stream").send(Buffer.from(USER_SCRIPT));
    expect(uploaded.status).toBe(201);
    const script = uploaded.body.script;
    await agent.post(`/api/user-scripts/${script.id}/confirmation`).send({ sha256: script.sha256 });
    await agent.put(`/api/user-scripts/${script.id}/settings`).send({
      mapping: script.settings.mapping.map(({ name, source }: { name: string; source: unknown }) => ({ name, source })),
      removedNames: [],
      load: { kind: "profile", profile: { kind: "smoke", stages: [{ durationMs: 1_000, targetVirtualUsers: 2 }, { durationMs: 3_000, targetVirtualUsers: 2 }] } },
      thresholds: [],
    });
    const environment = await agent.post("/api/test-generation-workflow/environments").send({ name: "user-real", tier: "local", baseUrl, variableValues: { API_KEY: "real-k6-api-key-5f1c" } });
    const started = await agent.post(`/api/user-scripts/${script.id}/runs`).send({ environmentId: environment.body.environment.id, scriptSha256: script.sha256 });
    expect(started.status).toBe(200);
    const run = await settleUserScriptRun(agent, started.body.run.id);

    expect(run).toMatchObject({ status: "completed", k6ExitCode: 99, exitMeaning: "script-thresholds-crossed" });
    expect(run.result.scriptThresholdsOutcome).toBe("crossed");
    const names = run.result.requestGroups.map((group: { displayName: string }) => group.displayName);
    expect(names).toContain("GET /items/{id}");
    expect(names.some((name: string) => /^GET 127\.0\.0\.1:\d+\/plain$/.test(name))).toBe(true);
    // The script asks for 1 VU for 1 s; the --stage override holds 2 VUs for 3 s more.
    expect(Math.max(...run.result.timeline.points.map((point: { virtualUsers: number }) => point.virtualUsers))).toBe(2);
    expect(Date.parse(run.endedAt) - Date.parse(run.startedAt)).toBeGreaterThan(3_000);
    expect(run.result.checks).toEqual([expect.objectContaining({ name: "status 200" })]);
    expect(run.result.customMetrics).toEqual([expect.objectContaining({ name: "hits", type: "counter" })]);
    expect(target.requests.some((recorded) => recorded.headers["x-api-key"] === "real-k6-api-key-5f1c")).toBe(true);
    expect(JSON.stringify(run)).not.toContain("real-k6-api-key-5f1c");
    expect((await agent.get(`/api/user-scripts/runs/${run.id}/report`)).text).not.toContain("real-k6-api-key-5f1c");
  }, 120_000);

  it("runs a downloaded generated quick script as a user script, mapped to the same environment (AP-029 FR-022a, AP-034 quickstart 1.5)", async () => {
    const agent = request.agent(createApp());
    expect((await uploadQuick(agent)).status).toBe(200);
    const plan = (await agent.get(`${QUICK_BASE}/plan`)).body.plan;
    const status = quickSteps(plan).find((step) => step.operationKey === "GET /status")!;
    await agent.put(`${QUICK_BASE}/plan`).send({ expectedStatuses: { [status.id]: ["200"] }, loadProfile: { kind: "smoke", stages: [{ durationMs: 3_000, targetVirtualUsers: 1 }] } });
    expect((await agent.post(`${QUICK_BASE}/script`)).status).toBe(200);
    const downloaded = await agent.get(`${QUICK_BASE}/script/download`);
    const uploaded = await agent.post("/api/user-scripts/upload?name=generated").set("Content-Type", "application/octet-stream").send(Buffer.from(downloaded.text));
    expect(uploaded.status).toBe(201);
    const script = uploaded.body.script;
    expect(script.settings.mapping.find((entry: { name: string }) => entry.name === "APIPILOT_V_0").source).toEqual({ kind: "base-url" });
    await agent.post(`/api/user-scripts/${script.id}/confirmation`).send({ sha256: script.sha256 });
    const environment = await agent.post("/api/test-generation-workflow/environments").send({
      name: "generated-real",
      tier: "local",
      baseUrl,
      variableValues: { username: "u", password: "p", orderId: "o-1", productId: "p-1" },
    });
    const started = await agent.post(`/api/user-scripts/${script.id}/runs`).send({ environmentId: environment.body.environment.id, scriptSha256: script.sha256 });
    expect(started.status).toBe(200);
    const run = await settleUserScriptRun(agent, started.body.run.id);
    expect(run.status).toBe("completed");
    expect(run.result.totals.requests).toBeGreaterThan(0);
  }, 120_000);
});

/**
 * AP-035 opt-in real-k6 check (specs/035-user-defined-journeys quickstart 8; SC-002, SC-003, SC-005;
 * research R8; tasks T056). A create, replace and delete journey against a stateful customers target.
 */
describe.runIf(REAL_K6_ENABLED)("real k6 with a user-defined journey", () => {
  let workDir = "";
  beforeAll(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "apipilot-k6-journeys-"));
  });
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));

  async function run(options: { dropIdEvery?: number }) {
    const server = new TargetServer();
    const customers = customersTarget({ ...options, idPrefix: SEEDED_CAPTURED_ID });
    server.handle(customers.handler);
    const url = await server.start();
    try {
      const { plan, context } = await lifecyclePlan();
      const timed = applyPlanUpdate(plan, { loadProfile: { kind: "load", stages: [{ durationMs: 10_000, targetVirtualUsers: 2 }] } }, context);
      const rendered = renderScript(timed, context);
      const probe = await createK6Probe()({ recheck: true });
      const runDir = mkdtempSync(path.join(workDir, "run-"));
      const scriptPath = path.join(runDir, "script.js");
      writeFileSync(scriptPath, rendered.script);
      const lines: string[] = [];
      const handle = createK6Runner().start({
        runDir,
        scriptPath,
        metricsPath: path.join(runDir, "metrics.ndjson"),
        binaryPath: probe.binaryPath!,
        env: buildChildEnv(process.env, { [`APIPILOT_V_${rendered.valueIndex.baseUrl}`]: url }),
        onLine: (line) => lines.push(line),
        onStderrLine: () => undefined,
      });
      expect((await handle.done).exitCode).toBe(0);
      const aggregate = createAggregate(timed, 10_000, Date.now() - 15_000);
      for (const line of lines) {
        const parsed = parseMetricsLine(line);
        if (parsed.kind === "point") aggregate.ingest(parsed.point);
      }
      return { customers, result: aggregate.toResult(Date.now()), script: rendered.script, lines };
    } finally {
      await server.stop();
    }
  }

  it("sends each virtual user's own id to the bound steps: no request is answered 404 (SC-002)", async () => {
    const { customers, result, script, lines } = await run({});
    expect(customers.counts.creates).toBeGreaterThan(0);
    expect(customers.counts.notFound).toBe(0);
    expect(customers.counts.replaces).toBe(customers.counts.creates);
    expect(customers.counts.deletes).toBe(customers.counts.creates);
    const createStep = result.steps.find((step) => step.operationKey === "POST /api/v1/customers")!;
    expect(createStep.captures).toEqual([{ name: "customer_id", succeeded: customers.counts.creates, failed: 0 }]);
    // SC-005: the ids the target issued appear in no script and no metric.
    expect(script).not.toContain(SEEDED_CAPTURED_ID);
    expect(lines.join("\n")).not.toContain(SEEDED_CAPTURED_ID);
  }, 120_000);

  it("sends no bound step after a dropped id, and records the journey as cut short by the capture (SC-003)", async () => {
    const { customers, result } = await run({ dropIdEvery: 3 });
    const dropped = Math.floor(customers.counts.creates / 3);
    expect(customers.counts.notFound).toBe(0);
    expect(customers.counts.replaces).toBe(customers.counts.creates - dropped);
    const journey = result.journeys.find((candidate) => candidate.runsCutShort > 0)!;
    expect(journey.cutShortByCapture).toEqual({ customer_id: dropped });
  }, 120_000);
});
