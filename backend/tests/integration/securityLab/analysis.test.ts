import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { readFileSync } from "node:fs";
import path from "node:path";

const FIXTURES = path.resolve(__dirname, "../../fixtures/securityLab");
const sampleSpec = () => readFileSync(path.join(FIXTURES, "sample-api.yaml"));

async function agentWithSpec() {
  const agent = request.agent(createApp());
  const upload = await agent.post("/api/test-generation-workflow").attach("file", sampleSpec(), "sample-api.yaml");
  expect(upload.status).toBe(200);
  return agent;
}

describe("GET /api/security-lab/analysis", () => {
  it("answers 409 no_specification when no specification is loaded", async () => {
    resetStore();
    const res = await request.agent(createApp()).get("/api/security-lab/analysis");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_specification");
    expect(res.body.message).toMatch(/Upload one in the Guided Workflow/);
  });

  it("analyzes every operation of the loaded specification", async () => {
    const agent = await agentWithSpec();
    const res = await agent.get("/api/security-lab/analysis");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.operationCount).toBe(9);
    expect(res.body.analysis.effective).toHaveLength(9);
    expect(res.body.analysis.specificationRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.analysis.observations.length).toBeGreaterThan(0);
    const total = Object.values(res.body.analysis.counts as Record<string, number>).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(res.body.analysis.observations.length);
  });

  it("ignores any operation selection made in the guided workflow (FR-005)", async () => {
    const agent = await agentWithSpec();
    const before = (await agent.get("/api/security-lab/analysis")).body;
    await agent.post("/api/test-generation-workflow/api-review/continue").send({ selectedOperationKeys: ["GET /orders"] });
    const after = (await agent.get("/api/security-lab/analysis")).body;
    expect(after.operationCount).toBe(before.operationCount);
    expect(after.analysis.observations).toEqual(before.analysis.observations);
  });

  it("is identical when requested twice", async () => {
    const agent = await agentWithSpec();
    const first = await agent.get("/api/security-lab/analysis");
    const second = await agent.get("/api/security-lab/analysis");
    expect(second.body).toEqual(first.body);
  });
});

describe("GET and PUT /api/security-lab/settings", () => {
  it("starts empty and works with no specification loaded", async () => {
    resetStore();
    const res = await request.agent(createApp()).get("/api/security-lab/settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sensitiveFields: [] });
  });

  it("stores the configured names, de-duplicated ignoring case, and returns them", async () => {
    const agent = request.agent(createApp());
    const put = await agent.put("/api/security-lab/settings").send({ sensitiveFields: ["ssn", " SSN ", "internalNote", "card.number"] });
    expect(put.status).toBe(200);
    expect(put.body.sensitiveFields).toEqual(["ssn", "internalNote", "card.number"]);
    expect((await agent.get("/api/security-lab/settings")).body.sensitiveFields).toEqual(["ssn", "internalNote", "card.number"]);
  });

  it("feeds the configured names into the analysis as user-provided", async () => {
    const agent = await agentWithSpec();
    await agent.put("/api/security-lab/settings").send({ sensitiveFields: ["internalNote"] });
    const res = await agent.get("/api/security-lab/analysis");
    expect(res.body.configuredSensitiveFields).toEqual(["internalNote"]);
    const note = res.body.analysis.observations.find((o: { basis?: string; elementPointer: string }) => o.basis === "user-configured");
    expect(note?.elementPointer).toMatch(/internalNote$/);
  });

  it.each([
    [{ sensitiveFields: "ssn" }],
    [{ sensitiveFields: [1] }],
    [{ sensitiveFields: ["has space"] }],
    [{ sensitiveFields: [""] }],
    [{ sensitiveFields: ["a".repeat(101)] }],
    [{ sensitiveFields: Array.from({ length: 101 }, (_, i) => `f${i}`) }],
    [{}],
  ])("refuses %j with invalid_request", async (body) => {
    const res = await request.agent(createApp()).put("/api/security-lab/settings").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("keeps each browser's settings separate", async () => {
    const app = createApp();
    await request.agent(app).put("/api/security-lab/settings").send({ sensitiveFields: ["mine"] });
    const other = await request.agent(app).get("/api/security-lab/settings");
    expect(other.body.sensitiveFields).toEqual([]);
  });

  it("survives a new session for the same browser, because settings are retained work", async () => {
    const app = createApp();
    const first = request.agent(app);
    const put = await first.put("/api/security-lab/settings").send({ sensitiveFields: ["kept"] });
    const ownerCookie = (put.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("apipilotOwner="));
    expect(ownerCookie).toBeDefined();
    // A different session (no session cookie), the same owner cookie.
    const sameBrowserNewSession = await request(app).get("/api/security-lab/settings").set("Cookie", ownerCookie!.split(";")[0]);
    expect(sameBrowserNewSession.body.sensitiveFields).toEqual(["kept"]);
  });
});
