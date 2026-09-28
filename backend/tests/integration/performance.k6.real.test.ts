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
});
