import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LiveRunSnapshot } from "@apipilot/shared-domain";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";

/** AP-045 (specs/045-live-run-dashboard contracts/live-run-routes.md): the collection run's live read route. */

const SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";
const SECRET_QUERY = "QUERY-SECRET-123";

function collection() {
  const item = (id: string, name: string, path: string) => ({
    id,
    name,
    request: { method: "GET", url: `{{baseUrl}}${path}?token=${SECRET_QUERY}`, header: [{ key: "Authorization", value: "Bearer HEADER-SECRET-456" }] },
    event: [{ listen: "test", script: { type: "text/javascript", exec: ['pm.test("ok", function () { pm.response.to.have.status(200); });'] } }],
  });
  return {
    info: { name: "Live collection", schema: SCHEMA },
    item: [
      item("11111111-1111-4111-8111-111111111111", "First", "/widgets/{{id}}"),
      item("22222222-2222-4222-8222-222222222222", "Second", "/slow"),
      item("33333333-3333-4333-8333-333333333333", "Third", "/missing"),
    ],
  };
}

async function liveOf(agent: ReturnType<typeof request.agent>, collectionId: string, runId: string, query = "") {
  return agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}/live${query}`);
}

describe("GET /api/external-collections/:id/execution/runs/:runId/live", () => {
  let target: TargetServer;
  beforeEach(() => {
    target = new TargetServer();
  });
  afterEach(async () => {
    await target.stop();
  });

  async function startRun() {
    const baseUrl = await target.start();
    target.configure("GET", "/widgets/{{id}}", { status: 200, body: {} });
    target.configure("GET", "/slow", { status: 200, body: {}, delayMs: 600 });
    const agent = request.agent(createApp());
    const upload = await agent
      .post("/api/external-collections")
      .field("name", "Live collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify({ name: "env", values: [{ key: "baseUrl", value: baseUrl, enabled: true }, { key: "id", value: "7", enabled: true }] })), "environment.json");
    const id = upload.body.uploadedCollection.id as string;
    const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    return { agent, id, runId: started.body.run.id as string };
  }

  async function waitFor(read: () => Promise<LiveRunSnapshot>, done: (snapshot: LiveRunSnapshot) => boolean) {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const snapshot = await read();
      if (done(snapshot) || Date.now() > deadline) return snapshot;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("shows n of N, the request in flight and the requests so far while the run is live, then the final totals", async () => {
    const { agent, id, runId } = await startRun();
    const seen: LiveRunSnapshot[] = [];
    const final = await waitFor(
      async () => {
        const response = await liveOf(agent, id, runId);
        expect(response.status).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        seen.push(response.body as LiveRunSnapshot);
        return response.body as LiveRunSnapshot;
      },
      (snapshot) => snapshot.state !== "live",
    );
    expect(seen.some((snapshot) => snapshot.state === "live" && snapshot.plannedRequests === 3)).toBe(true);
    expect(seen.some((snapshot) => snapshot.inFlight === "Second")).toBe(true);
    expect(final).toMatchObject({ kind: "collection", state: "completed", plannedRequests: 3, totals: { requests: 3, failures: 0 }, currentVirtualUsers: null, latency: null, chains: [], inFlight: null });
    expect(final.recent.map((entry) => entry.chain)).toEqual(["Third", "Second", "First"]);
    // The authored path, variables unresolved, without the base URL reference or the query.
    expect(final.recent.map((entry) => entry.path)).toEqual(["/missing", "/slow", "/widgets/{{id}}"]);
    expect(final.series.points.every((point) => point.virtualUsers === null)).toBe(true);
    expect(final.series.points.reduce((sum, point) => sum + point.requests, 0)).toBe(3);

    // The final totals equal the run's own summary.
    const run = (await agent.get(`/api/external-collections/${id}/execution/runs/${runId}`)).body.run;
    expect(final.totals).toEqual({ requests: run.summary.passed + run.summary.failed, failures: run.summary.failed });
    const text = JSON.stringify(final);
    for (const secret of [SECRET_QUERY, "HEADER-SECRET-456", "Bearer", "token="]) expect(text).not.toContain(secret);
  }, 60_000);

  it("refuses an unknown run, another collection's run, another session's run and a bad cursor", async () => {
    const { agent, id, runId } = await startRun();
    expect((await liveOf(agent, id, "00000000-0000-4000-8000-0000000000ff")).body.error).toBe("run_not_found");
    expect((await liveOf(agent, "00000000-0000-4000-8000-0000000000aa", runId)).body.error).toBe("run_not_found");
    expect((await liveOf(request.agent(createApp()), id, runId)).body.error).toBe("run_not_found");
    for (const query of ["?since=-1", "?since=x", "?bucket=0"]) {
      const bad = await liveOf(agent, id, runId, query);
      expect([query, bad.status, bad.body.error]).toEqual([query, 400, "invalid_query"]);
    }
    await waitFor(
      async () => (await liveOf(agent, id, runId)).body as LiveRunSnapshot,
      (snapshot) => snapshot.state !== "live",
    );
  }, 60_000);
});
