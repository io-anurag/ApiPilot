import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { AIProvider } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import { resetStore } from "../../src/testGenerationWorkflow/workflowStore";
import {
  VALID_SPECIFICATION_FILENAME,
  validSpecificationBuffer,
} from "../fixtures/testGenerationWorkflow/workflowFixtures";

function fixedProvider(content: string): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    infer: async (req) => ({
      contractVersion: 1,
      requestId: req.requestId,
      status: "success",
      content,
      modelId: "mock-model",
      provider: "mock",
      durationMs: 1,
    }),
  };
}

const emptyCandidates = JSON.stringify({ responseVersion: 1, candidates: [] });

describe("test generation workflow orchestration", () => {
  beforeEach(() => resetStore());

  it("starts a workflow and refuses a second start unless discardExisting=true (FR-001, FR-010)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));

    const first = await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    expect(first.status).toBe(200);
    expect(first.body.workflow.activeStageId).toBe("apiReview");

    const conflict = await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("workflow_in_progress");

    const discarded = await request(app)
      .post("/api/test-generation-workflow?discardExisting=true")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    expect(discarded.status).toBe(200);
    expect(discarded.body.workflow.id).not.toBe(first.body.workflow.id);
  });

  it("maps malformed uploads to AP-002's existing error codes", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", Buffer.from(": not: yaml: : ["), "bad.yaml");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_yaml");
  });

  it("GET returns 204 when no workflow is in progress", async () => {
    const app = createApp();
    const response = await request(app).get("/api/test-generation-workflow");
    expect(response.status).toBe(204);
  });

  it("walks the full sequence from upload to a downloadable Postman collection (US1)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));

    const started = await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    expect(started.status).toBe(200);

    const afterReview = await request(app).post("/api/test-generation-workflow/api-review/continue");
    expect(afterReview.status).toBe(200);
    expect(afterReview.body.workflow.activeStageId).toBe("deterministicGeneration");

    const afterGeneration = await request(app).post("/api/test-generation-workflow/deterministic-generation");
    expect(afterGeneration.status).toBe(200);
    expect(afterGeneration.body.workflow.activeStageId).toBe("aiEnhancement");
    expect(afterGeneration.body.workflow.deterministicTestModel.scenarios.length).toBeGreaterThan(0);

    const afterEnhancement = await request(app).post("/api/test-generation-workflow/ai-enhancement");
    expect(afterEnhancement.status).toBe(200);
    expect(afterEnhancement.body.workflow.stages.aiEnhancement.status).toBe("complete");
    expect(afterEnhancement.body.workflow.activeStageId).toBe("scenarioReview");

    const scenario = afterEnhancement.body.workflow.reviewWorkspace.scenarios[0];
    const afterDecision = await request(app)
      .post("/api/test-generation-workflow/scenario-review/decisions")
      .send({ updates: [{ scenarioId: scenario.scenarioId, revision: scenario.revision, action: "accept" }] });
    expect(afterDecision.status).toBe(200);
    expect(afterDecision.body.outcomes[0].applied).toBe(true);

    const afterFinalize = await request(app).post("/api/test-generation-workflow/scenario-review/finalize");
    expect(afterFinalize.status).toBe(200);
    expect(afterFinalize.body.workflow.stages.scenarioReview.status).toBe("complete");
    expect(afterFinalize.body.workflow.stages.dependencyAnalysis.status).toBe("complete");
    const workflowReviewStatus = afterFinalize.body.workflow.stages.workflowReview.status;
    expect(["active", "complete"]).toContain(workflowReviewStatus);

    let currentWorkflow = afterFinalize.body.workflow;
    if (workflowReviewStatus === "active") {
      const discovered = currentWorkflow.dependencyAnalysis.workflows;
      if (discovered.length > 0) {
        await request(app)
          .post("/api/test-generation-workflow/workflow-review/decisions")
          .send({ decisions: discovered.map((w: { id: string }) => ({ workflowId: w.id, state: "approved" })) });
      }
      const afterWorkflowReview = await request(app).post("/api/test-generation-workflow/workflow-review/continue");
      expect(afterWorkflowReview.status).toBe(200);
      currentWorkflow = afterWorkflowReview.body.workflow;
    }
    expect(currentWorkflow.stages.workflowReview.status).toBe("complete");
    expect(currentWorkflow.activeStageId).toBe("postmanGeneration");

    const afterPostman = await request(app).post("/api/test-generation-workflow/postman-generation").send({});
    expect(afterPostman.status).toBe(200);
    expect(afterPostman.body.workflow.stages.postmanGeneration.status).toBe("complete");
    expect(afterPostman.body.workflow.postmanArtifact.collection.item.length).toBeGreaterThan(0);
    const approvedScenarioIds = new Set(
      afterPostman.body.workflow.approvedTestModel.scenarios.map((s: { id: string }) => s.id),
    );
    const requestItemNames = afterPostman.body.workflow.postmanArtifact.collection.item.flatMap(
      (folder: { item: { name: string }[] }) => folder.item.map((item) => item.name),
    );
    expect(requestItemNames.length).toBe(approvedScenarioIds.size);
  });

  it("GET reflects the same state a fresh browser connection would see after a reload (US2, FR-014)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    await request(app).post("/api/test-generation-workflow/api-review/continue");
    const afterGeneration = await request(app).post("/api/test-generation-workflow/deterministic-generation");

    const resumed = await request(app).get("/api/test-generation-workflow");
    expect(resumed.status).toBe(200);
    expect(resumed.body.workflow.activeStageId).toBe(afterGeneration.body.workflow.activeStageId);
    expect(resumed.body.workflow.deterministicTestModel).toEqual(afterGeneration.body.workflow.deterministicTestModel);
  });

  it("revising an approved scenario after completing the workflow marks downstream stages stale (US3, SC-003)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    await request(app).post("/api/test-generation-workflow/api-review/continue");
    await request(app).post("/api/test-generation-workflow/deterministic-generation");
    const afterEnhancement = await request(app).post("/api/test-generation-workflow/ai-enhancement");
    const scenario = afterEnhancement.body.workflow.reviewWorkspace.scenarios[0];
    await request(app)
      .post("/api/test-generation-workflow/scenario-review/decisions")
      .send({ updates: [{ scenarioId: scenario.scenarioId, revision: scenario.revision, action: "accept" }] });
    const afterFinalize = await request(app).post("/api/test-generation-workflow/scenario-review/finalize");

    let workflow = afterFinalize.body.workflow;
    if (workflow.stages.workflowReview.status === "active") {
      const discovered = workflow.dependencyAnalysis.workflows;
      if (discovered.length > 0) {
        await request(app)
          .post("/api/test-generation-workflow/workflow-review/decisions")
          .send({ decisions: discovered.map((w: { id: string }) => ({ workflowId: w.id, state: "approved" })) });
      }
      const afterWorkflowReview = await request(app).post("/api/test-generation-workflow/workflow-review/continue");
      workflow = afterWorkflowReview.body.workflow;
    }
    await request(app).post("/api/test-generation-workflow/postman-generation").send({});

    // Revise the previously-accepted decision.
    const revision = await request(app)
      .post("/api/test-generation-workflow/scenario-review/decisions")
      .send({
        updates: [
          { scenarioId: scenario.scenarioId, revision: scenario.revision, action: "reject", reason: "changed mind" },
        ],
      });
    expect(revision.status).toBe(200);
    expect(revision.body.workflow.stages.scenarioReview.status).toBe("active");
    expect(revision.body.workflow.stages.dependencyAnalysis.status).toBe("stale");
    expect(revision.body.workflow.stages.workflowReview.status).toBe("stale");
    expect(revision.body.workflow.stages.postmanGeneration.status).toBe("stale");

    const resumed = await request(app).get("/api/test-generation-workflow");
    expect(resumed.body.workflow.stages.postmanGeneration.status).toBe("stale");

    const blockedRetry = await request(app).post("/api/test-generation-workflow/postman-generation").send({});
    expect(blockedRetry.status).toBe(409);
    expect(blockedRetry.body.error).toBe("stage_not_active");
  });

  it("continues on skip, then allows retry before finalize but refuses it after (US4)", async () => {
    let providerAvailable = false;
    const provider: AIProvider = {
      mode: "mock",
      getReadiness: () => ({
        state: providerAvailable ? "ready" : "unavailable",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date(0).toISOString(),
      }),
      infer: async (req) => {
        if (!providerAvailable) {
          throw Object.assign(new Error("unavailable"), { category: "PROVIDER_UNAVAILABLE" });
        }
        return {
          contractVersion: 1,
          requestId: req.requestId,
          status: "success",
          content: emptyCandidates,
          modelId: "mock-model",
          provider: "mock",
          durationMs: 1,
        };
      },
    };
    const app = createApp(provider);

    await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    await request(app).post("/api/test-generation-workflow/api-review/continue");
    await request(app).post("/api/test-generation-workflow/deterministic-generation");

    const skipped = await request(app).post("/api/test-generation-workflow/ai-enhancement");
    expect(skipped.status).toBe(200);
    expect(skipped.body.workflow.stages.aiEnhancement.status).toBe("skipped");
    expect(skipped.body.workflow.activeStageId).toBe("scenarioReview");

    providerAvailable = true;
    const retried = await request(app).post("/api/test-generation-workflow/ai-enhancement");
    expect(retried.status).toBe(200);
    expect(retried.body.workflow.stages.aiEnhancement.status).toBe("complete");

    const scenario = retried.body.workflow.reviewWorkspace.scenarios[0];
    await request(app)
      .post("/api/test-generation-workflow/scenario-review/decisions")
      .send({ updates: [{ scenarioId: scenario.scenarioId, revision: scenario.revision, action: "accept" }] });
    await request(app).post("/api/test-generation-workflow/scenario-review/finalize");

    const afterFinalizeRetry = await request(app).post("/api/test-generation-workflow/ai-enhancement");
    expect(afterFinalizeRetry.status).toBe(409);
    expect(afterFinalizeRetry.body.error).toBe("stage_not_active");
  });

  it("blocks a stage before its predecessor is complete (FR-002)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    const response = await request(app).post("/api/test-generation-workflow/deterministic-generation");
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("stage_not_active");
  });
});
