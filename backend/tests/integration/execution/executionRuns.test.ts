import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { resetEnvironmentStore } from "../../../src/execution/environmentStore";
import { resetExecutionRunStore } from "../../../src/execution/executionRunStore";
import { driveToPostmanGenerationComplete } from "../../fixtures/execution/driveWorkflow";
import { TargetServer } from "../../fixtures/execution/targetServer";

async function pollUntilSettled(
  agent: ReturnType<typeof request.agent>,
  runId: string,
  timeoutMs = 10_000,
): Promise<{ status: number; body: { run: Record<string, unknown> & { status: string } } }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await agent.get(`/api/test-generation-workflow/execution/runs/${runId}`);
    if (response.body.run.status !== "in-progress" || Date.now() > deadline) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("execution routes (US1)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    resetStore();
    resetEnvironmentStore();
    resetExecutionRunStore();
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("runs an approved collection against a reachable target and produces a clear pass/fail summary", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/pets", { status: 200, body: [{ id: 1, name: "Rex", status: "available" }] });
    targetServer.configure("POST", "/pets", { status: 201, body: { id: 2, name: "Fido" } });
    targetServer.configure("GET", "/pets/1", { status: 200, body: { id: 1, name: "Rex" } });

    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const env = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Local",
      tier: "local",
      baseUrl,
      variableValues: { "apiKey": "test-key" },
    });
    expect(env.status).toBe(200);

    const started = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id, confirmed: true });
    expect(started.status).toBe(200);
    expect(started.body.run.status).toBe("in-progress");
    expect(started.body.run.results).toEqual([]);

    const finalResponse = await pollUntilSettled(agent, started.body.run.id);
    const run = finalResponse.body.run;
    expect(run.status).toBe("completed");
    expect(run.results.length).toBeGreaterThan(0);
    expect(run.summary.total).toBe(run.results.length);
    for (const result of run.results as { operationPath: string }[]) {
      expect(typeof result.operationPath).toBe("string");
    }
  }, 15000);

  it("reports connectivity-failure for every request when the target is unreachable, never assertion-failed", async () => {
    // Never started: nothing is listening on this port.
    const unreachableBaseUrl = "http://127.0.0.1:1";

    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const env = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Unreachable",
      tier: "local",
      baseUrl: unreachableBaseUrl,
      variableValues: { "apiKey": "test-key" },
    });

    const started = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id, confirmed: true });
    expect(started.status).toBe(200);

    const finalResponse = await pollUntilSettled(agent, started.body.run.id);
    const run = finalResponse.body.run;
    expect(run.status).toBe("completed");
    expect(run.results.length).toBeGreaterThan(0);
    for (const result of run.results as { outcome: string; failureCategory?: string }[]) {
      expect(result.outcome).toBe("failed");
      expect(result.failureCategory).toBe("connectivity-failure");
    }
  }, 15000);

  it("returns 409 stage_not_active before postmanGeneration is complete", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const response = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: "does-not-matter" });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("stage_not_active");
  });

  it("returns 400 environment_not_found for an unknown environment id", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const response = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: "does-not-exist" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("environment_not_found");
  });

  it("returns 404 run_not_found for an unknown run id", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const response = await agent.get("/api/test-generation-workflow/execution/runs/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("run_not_found");
  });

  it("directs requests to whichever environment's baseUrl was actually selected (US2, quickstart Scenario 2)", async () => {
    const serverA = new TargetServer();
    const serverB = new TargetServer();
    const baseUrlA = await serverA.start();
    const baseUrlB = await serverB.start();
    try {
      const app = createApp();
      const agent = request.agent(app);
      await driveToPostmanGenerationComplete(agent);

      const envA = await agent.post("/api/test-generation-workflow/environments").send({
        name: "Env A",
        tier: "local",
        baseUrl: baseUrlA,
        variableValues: { apiKey: "test-key" },
      });
      const envB = await agent.post("/api/test-generation-workflow/environments").send({
        name: "Env B",
        tier: "local",
        baseUrl: baseUrlB,
        variableValues: { apiKey: "test-key" },
      });

      const startedA = await agent
        .post("/api/test-generation-workflow/execution/start")
        .send({ environmentId: envA.body.environment.id, confirmed: true });
      await pollUntilSettled(agent, startedA.body.run.id);
      expect(serverA.requests.length).toBeGreaterThan(0);
      expect(serverB.requests).toHaveLength(0);

      const startedB = await agent
        .post("/api/test-generation-workflow/execution/start")
        .send({ environmentId: envB.body.environment.id, confirmed: true });
      await pollUntilSettled(agent, startedB.body.run.id);
      expect(serverB.requests.length).toBeGreaterThan(0);
    } finally {
      await serverA.stop();
      await serverB.stop();
    }
  }, 15000);

  it("returns 400 missing_variable_values naming the missing variable, and sends no request (US2, FR-004)", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const env = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Missing Key",
      tier: "local",
      baseUrl: "http://127.0.0.1:1",
      variableValues: {},
    });
    expect(env.status).toBe(200);

    const started = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id });
    expect(started.status).toBe(400);
    expect(started.body.error).toBe("missing_variable_values");
    expect(started.body.missing).toContain("apiKey");
  });

  it("distinguishes an unexpected status code from a schema-conformance failure, naming the specific failing assertion (US3, T028)", async () => {
    const baseUrl = await targetServer.start();
    // GET /pets: status matches (200) but the body violates the documented Pet schema.
    targetServer.configure("GET", "/pets", { status: 200, body: [{ id: "not-a-number" }] });
    // POST /pets: status does not match the documented 201.
    targetServer.configure("POST", "/pets", { status: 500, body: { error: "boom" } });
    targetServer.configure("GET", "/pets/1", { status: 200, body: { id: 1, name: "Rex" } });

    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const env = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Local",
      tier: "local",
      baseUrl,
      variableValues: { apiKey: "test-key" },
    });

    const started = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id, confirmed: true });
    const finalResponse = await pollUntilSettled(agent, started.body.run.id);
    const results = finalResponse.body.run.results as {
      operationPath: string;
      operationMethod: string;
      outcome: string;
      failureCategory?: string;
      assertionOutcomes: { type: string; outcome: string }[];
    }[];

    // Several scenarios target GET /pets (positive, plus negative variants that assert nothing
    // since this operation documents no 4xx response) — the one under test here is specifically
    // the one whose assertions include a schema-conformance check.
    const getPets = results.find(
      (r) =>
        r.operationMethod === "GET" &&
        r.operationPath === "/pets" &&
        r.assertionOutcomes.some((a) => a.type === "schema-conformance"),
    );
    expect(getPets?.outcome).toBe("failed");
    expect(getPets?.failureCategory).toBe("assertion-failed");
    expect(
      getPets?.assertionOutcomes.find((a) => a.type === "schema-conformance")?.outcome,
    ).toBe("failed");
    expect(getPets?.assertionOutcomes.find((a) => a.type === "status-code")?.outcome).toBe("passed");

    // Every scenario targeting POST /pets asserts status 201 against the same live 500 response,
    // so each one fails the same way — any of them demonstrates unexpected-status.
    const postPets = results.find(
      (r) => r.operationMethod === "POST" && r.operationPath === "/pets" && r.outcome === "failed",
    );
    expect(postPets?.failureCategory).toBe("unexpected-status");
  }, 15000);

  it("requires explicit confirmation for a staging environment, and proceeds once confirmed (US4, FR-007)", async () => {
    const baseUrl = await targetServer.start();
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const env = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Staging",
      tier: "staging",
      baseUrl,
      variableValues: { apiKey: "test-key" },
    });

    const refused = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("confirmation_required");
    expect(refused.body.environmentTier).toBe("staging");
    expect(targetServer.requests).toHaveLength(0);

    const started = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id, confirmed: true });
    expect(started.status).toBe(200);
    await pollUntilSettled(agent, started.body.run.id);
  }, 15000);

  it("requires explicit confirmation for a local environment with destructive operations (US4, FR-007)", async () => {
    const baseUrl = await targetServer.start();
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const env = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Local",
      tier: "local",
      baseUrl,
      variableValues: { apiKey: "test-key" },
    });

    const refused = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("confirmation_required");
    expect(refused.body.destructiveOperations.length).toBeGreaterThan(0);
  });

  it("refuses a second run while one is already in progress (US4, FR-008)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/pets", { delayMs: 500 });

    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const env = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Local",
      tier: "local",
      baseUrl,
      variableValues: { apiKey: "test-key" },
    });

    const first = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id, confirmed: true });
    expect(first.status).toBe(200);

    const second = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id, confirmed: true });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("execution_in_progress");
    expect(second.body.runId).toBe(first.body.run.id);

    await pollUntilSettled(agent, first.body.run.id);
  }, 15000);

  it("cancels a run mid-flight: the in-flight request finishes, the rest are recorded cancelled (US1/US4, FR-015)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/pets", { delayMs: 300 });
    targetServer.configure("POST", "/pets", { delayMs: 300 });
    targetServer.configure("GET", "/pets/1", { delayMs: 300 });

    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const env = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Local",
      tier: "local",
      baseUrl,
      variableValues: { apiKey: "test-key" },
      requestDelayMs: 200,
    });

    const started = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id, confirmed: true });
    expect(started.status).toBe(200);

    const cancelled = await agent.post("/api/test-generation-workflow/execution/cancel");
    expect(cancelled.status).toBe(202);

    const finalResponse = await pollUntilSettled(agent, started.body.run.id);
    const run = finalResponse.body.run as {
      status: string;
      results: { outcome: string; notAttemptedReason?: string }[];
    };
    expect(run.status).toBe("cancelled");
    const notAttempted = run.results.filter((r) => r.outcome === "not-attempted");
    expect(notAttempted.length).toBeGreaterThan(0);
    for (const result of notAttempted) {
      expect(result.notAttemptedReason).toBe("cancelled");
    }
    // Whatever was already dispatched keeps its own real outcome, never silently dropped.
    expect(run.results.some((r) => r.outcome !== "not-attempted")).toBe(true);
  }, 15000);

  it("returns 409 no_run_in_progress when cancelling with nothing running", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const response = await agent.post("/api/test-generation-workflow/execution/cancel");
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("no_run_in_progress");
  });

  it("lists run history newest first, with unchanged full results still retrievable per run (US5, FR-019, FR-020)", async () => {
    const serverA = new TargetServer();
    const serverB = new TargetServer();
    const baseUrlA = await serverA.start();
    const baseUrlB = await serverB.start();
    try {
      const app = createApp();
      const agent = request.agent(app);
      await driveToPostmanGenerationComplete(agent);

      const envA = await agent.post("/api/test-generation-workflow/environments").send({
        name: "Env A",
        tier: "local",
        baseUrl: baseUrlA,
        variableValues: { apiKey: "test-key" },
      });
      const envB = await agent.post("/api/test-generation-workflow/environments").send({
        name: "Env B",
        tier: "local",
        baseUrl: baseUrlB,
        variableValues: { apiKey: "test-key" },
      });

      const startedA = await agent
        .post("/api/test-generation-workflow/execution/start")
        .send({ environmentId: envA.body.environment.id, confirmed: true });
      await pollUntilSettled(agent, startedA.body.run.id);

      const startedB = await agent
        .post("/api/test-generation-workflow/execution/start")
        .send({ environmentId: envB.body.environment.id, confirmed: true });
      await pollUntilSettled(agent, startedB.body.run.id);

      const list = await agent.get("/api/test-generation-workflow/execution/runs");
      expect(list.status).toBe(200);
      expect(list.body.runs.map((r: { id: string }) => r.id)).toEqual([
        startedB.body.run.id,
        startedA.body.run.id,
      ]);
      for (const summary of list.body.runs) {
        expect(summary.results).toBeUndefined();
        expect(summary.summary).toBeDefined();
      }

      const earlierRunDetail = await agent.get(
        `/api/test-generation-workflow/execution/runs/${startedA.body.run.id}`,
      );
      expect(earlierRunDetail.status).toBe(200);
      expect(earlierRunDetail.body.run.results.length).toBeGreaterThan(0);
      expect(earlierRunDetail.body.run.environmentSnapshot.baseUrl).toBe(baseUrlA);
    } finally {
      await serverA.stop();
      await serverB.stop();
    }
  }, 20000);
});
