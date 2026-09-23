import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AIProvider,
  ExportResult,
  InferenceHooks,
  InferenceRequest,
  InferenceResponse,
  PostmanRequestItem,
} from "@apipilot/shared-domain";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";
import { modelAnswer } from "../../fixtures/failureAnalysis/fixtures";

type Agent = ReturnType<typeof request.agent>;

/**
 * Answers failure-analysis requests with a valid analysis and every other AI pass (scenario
 * enhancement, dependency analysis) with an empty candidate list, so the guided workflow runs on
 * deterministic output only.
 */
function workflowAwareProvider(): AIProvider {
  return {
    mode: "local",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    getInputBudget: async () => undefined,
    async infer(inferenceRequest: InferenceRequest, hooks?: InferenceHooks): Promise<InferenceResponse> {
      hooks?.onStarted?.();
      let content: string;
      if (inferenceRequest.requestId.startsWith("failure-")) {
        content = modelAnswer({ evidenceIds: ["E1"] });
      } else {
        const version = (JSON.parse(inferenceRequest.input) as { responseVersion?: number }).responseVersion;
        content = JSON.stringify({ responseVersion: version, candidates: [] });
      }
      return {
        contractVersion: 1,
        requestId: inferenceRequest.requestId,
        status: "success",
        content,
        modelId: "test-model",
        provider: "local",
        durationMs: 1,
      };
    },
  };
}

async function generateCollection(agent: Agent): Promise<ExportResult> {
  const spec = readFileSync(path.join(__dirname, "..", "..", "fixtures", "failureAnalysis", "users-api.yaml"));
  expect((await agent.post("/api/test-generation-workflow").attach("file", spec, "users-api.yaml")).status).toBe(200);
  expect((await agent.post("/api/test-generation-workflow/api-review/continue")).status).toBe(200);
  expect((await agent.post("/api/test-generation-workflow/deterministic-generation")).status).toBe(200);
  const enhanced = await agent.post("/api/test-generation-workflow/ai-enhancement");
  expect(enhanced.status).toBe(200);
  const positives = (
    enhanced.body.workflow.reviewWorkspace.scenarios as Array<{
      scenarioId: string;
      revision: number;
      scenario: { category: string };
    }>
  ).filter((entry) => entry.scenario.category === "positive");
  const decided = await agent.post("/api/test-generation-workflow/scenario-review/decisions").send({
    updates: positives.map((entry) => ({ scenarioId: entry.scenarioId, revision: entry.revision, action: "accept" })),
  });
  expect(decided.status).toBe(200);
  const finalized = await agent.post("/api/test-generation-workflow/scenario-review/finalize");
  expect(finalized.status).toBe(200);

  let workflow = finalized.body.workflow;
  if (workflow.stages.workflowReview.status === "active") {
    const discovered = workflow.dependencyAnalysis.workflows as Array<{ id: string }>;
    if (discovered.length > 0) {
      await agent
        .post("/api/test-generation-workflow/workflow-review/decisions")
        .send({ decisions: discovered.map((w) => ({ workflowId: w.id, state: "approved" })) });
    }
    workflow = (await agent.post("/api/test-generation-workflow/workflow-review/continue")).body.workflow;
  }
  const generated = await agent.post("/api/test-generation-workflow/postman-generation").send({});
  expect(generated.status).toBe(200);  return generated.body.workflow.postmanArtifact as ExportResult;
}

function allItems(artifact: ExportResult): PostmanRequestItem[] {
  return artifact.collection.item.flatMap((folder) => folder.item);
}

async function uploadAndRun(agent: Agent, artifact: ExportResult, baseUrl: string) {
  const environment = {
    ...artifact.environment,
    values: artifact.environment.values.map((value) =>
      value.key === "baseUrl" ? { ...value, value: baseUrl } : value,
    ),
  };
  const upload = await agent
    .post("/api/external-collections")
    .field("name", "Generated users collection")
    .field("tier", "local")
    .attach("collection", Buffer.from(JSON.stringify(artifact.collection)), "collection.json")
    .attach("environment", Buffer.from(JSON.stringify(environment)), "environment.json");
  expect(upload.status).toBe(201);
  const collectionId = upload.body.uploadedCollection.id as string;

  let started = await agent.post(`/api/external-collections/${collectionId}/execution/start`).send({ confirmed: true });
  if (started.status === 409) {
    started = await agent.post(`/api/external-collections/${collectionId}/execution/start`).send({ confirmed: true });
  }
  expect(started.status).toBe(200);
  const runId = started.body.run.id as string;

  const deadline = Date.now() + 60_000;
  for (;;) {
    const response = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${runId}`);
    if (response.body.run.status !== "in-progress") return { collectionId, run: response.body.run };
    if (Date.now() > deadline) throw new Error("run never settled");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("failure analysis — specification context from the guided workflow (US2)", () => {
  let target: TargetServer;
  let baseUrl: string;

  beforeEach(async () => {
    target = new TargetServer();
    baseUrl = await target.start();
    target.configure("POST", "/users", { status: 500, body: { error: "db unavailable" } });
  });

  afterEach(async () => {
    await target.stop();
  });

  it("attaches the operation, scenario and failed upstream step, and keeps that context after a new workflow starts", async () => {
    const agent = request.agent(createApp(workflowAwareProvider()));
    const artifact = await generateCollection(agent);

    const dependentStep = allItems(artifact).find(
      (item) => item.provenance?.workflowId !== undefined && (item.provenance.stepPosition ?? 0) > 0,
    );
    expect(dependentStep, "the users spec must yield an approved create → get workflow").toBeDefined();
    if (!dependentStep) return;

    const { collectionId, run } = await uploadAndRun(agent, artifact, baseUrl);
    const resultIndex = (run.results as Array<{ itemId?: string }>).findIndex(
      (result) => result.itemId === dependentStep.id,
    );
    expect(resultIndex).toBeGreaterThanOrEqual(0);
    expect(run.results[resultIndex].outcome).toBe("failed");

    const url = `/api/external-collections/${collectionId}/execution/runs/${run.id}/results/${resultIndex}/failure-analysis`;
    const analyzed = await agent.post(url);
    expect(analyzed.status).toBe(200);
    const context = analyzed.body.analysis.specificationContext;
    expect(context).toMatchObject({
      status: "matched",
      scenarioId: dependentStep.provenance?.scenarioId,
      operationPath: "/users/{id}",
      operationMethod: "GET",
      documentedStatusCodes: ["200", "404"],
    });
    expect(context.upstream).toEqual([
      expect.objectContaining({
        via: "integration-workflow",
        operationPath: "/users",
        operationMethod: "POST",
        outcomeInRun: "failed",
      }),
    ]);
    expect(
      (analyzed.body.analysis.evidence as Array<{ source: string }>).some(
        (item) => item.source === "specification-context",
      ),
    ).toBe(true);

    // A new workflow in the same session: the stored context is unchanged, a fresh analysis has none.
    const spec = readFileSync(path.join(__dirname, "..", "..", "fixtures", "failureAnalysis", "users-api.yaml"));
    await agent.post("/api/test-generation-workflow?discardExisting=true").attach("file", spec, "users-api.yaml");

    const list = await agent.get(`/api/external-collections/${collectionId}/execution/runs/${run.id}/failure-analyses`);
    expect(list.body.analyses[0].specificationContext).toEqual(context);

    const fresh = await agent.post(url);
    expect(fresh.body.analysis.specificationContext).toEqual({
      status: "unavailable",
      reason: "no-generated-collection",
    });
  }, 120_000);
});
