import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import type { PerformanceRun } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";
import { unavailableProbe } from "../../fixtures/performance/agent";
import { establishSession } from "../../fixtures/performance/session";

/**
 * AP-037 phase two (specs/037-request-chain-performance tasks T095; FR-036, FR-037;
 * contracts/changes-to-existing-apis.md "Phase two"): runs recorded from the retired plans stay
 * listable and reportable under their old bases, exactly as before, while every plan, script and
 * run-start route of those plans is gone.
 */
const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "performance");
const GUIDED = "/api/test-generation-workflow/performance";
const QUICK = "/api/quick-performance";
const COLLECTION = "/api/collection-performance";

function storedRun(name: string): PerformanceRun {
  return JSON.parse(readFileSync(path.join(FIXTURES, "legacy-runs", `${name}.json`), "utf-8")) as PerformanceRun;
}

async function withLegacyRuns() {
  const agent = request.agent(createApp(undefined, { performance: { probe: unavailableProbe() } }));
  const sessionId = await establishSession(agent);
  for (const name of ["guided", "quick", "collection"]) getPerformanceRunRepository().create(sessionId, storedRun(name));
  return agent;
}

describe("legacy runs after phase two", () => {
  it.each([
    ["guided", GUIDED],
    ["quick", QUICK],
    ["collection", COLLECTION],
  ])("lists, opens and reports a %s run under its old base, with the report unchanged", async (name, base) => {
    const agent = await withLegacyRuns();
    const run = storedRun(name);
    const listed = await agent.get(`${base}/runs`);
    expect(listed.status).toBe(200);
    expect(listed.body.runs.map((entry: { id: string }) => entry.id)).toEqual([run.id]);
    const opened = await agent.get(`${base}/runs/${run.id}`);
    expect(opened.status).toBe(200);
    expect(opened.body.run.planSource).toBe(run.planSource);
    const report = await agent.get(`${base}/runs/${run.id}/report`);
    expect(report.status).toBe(200);
    expect(report.text).toBe(readFileSync(path.join(FIXTURES, "golden", "reports", `${name}.html`), "utf-8"));
  });

  it.each([
    ["guided", GUIDED],
    ["quick", QUICK],
    ["collection", COLLECTION],
  ])("neither lists, opens, reports nor cancels a %s run of another session", async (name, base) => {
    const owner = await withLegacyRuns();
    const other = request.agent(createApp(undefined, { performance: { probe: unavailableProbe() } }));
    await establishSession(other);
    const run = storedRun(name);
    expect((await other.get(`${base}/runs`)).body.runs).toEqual([]);
    for (const response of await Promise.all([
      other.get(`${base}/runs/${run.id}`),
      other.get(`${base}/runs/${run.id}/report`),
      other.post(`${base}/runs/${run.id}/cancel`),
    ])) {
      expect([response.req.method, response.req.path, response.status, response.body.error]).toEqual([response.req.method, response.req.path, 404, "run_not_found"]);
    }
    expect((await owner.get(`${base}/runs/${run.id}`)).status).toBe(200);
  });

  it.each([GUIDED, QUICK, COLLECTION])("no longer serves the plan, script or run-start routes under %s", async (base) => {
    const agent = await withLegacyRuns();
    const removed = [
      agent.get(`${base}/plan`),
      agent.put(`${base}/plan`).send({ thinkTimeMs: 0 }),
      agent.post(`${base}/plan/reset`),
      agent.get(`${base}/plan/values?environmentId=x`),
      agent.get(`${base}/plan/steps/s1/request`),
      agent.get(`${base}/plan/removed-operation?operationKey=x`),
      agent.get(`${base}/plan/response-fields?operationKey=x`),
      agent.post(`${base}/script`),
      agent.get(`${base}/script/download?file=script`),
      agent.post(`${base}/runs`).send({ environmentId: "x" }),
    ];
    // A removed route is Express's own 404, with no application error code (a source's gate, such as
    // quick_test_not_found, would mean the route still exists).
    for (const response of await Promise.all(removed)) expect([response.req.method, response.req.path, response.status, response.body?.error]).toEqual([response.req.method, response.req.path, 404, undefined]);
  });

  it("no longer builds, rebuilds or seeds an environment for a collection plan", async () => {
    const agent = await withLegacyRuns();
    for (const response of await Promise.all([
      agent.post(COLLECTION).send({ collectionId: "x", orderedRequestIds: ["a"] }),
      agent.get(COLLECTION),
      agent.post(`${COLLECTION}/rebuild`),
      agent.post(`${COLLECTION}/environment`).send({}),
    ])) {
      expect([response.req.method, response.req.path, response.status, response.body?.error]).toEqual([response.req.method, response.req.path, 404, undefined]);
    }
  });

  it("keeps the quick test's upload and status for seeding", async () => {
    const agent = await withLegacyRuns();
    expect((await agent.get(QUICK)).status).toBe(404);
    expect((await agent.get(QUICK)).body.error).toBe("quick_test_not_found");
  });
});
