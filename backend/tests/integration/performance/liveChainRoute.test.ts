import { describe, expect, it } from "vitest";
import type { ChainPlan, ChainRun, LiveRunSnapshot } from "@apipilot/shared-domain";
import { readyProbe } from "../../fixtures/performance/agent";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { httpReq, vus } from "../../fixtures/performance/ndjson";
import { chainAgent, CHAIN_BASE, createEnvironment, newPlan, savePlanContent } from "../../fixtures/chain/chainAgent";
import { customerLifecyclePlan } from "../../fixtures/chain/chainPlans";

/** AP-045 (specs/045-live-run-dashboard contracts/live-run-routes.md): the chain run's live read route. */

const VALUES = { client_id: "id-1", client_secret: "secret-LIVE-7f3" };

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const LINES = [
  vus(2, 0),
  ...httpReq({ step: "s2", journey: "c1", status: 201, method: "POST", durationMs: 40, atMs: 200 }),
  ...httpReq({ step: "s4", journey: "c1", status: 404, method: "PUT", durationMs: 20, atMs: 300 }),
];

async function startedRun(options: { hold: boolean }) {
  const runner = createFakeRunner({ lines: LINES, lineIntervalMs: 1, holdUntilCancelled: options.hold });
  const { agent } = await chainAgent({ runner, probe: readyProbe(), tickIntervalMs: 20 });
  const plan = await newPlan(agent);
  const environmentId = await createEnvironment(agent, VALUES);
  const saved = (await savePlanContent(agent, plan, customerLifecyclePlan({ targetEnvironmentId: environmentId }))).body.plan as ChainPlan;
  await agent.post(`${CHAIN_BASE}/${saved.id}/script`);
  const run = (await agent.post(`${CHAIN_BASE}/${saved.id}/runs`).send({ environmentId })).body.run as ChainRun;
  return { agent, run };
}

const liveOf = (agent: Awaited<ReturnType<typeof startedRun>>["agent"], runId: string, query = "") => agent.get(`${CHAIN_BASE}/runs/${runId}/live${query}`);

describe("GET /api/chain-plans/runs/:runId/live", () => {
  it("answers a live run from memory with totals, series, chains and the latest requests, and says nothing sensitive", async () => {
    const { agent, run } = await startedRun({ hold: true });
    const response = await waitFor(
      () => liveOf(agent, run.id),
      (r) => (r.body as LiveRunSnapshot).totals?.requests === 2,
    );
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const snapshot = response.body as LiveRunSnapshot;
    expect(snapshot).toMatchObject({ runId: run.id, kind: "chain", state: "live", totals: { requests: 2, failures: 1 }, currentVirtualUsers: 2, thinned: false });
    expect(snapshot.series.bucketSeconds).toBe(1);
    expect(snapshot.series.points.reduce((sum, p) => sum + p.requests, 0)).toBe(2);
    expect(snapshot.series.points.reduce((sum, p) => sum + p.failures, 0)).toBe(1);
    expect(snapshot.latency).not.toBeNull();
    expect(snapshot.chains.reduce((sum, row) => sum + row.requests, 0)).toBe(2);
    // Newest first, from the plan's templates: no resolved value, no query, no base URL reference.
    expect(snapshot.recent.map((entry) => [entry.method, entry.status, entry.failed])).toEqual([
      ["PUT", 404, true],
      ["POST", 201, false],
    ]);
    expect(snapshot.recent.every((entry) => entry.path.startsWith("/") && !entry.path.includes("baseUrl"))).toBe(true);
    const text = JSON.stringify(snapshot);
    for (const secret of ["secret-LIVE-7f3", "Bearer", "id-1"]) expect(text).not.toContain(secret);

    await agent.post(`${CHAIN_BASE}/runs/${run.id}/cancel`);
  });

  it("returns only the newest bucket after the cursor, and the whole series when the client's bucket width is stale", async () => {
    const { agent, run } = await startedRun({ hold: true });
    const first = (await waitFor(() => liveOf(agent, run.id), (r) => (r.body as LiveRunSnapshot).totals?.requests === 2)).body as LiveRunSnapshot;
    const next = (await liveOf(agent, run.id, `?since=${first.nextSince}&bucket=1`)).body as LiveRunSnapshot;
    expect(next.series.points.length).toBeLessThanOrEqual(first.series.points.length);
    expect(next.series.points.every((p) => p.second >= first.nextSince)).toBe(true);
    const stale = (await liveOf(agent, run.id, `?since=${first.nextSince}&bucket=4`)).body as LiveRunSnapshot;
    expect(stale.series.points.length).toBe(first.series.points.length);
    await agent.post(`${CHAIN_BASE}/runs/${run.id}/cancel`);
  });

  it("keeps the last view when the run ends, in a final state whose totals equal the run's own progress and result", async () => {
    const { agent, run } = await startedRun({ hold: false });
    const settled = await waitFor(
      async () => (await agent.get(`${CHAIN_BASE}/runs/${run.id}`)).body.run as ChainRun,
      (candidate) => candidate.status !== "in-progress",
    );
    expect(settled.status).toBe("completed");
    const snapshot = (await liveOf(agent, run.id)).body as LiveRunSnapshot;
    expect(snapshot.state).toBe("completed");
    expect(snapshot.totals).toEqual({ requests: settled.progress!.requestsSoFar, failures: settled.progress!.failuresSoFar });
    expect(snapshot.totals).toEqual({ requests: settled.result!.totals.requests, failures: settled.result!.totals.errors });
    expect(snapshot.recent).toHaveLength(2);
    // The stored result carries the same series for the report and for a restart.
    expect(settled.result!.liveSeries!.points.reduce((sum, p) => sum + p.requests, 0)).toBe(2);
  });

  it("refuses an unknown run, another session's run, and a bad cursor", async () => {
    const owner = await startedRun({ hold: true });
    const other = await startedRun({ hold: true });
    const unknown = await liveOf(other.agent, "00000000-0000-4000-8000-0000000000ff");
    expect([unknown.status, unknown.body.error]).toEqual([404, "run_not_found"]);
    const foreign = await liveOf(other.agent, owner.run.id);
    expect([foreign.status, foreign.body.error]).toEqual([404, "run_not_found"]);
    for (const query of ["?since=-1", "?since=abc", "?since=1.5", "?bucket=0", "?bucket=x"]) {
      const bad = await liveOf(owner.agent, owner.run.id, query);
      expect([query, bad.status, bad.body.error]).toEqual([query, 400, "invalid_query"]);
    }
    await owner.agent.post(`${CHAIN_BASE}/runs/${owner.run.id}/cancel`);
    await other.agent.post(`${CHAIN_BASE}/runs/${other.run.id}/cancel`);
  });
});
