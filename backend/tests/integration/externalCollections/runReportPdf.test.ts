import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";

function collection() {
  return {
    info: { name: "c" },
    item: [{ name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets/1" } }],
  };
}

function environment(baseUrl: string) {
  return { name: "env", values: [{ key: "baseUrl", value: baseUrl, enabled: true }] };
}

async function pollUntilSettled(agent: ReturnType<typeof request.agent>, collectionId: string, runId: string) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const response = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}`);
    if (response.body.run.status !== "in-progress") return response;
    if (Date.now() > deadline) throw new Error("Run did not settle");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("external collections: PDF run report (AP-043)", () => {
  let targetServer: TargetServer;
  beforeEach(() => {
    targetServer = new TargetServer();
  });
  afterEach(async () => {
    await targetServer.stop();
  });

  async function finishedRun() {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/widgets/1", { status: 200, body: { id: 1 } });
    const agent = request.agent(createApp());
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const collectionId = uploaded.body.uploadedCollection.id as string;
    const started = await agent.post(`/api/external-collections/${collectionId}/execution/start`).send({ confirmed: true });
    const runId = started.body.run.id as string;
    await pollUntilSettled(agent, collectionId, runId);
    return { agent, collectionId, runId };
  }

  it("downloads a finished run as a PDF attachment with an ASCII file name", async () => {
    const { agent, collectionId, runId } = await finishedRun();

    const response = await agent
      .get(`/api/external-collections/${collectionId}/execution/runs/${runId}/report.pdf`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="apipilot-run-report-My-collection-${runId.slice(0, 8)}.pdf"`,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.body as Buffer;
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(Number(response.headers["content-length"])).toBe(body.length);
  }, 60_000);

  it("downloads the same run as a self-contained HTML report (AP-044)", async () => {
    const { agent, collectionId, runId } = await finishedRun();
    const response = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}/report.html`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="apipilot-run-report-My-collection-${runId.slice(0, 8)}.html"`,
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.text.startsWith("<!doctype html>")).toBe(true);
    expect(response.text).toContain("My collection");
    expect(response.text).toContain("Get widget");
  }, 60_000);

  it("answers 404 for an unknown run, and for a run that belongs to another collection", async () => {
    const { agent, collectionId, runId } = await finishedRun();

    const unknown = await agent.get(`/api/external-collections/${collectionId}/execution/runs/no-such-run/report.pdf`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("run_not_found");

    const wrongCollection = await agent.get(`/api/external-collections/other-collection/execution/runs/${runId}/report.pdf`);
    expect(wrongCollection.status).toBe(404);
    expect(wrongCollection.body.error).toBe("run_not_found");
    const wrongHtml = await agent.get(`/api/external-collections/other-collection/execution/runs/${runId}/report.html`);
    expect(wrongHtml.status).toBe(404);
    const unknownHtml = await agent.get(`/api/external-collections/${collectionId}/execution/runs/no-such-run/report.html`);
    expect(unknownHtml.status).toBe(404);
  }, 60_000);
});

describe("external collections: per-second graph in the reports (AP-045 US4)", () => {
  let targetServer: TargetServer;
  beforeEach(() => {
    targetServer = new TargetServer();
  });
  afterEach(async () => {
    await targetServer.stop();
  });

  it("draws the graph in the HTML report of a real run and renders the same PDF bytes twice", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/widgets/1", { status: 200, body: { id: 1 } });
    const agent = request.agent(createApp());
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const collectionId = uploaded.body.uploadedCollection.id as string;
    const started = await agent.post(`/api/external-collections/${collectionId}/execution/start`).send({ confirmed: true });
    const runId = started.body.run.id as string;
    await pollUntilSettled(agent, collectionId, runId);

    const html = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}/report.html`);
    expect(html.text).toContain('<h2 id="series-h">Requests per second</h2>');
    expect(html.text).toContain("1 requests, 0 failed");
    const download = () =>
      agent
        .get(`/api/external-collections/${collectionId}/execution/runs/${runId}/report.pdf`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        });
    const [first, second] = [(await download()).body as Buffer, (await download()).body as Buffer];
    expect(first.equals(second)).toBe(true);
  }, 60_000);
});
