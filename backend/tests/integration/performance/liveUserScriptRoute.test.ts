import { describe, expect, it } from "vitest";
import type { LiveRunSnapshot } from "@apipilot/shared-domain";
import { readyProbe } from "../../fixtures/performance/agent";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { environmentFor, scriptFixture, uploadScript, USER_SCRIPTS_BASE, userScriptAgent, waitUntilSettled } from "../../fixtures/userScripts/agent";
import { point, userRequest } from "../../fixtures/userScripts/ndjsonBuilder";

/** AP-045 (specs/045-live-run-dashboard contracts/live-run-routes.md): the user-script run's live read route. */


const LINES = [
  point("vus", 3, {}, 0),
  ...userRequest({ url: "http://127.0.0.1:4600/orders/42?token=QUERY-SECRET", name: "List orders", method: "GET", status: 200, durationMs: 30, atMs: 100 }),
  ...userRequest({ url: "http://127.0.0.1:4600/orders/42?token=QUERY-SECRET", method: "GET", status: 500, durationMs: 50, atMs: 200 }),
];

async function startedRun(options: { hold: boolean }) {
  const runner = createFakeRunner({ lines: LINES, lineIntervalMs: 1, holdUntilCancelled: options.hold });
  const { agent } = await userScriptAgent({ runner, probe: readyProbe(), tickIntervalMs: 20 });
  const uploaded = await uploadScript(agent, scriptFixture("accepted", "basic.js"));
  const script = uploaded.body.script;
  await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/confirmation`).send({ sha256: script.sha256 });
  const environmentId = await environmentFor(agent, { API_KEY: "seeded-api-key-value" });
  const started = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/runs`).send({ environmentId, scriptSha256: script.sha256 });
  return { agent, runId: started.body.run.id as string };
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const liveOf = (agent: Awaited<ReturnType<typeof startedRun>>["agent"], runId: string, query = "") => agent.get(`${USER_SCRIPTS_BASE}/runs/${runId}/live${query}`);

describe("GET /api/user-scripts/runs/:runId/live", () => {
  it("answers a live run from memory, naming requests without their query, headers or values", async () => {
    const { agent, runId } = await startedRun({ hold: true });
    const response = await waitFor(
      () => liveOf(agent, runId),
      (r) => (r.body as LiveRunSnapshot).totals?.requests === 2,
    );
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const snapshot = response.body as LiveRunSnapshot;
    expect(snapshot).toMatchObject({ runId, kind: "user-script", state: "live", totals: { requests: 2, failures: 1 }, currentVirtualUsers: 3, chains: [] });
    expect(snapshot.series.points.reduce((sum, p) => sum + p.failures, 0)).toBe(1);
    expect(snapshot.recent).toEqual([
      expect.objectContaining({ chain: "127.0.0.1:4600", method: "GET", path: "/orders/42", status: 500, failed: true }),
      expect.objectContaining({ chain: "List orders", method: "GET", path: "", status: 200, failed: false }),
    ]);
    const text = JSON.stringify(snapshot);
    for (const secret of ["QUERY-SECRET", "seeded-api-key-value", "token="]) expect(text).not.toContain(secret);
    await agent.post(`${USER_SCRIPTS_BASE}/runs/${runId}/cancel`);
  });

  it("keeps the last view in a final state whose totals equal the result, and stores the series with it", async () => {
    const { agent, runId } = await startedRun({ hold: false });
    const settled = await waitUntilSettled(agent, runId);
    expect(settled.status).toBe("completed");
    const snapshot = (await liveOf(agent, runId)).body as LiveRunSnapshot;
    expect(snapshot.state).toBe("completed");
    expect(snapshot.totals).toEqual({ requests: settled.result.totals.requests, failures: settled.result.totals.failures });
    expect(snapshot.recent).toHaveLength(2);
    expect(settled.result.liveSeries.points.reduce((sum: number, p: { requests: number }) => sum + p.requests, 0)).toBe(2);
  });

  it("refuses an unknown run, another session's run and a bad cursor", async () => {
    const owner = await startedRun({ hold: true });
    const other = await startedRun({ hold: true });
    expect((await liveOf(other.agent, "00000000-0000-4000-8000-0000000000ff")).body.error).toBe("run_not_found");
    expect((await liveOf(other.agent, owner.runId)).body.error).toBe("run_not_found");
    expect((await liveOf(owner.agent, "nope")).body.error).toBe("run_not_found");
    for (const query of ["?since=-1", "?since=abc", "?bucket=0"]) {
      const bad = await liveOf(owner.agent, owner.runId, query);
      expect([query, bad.status, bad.body.error]).toEqual([query, 400, "invalid_query"]);
    }
    await owner.agent.post(`${USER_SCRIPTS_BASE}/runs/${owner.runId}/cancel`);
    await other.agent.post(`${USER_SCRIPTS_BASE}/runs/${other.runId}/cancel`);
  });
});
