import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChainPlan, ChainRun } from "@apipilot/shared-domain";
import { getSharedConnection } from "../../../src/persistence/connection";
import { readyProbe } from "../../fixtures/performance/agent";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { counter, httpReq, sample, vus } from "../../fixtures/performance/ndjson";
import { chainAgent, CHAIN_BASE, createEnvironment, newPlan, savePlanContent } from "../../fixtures/chain/chainAgent";
import { customerLifecyclePlan } from "../../fixtures/chain/chainPlans";

/**
 * AP-037 (specs/037-request-chain-performance tasks T080; SC-005, FR-027, FR-028, FR-044). Sentinels
 * for a literal token, a secret data set cell, an extracted value and a request body are looked for
 * in every place a value could leak. The runtime never writes a value into a tag, so the extracted
 * value is fed here the only way it could arrive, inside a `url` tag k6 would add if `systemTags`
 * were ignored; the aggregate must keep no such tag. The real k6 run (performance.k6.real.test.ts)
 * checks the same for values a live target issues.
 */
const TOKEN = "LEAK-TOKEN-5d1";
const CELL = "LEAK-CELL-5d2";
const EXTRACTED = "LEAK-EXTRACTED-5d3";
const BODY = "LEAK-BODY-5d4";

afterEach(() => vi.restoreAllMocks());

function captureLogs(): string[] {
  const lines: string[] = [];
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
  return lines;
}

function rowsText(table: string): string {
  return JSON.stringify(getSharedConnection().db.prepare(`SELECT * FROM ${table}`).all(), (_key, value: unknown) => (Buffer.isBuffer(value) ? value.toString("latin1") : value));
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("leak scan of a request-chain run (SC-005)", () => {
  it("keeps every sentinel out of stored rows, script, template, snapshot, result, report, responses and logs", async () => {
    const logs = captureLogs();
    const runner = createFakeRunner({ lines: [] });
    const { agent } = await chainAgent({ runner, probe: readyProbe() });
    const responses: string[] = [];
    const record = <T extends { text: string }>(response: T): T => {
      responses.push(response.text);
      return response;
    };

    const plan = await newPlan(agent);
    const environmentId = await createEnvironment(agent, { client_id: "id-1", client_secret: "s" });
    record(await agent.post(`${CHAIN_BASE}/${plan.id}/data-sets`).field("name", "logins").field("mode", "row-per-iteration").attach("file", Buffer.from(`username,password\nada,${CELL}\n`), "logins.csv"));
    const current = (await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan as ChainPlan;
    const dataSetId = current.dataSets[0].id;
    record(await agent.put(`${CHAIN_BASE}/${plan.id}/data-sets/${dataSetId}`).send({ name: "logins", mode: "row-per-iteration", columns: [{ name: "username", secret: false }, { name: "password", secret: true }] }));

    const content = customerLifecyclePlan({ targetEnvironmentId: environmentId });
    content.chains[0].steps[1] = {
      ...content.chains[0].steps[1],
      headers: [{ name: "Authorization", value: `Bearer ${TOKEN}` }],
      body: { kind: "raw", contentType: "application/json", text: `{"note":"${BODY}","password":"{{password}}"}` },
    };
    const saved = record(await savePlanContent(agent, { ...current }, content));
    expect(saved.status).toBe(200);
    record(await agent.post(`${CHAIN_BASE}/${plan.id}/script`));
    const script = record(await agent.get(`${CHAIN_BASE}/${plan.id}/script/download?file=script`)).text;
    const template = record(await agent.get(`${CHAIN_BASE}/${plan.id}/script/download?file=environment-template`)).text;

    runner.lines = [
      vus(1, 0),
      ...httpReq({ step: "s2", journey: "c1", status: 201, method: "POST", durationMs: 10, atMs: 100 }),
      counter("apipilot_capture", { step: "s2", journey: "c1", capture: "customer_id", outcome: "ok" }, 110),
      sample("http_reqs", 1, { step: "s5", journey: "c1", status: "200", method: "GET", url: `http://127.0.0.1:4600/api/v1/customers/${EXTRACTED}` }, 200),
    ];
    const run = (record(await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId })).body as { run: ChainRun }).run;
    const settled = await waitFor(async () => (await agent.get(`${CHAIN_BASE}/runs/${run.id}`)).body.run as ChainRun, (value) => value.status !== "in-progress");
    const report = record(await agent.get(`${CHAIN_BASE}/runs/${run.id}/report`)).text;
    record(await agent.get(`${CHAIN_BASE}/runs/${run.id}`));
    record(await agent.get(`${CHAIN_BASE}/${plan.id}/data-sets/${dataSetId}/preview`));

    const stored = rowsText("chain_plans") + rowsText("chain_plan_data_sets") + rowsText("performance_runs");
    const runRecord = JSON.stringify(settled.snapshot) + JSON.stringify(settled.result);
    const logText = logs.join("\n");

    for (const sentinel of [TOKEN, CELL, EXTRACTED]) {
      expect(stored, sentinel).not.toContain(sentinel);
      expect(script, sentinel).not.toContain(sentinel);
      expect(template, sentinel).not.toContain(sentinel);
      expect(runRecord, sentinel).not.toContain(sentinel);
      expect(report, sentinel).not.toContain(sentinel);
      expect(responses.join("\n"), sentinel).not.toContain(sentinel);
      expect(logText, sentinel).not.toContain(sentinel);
    }
    // The body is the engineer's own text: it is in the plan they read back and in the script's data, and nowhere else.
    expect(stored).not.toContain(BODY);
    expect(runRecord).not.toContain(BODY);
    expect(report).not.toContain(BODY);
    expect(logText).not.toContain(BODY);
    expect(script).toContain(BODY);
  });
});
