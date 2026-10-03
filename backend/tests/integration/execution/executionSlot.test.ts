import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { UserScriptRun } from "@apipilot/shared-domain";
import { createApp } from "../../../src/app";
import { getUserScriptRunRepository } from "../../../src/persistence/userScriptRunRepository";
import { resetQuickTestsForTest } from "../../../src/performance/quick/quickTestStore";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { driveToPostmanGenerationComplete } from "../../fixtures/execution/driveWorkflow";
import { readyProbe } from "../../fixtures/performance/agent";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { chainAgent, CHAIN_BASE, createEnvironment, newPlan, savePlanContent } from "../../fixtures/chain/chainAgent";
import { customerLifecyclePlan } from "../../fixtures/chain/chainPlans";
import { establishSession } from "../../fixtures/performance/session";

/**
 * AP-034 FR-023 (specs/034-run-user-k6-script research R9, tasks T012): a user-script run in
 * progress occupies the one session-wide execution slot, so every other start route refuses
 * through `findExecutionInProgress()`. The user-script start route's own refusal for the other
 * run kinds is covered by `tests/integration/userScripts/userScriptsRoutes.test.ts`.
 */

function userScriptRun(id: string): UserScriptRun {
  return {
    id,
    source: "user-script",
    status: "in-progress",
    environment: { id: "e1", name: "Local", tier: "local", baseUrl: "http://127.0.0.1:9" },
    snapshot: { scriptId: "s1", scriptName: "s", scriptSha256: "x", load: { kind: "script" }, mapping: [], thresholds: [], hostsFound: [] },
    k6Version: "1.2.0",
    k6ExitCode: null,
    exitMeaning: null,
    plannedDurationMs: null,
    startedAt: "2026-10-01T10:00:00.000Z",
    cancelRequested: false,
  };
}

function collection() {
  return { info: { name: "c" }, item: [{ name: "r", request: { method: "GET", url: "{{baseUrl}}/x" } }] };
}

function environment() {
  return { name: "env", values: [{ key: "baseUrl", value: "http://127.0.0.1:9", enabled: true }] };
}

describe("a user-script run in the shared execution slot", () => {
  beforeEach(() => {
    resetStore();
    resetQuickTestsForTest();
  });

  it("refuses a generated-collection start", async () => {
    const agent = request.agent(createApp());
    const sessionId = await establishSession(agent);
    await driveToPostmanGenerationComplete(agent);
    const env = await agent
      .post("/api/test-generation-workflow/environments")
      .send({ name: "Local", tier: "local", baseUrl: "http://127.0.0.1:9", variableValues: { apiKey: "k" } });
    getUserScriptRunRepository().create(sessionId, userScriptRun("user-run-1"));

    const refused = await agent.post("/api/test-generation-workflow/execution/start").send({ environmentId: env.body.environment.id, confirmed: true });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "execution_in_progress", runId: "user-run-1" });
  }, 30_000);

  it("refuses an uploaded-collection start", async () => {
    const agent = request.agent(createApp());
    const sessionId = await establishSession(agent);
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "uc")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment())), "environment.json");
    getUserScriptRunRepository().create(sessionId, userScriptRun("user-run-2"));

    const refused = await agent
      .post(`/api/external-collections/${uploaded.body.uploadedCollection.id}/execution/start`)
      .send({ confirmed: true, selectedRequestIds: ["not-a-real-id", "not-a-real-id"] });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "execution_in_progress", runId: "user-run-2" });
  }, 30_000);

  it("refuses a request-chain run start (AP-037)", async () => {
    const runner = createFakeRunner({ lines: [] });
    const { agent, sessionId } = await chainAgent({ runner, probe: readyProbe() });
    const plan = await newPlan(agent);
    const environmentId = await createEnvironment(agent, { client_id: "id-1", client_secret: "secret-1" });
    await savePlanContent(agent, plan, customerLifecyclePlan({ targetEnvironmentId: environmentId }));
    expect((await agent.post(`${CHAIN_BASE}/${plan.id}/script`)).status).toBe(200);
    getUserScriptRunRepository().create(sessionId, userScriptRun("user-run-3"));

    const refused = await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "execution_in_progress", runId: "user-run-3" });
    expect(runner.starts).toHaveLength(0);
  }, 30_000);
});
