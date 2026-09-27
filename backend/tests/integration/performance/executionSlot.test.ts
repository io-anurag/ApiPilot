import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { driveToPostmanGenerationComplete } from "../../fixtures/execution/driveWorkflow";
import { runFixture } from "../../fixtures/performance/builders";
import { establishSession } from "../../fixtures/performance/session";

/**
 * AP-029 FR-029 (specs/031-k6-performance-testing research D18, tasks T017): a performance run in
 * progress occupies the session-wide execution slot for both existing start routes.
 */

function collection() {
  return { info: { name: "c" }, item: [{ name: "r", request: { method: "GET", url: "{{baseUrl}}/x" } }] };
}

function environment() {
  return { name: "env", values: [{ key: "baseUrl", value: "http://127.0.0.1:9", enabled: true }] };
}

describe("performance run in the shared execution slot", () => {
  beforeEach(() => resetStore());

  it("refuses a generated-collection start while a performance run is in progress", async () => {
    const agent = request.agent(createApp());
    const sessionId = await establishSession(agent);
    await driveToPostmanGenerationComplete(agent);
    const env = await agent
      .post("/api/test-generation-workflow/environments")
      .send({ name: "Local", tier: "local", baseUrl: "http://127.0.0.1:9", variableValues: { apiKey: "k" } });
    getPerformanceRunRepository().create(sessionId, runFixture({ id: "perf-run-1" }));

    const refused = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id, confirmed: true });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "execution_in_progress", runId: "perf-run-1" });
  }, 30_000);

  it("refuses an uploaded-collection start while a performance run is in progress, before any run-order check", async () => {
    const agent = request.agent(createApp());
    const sessionId = await establishSession(agent);
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "uc")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment())), "environment.json");
    getPerformanceRunRepository().create(sessionId, runFixture({ id: "perf-run-2" }));

    const refused = await agent
      .post(`/api/external-collections/${uploaded.body.uploadedCollection.id}/execution/start`)
      .send({ confirmed: true, selectedRequestIds: ["not-a-real-id", "not-a-real-id"] });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "execution_in_progress", runId: "perf-run-2" });
  }, 30_000);

  it("leaves both routes unchanged when no performance run is in progress", async () => {
    const agent = request.agent(createApp());
    const sessionId = await establishSession(agent);
    getPerformanceRunRepository().create(sessionId, runFixture({ id: "settled", status: "completed" }));
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "uc")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment())), "environment.json");
    const response = await agent
      .post(`/api/external-collections/${uploaded.body.uploadedCollection.id}/execution/start`)
      .send({ confirmed: true, selectedRequestIds: ["not-a-real-id", "not-a-real-id"] });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_run_order");
  }, 30_000);
});
