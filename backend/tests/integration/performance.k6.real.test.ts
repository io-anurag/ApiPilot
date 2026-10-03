import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createK6Probe } from "../../src/performance/k6/readiness";
import { buildChildEnv, buildK6Args, createK6Runner } from "../../src/performance/k6/runner";
import { parseMetricsLine } from "../../src/performance/k6/metricsStream";
import { createAggregate } from "../../src/performance/report/aggregate";
import { TargetServer } from "../fixtures/execution/targetServer";
import { customersTarget } from "../fixtures/execution/customersTarget";

/**
 * Opt-in real-k6 check (specs/031-k6-performance-testing research D24, quickstart scenario 9,
 * tasks T092). Runs only with `K6_TEST_REAL=1` and a k6 1.0.0+ on PATH or in K6_BINARY_PATH:
 * `npm run test:k6-real -w backend`. Never part of `npm test`. Since AP-037 phase two retired the
 * derived plans, the runs it covers are request-chain plans and user-supplied scripts.
 */
const REAL_K6_ENABLED = process.env.K6_TEST_REAL === "1";

describe.runIf(REAL_K6_ENABLED)("real k6 with a user-supplied script", () => {
  const target = new TargetServer();
  let baseUrl = "";

  beforeAll(async () => {
    baseUrl = await target.start();
  });

  afterAll(async () => {
    await target.stop();
  });

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

});

/**
 * AP-037 opt-in real-k6 check (specs/037-request-chain-performance tasks T048; quickstart 1 and 5;
 * SC-003, FR-018). The US1 customer journey built by hand, against the customers target with token
 * issue and 401 without a valid token.
 */
describe.runIf(REAL_K6_ENABLED)("real k6 with a request-chain plan", () => {
  let workDir = "";
  beforeAll(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "apipilot-k6-chain-"));
  });
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));

  async function runChain(
    customers: ReturnType<typeof customersTarget>,
    options: { stages: { durationMs: number; targetVirtualUsers: number }[]; files?: Record<string, string>; plan?: import("@apipilot/shared-domain").ChainPlan; cancelAfterMs?: number },
  ) {
    const { analyzeChainPlan } = await import("@apipilot/shared-domain");
    const { renderChainScript } = await import("../../src/performance/k6/renderChainScript");
    const { planFingerprint } = await import("../../src/performance/chain/savePlan");
    const { chainRunSnapshot } = await import("../../src/performance/chain/runSnapshot");
    const { layoutFromChainSnapshot } = await import("../../src/performance/report/runLayout");
    const { customerLifecyclePlan } = await import("../fixtures/chain/chainPlans");
    const server = new TargetServer();
    server.handle(customers.handler);
    const url = await server.start();
    try {
      const base = options.plan ?? customerLifecyclePlan();
      const plannedDurationMs = options.stages.reduce((total, stage) => total + stage.durationMs, 0);
      const unfingerprinted = { ...base, thinkTimeMs: 0, loadProfile: { kind: "load" as const, stages: options.stages, plannedDurationMs } };
      const plan = { ...unfingerprinted, fingerprint: planFingerprint(unfingerprinted) };
      const analysis = analyzeChainPlan(plan, { environmentValueNames: null });
      const rendered = renderChainScript(plan, analysis);
      const probe = await createK6Probe()({ recheck: true });
      const runDir = mkdtempSync(path.join(workDir, "run-"));
      const scriptPath = path.join(runDir, "script.js");
      writeFileSync(scriptPath, rendered.script);
      for (const [name, content] of Object.entries(options.files ?? {})) writeFileSync(path.join(runDir, name), content);
      const values: Record<string, string> = { baseUrl: url, client_id: "real-client", client_secret: "real-chain-secret" };
      const env = buildChildEnv(process.env, {
        ...Object.fromEntries(Object.entries(rendered.valueIndex).map(([name, index]) => [`APIPILOT_V_${index}`, values[name] ?? ""])),
        APIPILOT_RUN_TAG: "a0a0a0",
      });
      const lines: string[] = [];
      const handle = createK6Runner().start({ runDir, scriptPath, metricsPath: path.join(runDir, "metrics.ndjson"), binaryPath: probe.binaryPath!, env, onLine: (line) => lines.push(line), onStderrLine: () => undefined });
      let cancelledAt: number | null = null;
      if (options.cancelAfterMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.cancelAfterMs));
        cancelledAt = Date.now();
        handle.cancel();
      }
      const exit = await handle.done;
      const cancelledWithinMs = cancelledAt === null ? null : Date.now() - cancelledAt;
      const aggregate = createAggregate(layoutFromChainSnapshot(chainRunSnapshot(plan, analysis)), plannedDurationMs, Date.now() - plannedDurationMs - 5_000);
      for (const line of lines) {
        const parsed = parseMetricsLine(line);
        if (parsed.kind === "point") aggregate.ingest(parsed.point);
      }
      return { exit, aggregate, result: aggregate.toResult(Date.now()), script: rendered.script, lines, cancelledWithinMs };
    } finally {
      await server.stop();
    }
  }

  it("sends the token once before load and every customer request with each virtual user's own id: 10 virtual users, no 401 or 404 (SC-003)", async () => {
    const customers = customersTarget({ auth: {} });
    const { exit, result, script, lines } = await runChain(customers, { stages: [{ durationMs: 10_000, targetVirtualUsers: 10 }] });
    expect(exit.exitCode).toBe(0);
    expect(customers.counts.tokensIssued).toBe(1);
    expect(customers.counts.creates).toBeGreaterThan(10);
    expect(customers.counts.unauthorized).toBe(0);
    // Each iteration deletes its own customer: a reused, stale or another virtual user's id would 404.
    expect(customers.counts.notFound).toBe(0);
    expect(customers.counts.deletes).toBe(customers.counts.creates);
    expect(result.setupSteps).toEqual([expect.objectContaining({ stepId: "s1", outcome: "ok", reason: null })]);
    expect(result.totals.journeysCutShort).toBe(0);
    expect(result.steps.find((step) => step.stepId === "s5")?.checks).toEqual([expect.objectContaining({ checkId: "k3", failed: 0 })]);
    const issued = /cust-\d+|stub-token-\d+/;
    expect(script).not.toMatch(issued);
    expect(lines.some((line) => issued.test(line))).toBe(false);
    expect(script).not.toContain("real-chain-secret");
    // The installed k6 runs with --no-usage-report, and no sample carries a resolved URL (AP-029 FR-040, D11).
    expect(buildK6Args(workDir)).toContain("--no-usage-report");
    const points = lines.map(parseMetricsLine).filter((parsed) => parsed.kind === "point");
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((parsed) => parsed.kind === "point" && parsed.point.tags.url === undefined && parsed.point.tags.name === undefined)).toBe(true);
  }, 120_000);

  it("refreshes the token per virtual user before its stated lifetime ends, with no 401", async () => {
    const customers = customersTarget({ auth: { expiresIn: 4 } });
    const { exit, result } = await runChain(customers, { stages: [{ durationMs: 15_000, targetVirtualUsers: 2 }] });
    expect(exit.exitCode).toBe(0);
    expect(customers.counts.unauthorized).toBe(0);
    expect(customers.counts.tokensIssued).toBeGreaterThan(2);
    expect(result.tokenRefreshes.count).toBeGreaterThan(0);
  }, 120_000);

  it("stops k6 within 10 seconds of a cancel (AP-029 SC-008)", async () => {
    const customers = customersTarget({ auth: {} });
    const { cancelledWithinMs } = await runChain(customers, { stages: [{ durationMs: 120_000, targetVirtualUsers: 2 }], cancelAfterMs: 5_000 });
    expect(cancelledWithinMs).toBeLessThan(10_000);
  }, 60_000);

  it("stops before the load when the Once before load step fails, naming it, and sends no customer request (FR-018)", async () => {
    const customers = customersTarget({ auth: { tokenStatus: 401 } });
    const { exit, aggregate, result } = await runChain(customers, { stages: [{ durationMs: 5_000, targetVirtualUsers: 2 }] });
    expect(exit.exitCode).toBe(108);
    expect(aggregate.setupFailure()).toEqual({ stepId: "s1", reason: "status" });
    expect(result.totals.requests).toBe(0);
    expect(customers.counts.creates).toBe(0);
    expect(customers.counts.unauthorized).toBe(0);
  }, 120_000);

  it("counts each check's failures as the target misbehaves, apart from unexpected statuses (US3)", async () => {
    const { customerLifecyclePlan } = await import("../fixtures/chain/chainPlans");
    const plan = customerLifecyclePlan();
    plan.chains[0].steps[4] = {
      ...plan.chains[0].steps[4],
      checks: [
        { id: "k3", kind: "field-equals", path: "id", expected: { type: "text", value: "{{customer_id}}" } },
        { id: "k4", kind: "body-contains", text: '"status":"ACTIVE"' },
        { id: "k5", kind: "time-at-most", maxMs: 500 },
      ],
    };
    const customers = customersTarget({ auth: {}, wrongIdEvery: 10, slowEvery: 5, slowMs: 600 });
    const { exit, result } = await runChain(customers, { stages: [{ durationMs: 10_000, targetVirtualUsers: 5 }], plan });
    expect(exit.exitCode).toBe(0);
    const read = result.steps.find((step) => step.stepId === "s5")!;
    const byId = new Map((read.checks ?? []).map((check) => [check.checkId, check]));
    expect(byId.get("k3")!.failed).toBe(customers.counts.wrongIds);
    expect(byId.get("k3")!.failed).toBeGreaterThan(0);
    expect(byId.get("k4")!.failed).toBe(0);
    expect(byId.get("k5")!.failed).toBeGreaterThan(0);
    expect(byId.get("k5")!.failed).toBeLessThanOrEqual(customers.counts.slow);
    expect(read.errorRatePercent).toBe(0);
    expect(result.totals.journeysCutShort).toBe(0);
  }, 120_000);

  it("takes data set rows in file order across virtual users, wrapping after the last row, without the values in the result (US6, SC-009)", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseCsv } = await import("../../src/performance/chain/csv");
    const { dataSetPlan } = await import("../fixtures/chain/chainPlans");
    const csv = readFileSync(path.join(__dirname, "..", "fixtures", "chain", "customers.csv"));
    const parsed = parseCsv(csv);
    const customers = customersTarget({ auth: {} });
    const { exit, result, lines } = await runChain(customers, {
      stages: [{ durationMs: 10_000, targetVirtualUsers: 5 }],
      plan: dataSetPlan(),
      files: { "apipilot-data-0.json": JSON.stringify(parsed.rows) },
    });
    expect(exit.exitCode).toBe(0);
    const emails = customers.bodies.map((body) => (body as { email: string }).email);
    const fileEmails = parsed.rows.map((row) => row[3]);
    expect(emails.every((email) => fileEmails.includes(email))).toBe(true);
    const usage = result.dataSets![0];
    expect(usage.takes).toBe(result.totals.iterations);
    expect(usage.takes).toBeGreaterThan(50);
    expect(usage).toMatchObject({ rowsUsed: 50, wrapped: true });
    expect(new Set(emails).size).toBe(50);
    const passwords = parsed.rows.map((row) => row[5]);
    expect(lines.some((line) => passwords.some((password) => line.includes(password)))).toBe(false);
    expect(JSON.stringify(result)).not.toContain("example.test");
  }, 120_000);
});
