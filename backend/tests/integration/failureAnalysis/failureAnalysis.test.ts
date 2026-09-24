import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AIProvider, InferenceHooks, InferenceRequest, InferenceResponse } from "@apipilot/shared-domain";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";
import { modelAnswer } from "../../fixtures/failureAnalysis/fixtures";

const POLL_TIMEOUT_MS = 30_000;

type Agent = ReturnType<typeof request.agent>;

function testScript(expectedStatus: number) {
  return [
    {
      listen: "test",
      script: {
        type: "text/javascript",
        exec: [
          `pm.test("Status code is ${expectedStatus}", function () {`,
          `  pm.response.to.have.status(${expectedStatus});`,
          "});",
        ],
      },
    },
  ];
}

function collection(options: { slowLast?: boolean } = {}) {
  return {
    info: { name: "Users", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: [
      { name: "Create user", request: { method: "POST", url: "{{baseUrl}}/users" }, event: testScript(201) },
      { name: "List users", request: { method: "GET", url: "{{baseUrl}}/users" }, event: testScript(200) },
      ...(options.slowLast
        ? [{ name: "Slow", request: { method: "GET", url: "{{baseUrl}}/slow" }, event: testScript(200) }]
        : []),
    ],
  };
}

function environment(baseUrl: string) {
  return { name: "env", values: [{ key: "baseUrl", value: baseUrl, enabled: true }] };
}

/** A realistic provider whose next answer (or error) each test controls; optionally slow. */
function controllableProvider() {
  const state: { content: string; error?: InferenceResponse["errorCategory"]; delayMs: number; calls: number } = {
    content: modelAnswer(),
    delayMs: 0,
    calls: 0,
  };
  const provider: AIProvider = {
    mode: "local",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    getInputBudget: async () => undefined,
    async infer(inferenceRequest: InferenceRequest, hooks?: InferenceHooks): Promise<InferenceResponse> {
      state.calls += 1;
      hooks?.onStarted?.();
      if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      const base = {
        contractVersion: 1 as const,
        requestId: inferenceRequest.requestId,
        modelId: "test-model",
        provider: "local" as const,
        durationMs: 1,
      };
      return state.error
        ? { ...base, status: "error", errorCategory: state.error, errorMessage: "internal detail" }
        : { ...base, status: "success", content: state.content };
    },
  };
  return { provider, state };
}

async function uploadAndRun(agent: Agent, baseUrl: string, options: { slowLast?: boolean } = {}) {
  const upload = await agent
    .post("/api/external-collections")
    .field("name", `Users ${Math.random()}`)
    .field("tier", "local")
    .attach("collection", Buffer.from(JSON.stringify(collection(options))), "collection.json")
    .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
  expect(upload.status).toBe(201);
  const collectionId = upload.body.uploadedCollection.id as string;
  // Gate 1 (unverified content) and gate 2 (the POST is a destructive request) each need their
  // own confirmed resubmission (AP-026 research D10).
  let started = await agent.post(`/api/external-collections/${collectionId}/execution/start`).send({ confirmed: true });
  if (started.status === 409) {
    started = await agent.post(`/api/external-collections/${collectionId}/execution/start`).send({ confirmed: true });
  }
  expect(started.status).toBe(200);
  return { collectionId, runId: started.body.run.id as string };
}

async function pollRun(agent: Agent, collectionId: string, runId: string, until: (run: { status: string; results: unknown[] }) => boolean) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const response = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}`);
    if (until(response.body.run)) return response.body.run;
    if (Date.now() > deadline) throw new Error("run never reached the expected state");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function analysisUrl(collectionId: string, runId: string, resultIndex: number | string) {
  return `/api/external-collections/${collectionId}/execution/runs/${runId}/results/${resultIndex}/failure-analysis`;
}

describe("failure analysis API (contracts/failure-analysis-api.md)", () => {
  let target: TargetServer;
  let baseUrl: string;

  beforeEach(async () => {
    target = new TargetServer();
    baseUrl = await target.start();
    target.configure("POST", "/users", { status: 500, body: { error: "db unavailable" } });
    target.configure("GET", "/users", { status: 200, body: [] });
    target.configure("GET", "/slow", { status: 200, body: {}, delayMs: 1_500 });
  });

  afterEach(async () => {
    await target.stop();
  });

  it("covers every eligibility check in contract order", async () => {
    const { provider } = controllableProvider();
    const agent = request.agent(createApp(provider));
    const { collectionId, runId } = await uploadAndRun(agent, baseUrl);
    await pollRun(agent, collectionId, runId, (run) => run.status === "completed");

    for (const bad of ["-1", "abc", "1.5"]) {
      const response = await agent.post(analysisUrl(collectionId, runId, bad));
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid_result_index");
    }
    const missingRun = await agent.post(analysisUrl(collectionId, "no-such-run", 0));
    expect(missingRun.status).toBe(404);
    expect(missingRun.body.error).toBe("run_not_found");

    const missingResult = await agent.post(analysisUrl(collectionId, runId, 9));
    expect(missingResult.status).toBe(404);
    expect(missingResult.body.error).toBe("result_not_found");

    const passed = await agent.post(analysisUrl(collectionId, runId, 1));
    expect(passed.status).toBe(409);
    expect(passed.body).toMatchObject({ error: "result_not_failed", outcome: "passed" });

    const otherSession = request.agent(createApp(provider));
    const foreign = await otherSession.post(analysisUrl(collectionId, runId, 0));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe("run_not_found");
  }, 60_000);

  it("analyzes, stores, lists and replaces an analysis without changing the run (FR-009, FR-013, FR-015)", async () => {
    const { provider, state } = controllableProvider();
    const agent = request.agent(createApp(provider));
    const { collectionId, runId } = await uploadAndRun(agent, baseUrl);
    const runBefore = await pollRun(agent, collectionId, runId, (run) => run.status === "completed");

    const first = await agent.post(analysisUrl(collectionId, runId, 0));
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("analyzed");
    expect(first.body.analysis).toMatchObject({
      runId,
      resultIndex: 0,
      requestName: "Create user",
      conclusion: { kind: "likely-cause", cause: "environment-issue" },
      specificationContext: { status: "unavailable", reason: "no-generated-collection" },
    });

    state.content = modelAnswer({ cause: "downstream-service-issue", summary: "Second attempt" });
    const second = await agent.post(analysisUrl(collectionId, runId, 0));
    expect(second.body.analysis.summary).toBe("Second attempt");

    const list = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}/failure-analyses`);
    expect(list.status).toBe(200);
    expect(list.body.analyses).toHaveLength(1);
    expect(list.body.analyses[0].summary).toBe("Second attempt");

    const runAfter = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}`);
    expect(runAfter.body.run).toEqual(runBefore);
  }, 60_000);

  it("lists 404 for an unknown run and an empty array before any analysis", async () => {
    const { provider } = controllableProvider();
    const agent = request.agent(createApp(provider));
    const { collectionId, runId } = await uploadAndRun(agent, baseUrl);

    const empty = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}/failure-analyses`);
    expect(empty.body).toEqual({ analyses: [] });
    const unknown = await agent.get(`/api/external-collections/${collectionId}/execution/runs/nope/failure-analyses`);
    expect(unknown.status).toBe(404);
  }, 60_000);

  it("allows one analysis per session and reports it as in progress (FR-016, SC-005)", async () => {
    const { provider, state } = controllableProvider();
    const agent = request.agent(createApp(provider));
    const { collectionId, runId } = await uploadAndRun(agent, baseUrl);
    await pollRun(agent, collectionId, runId, (run) => run.status === "completed");

    const idle = await agent.get("/api/failure-analysis/in-progress");
    expect(idle.status).toBe(204);

    state.delayMs = 800;
    const firstPromise = agent.post(analysisUrl(collectionId, runId, 0)).then((response) => response);
    const deadline = Date.now() + 5_000;
    let inProgress = await agent.get("/api/failure-analysis/in-progress");
    while (inProgress.status !== 200 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      inProgress = await agent.get("/api/failure-analysis/in-progress");
    }
    expect(inProgress.body.inProgress).toMatchObject({ runId, resultIndex: 0, requestName: "Create user", phase: "generating" });

    const second = await agent.post(analysisUrl(collectionId, runId, 0));
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: "failure_analysis_in_progress", runId, resultIndex: 0 });

    expect((await firstPromise).body.status).toBe("analyzed");
    expect((await agent.get("/api/failure-analysis/in-progress")).status).toBe(204);
  }, 60_000);

  it("analyzes a recorded failure while its run is still in progress (FR-001)", async () => {
    const { provider } = controllableProvider();
    const agent = request.agent(createApp(provider));
    const { collectionId, runId } = await uploadAndRun(agent, baseUrl, { slowLast: true });
    const run = await pollRun(agent, collectionId, runId, (current) => current.results.length >= 1);
    expect(run.status).toBe("in-progress");

    const response = await agent.post(analysisUrl(collectionId, runId, 0));
    expect(response.body.status).toBe("analyzed");
    await pollRun(agent, collectionId, runId, (current) => current.status === "completed");
  }, 60_000);

  it("still analyzes after the uploaded collection has been deleted", async () => {
    const { provider } = controllableProvider();
    const agent = request.agent(createApp(provider));
    const { collectionId, runId } = await uploadAndRun(agent, baseUrl);
    await pollRun(agent, collectionId, runId, (run) => run.status === "completed");

    expect((await agent.delete(`/api/external-collections/${collectionId}`)).status).toBe(204);
    const response = await agent.post(analysisUrl(collectionId, runId, 0));
    expect(response.body.status).toBe("analyzed");
  }, 60_000);

  it("stores a low-confidence answer as insufficient evidence (US3)", async () => {
    const { provider, state } = controllableProvider();
    const agent = request.agent(createApp(provider));
    const { collectionId, runId } = await uploadAndRun(agent, baseUrl);
    await pollRun(agent, collectionId, runId, (run) => run.status === "completed");

    state.content = modelAnswer({ confidence: 0.3 });
    const response = await agent.post(analysisUrl(collectionId, runId, 0));
    expect(response.body.analysis.conclusion).toEqual({
      kind: "insufficient-evidence",
      reason: "below-confidence-threshold",
      confidence: 0.3,
    });
    const list = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}/failure-analyses`);
    expect(list.body.analyses[0].conclusion.kind).toBe("insufficient-evidence");
  }, 60_000);

  it("keeps the stored analysis when a later attempt times out (US3, FR-015)", async () => {
    const { provider, state } = controllableProvider();
    const agent = request.agent(createApp(provider));
    const { collectionId, runId } = await uploadAndRun(agent, baseUrl);
    await pollRun(agent, collectionId, runId, (run) => run.status === "completed");

    const stored = (await agent.post(analysisUrl(collectionId, runId, 0))).body.analysis;
    state.error = "TIMEOUT";
    const failed = await agent.post(analysisUrl(collectionId, runId, 0));

    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ status: "ai-failed", aiErrorCategory: "TIMEOUT", previousAnalysis: stored });
    expect(failed.body.message).not.toContain("internal detail");
    const list = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}/failure-analyses`);
    expect(list.body.analyses).toEqual([stored]);
    expect(state.calls).toBe(2);
  }, 60_000);
});
