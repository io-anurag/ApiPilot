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
    getInputBudget: async () => undefined,
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

    const afterReview = await request(app).post(
      "/api/test-generation-workflow/api-review/continue",
    );
    expect(afterReview.status).toBe(200);
    expect(afterReview.body.workflow.activeStageId).toBe("deterministicGeneration");

    const afterGeneration = await request(app).post(
      "/api/test-generation-workflow/deterministic-generation",
    );
    expect(afterGeneration.status).toBe(200);
    expect(afterGeneration.body.workflow.activeStageId).toBe("aiEnhancement");
    expect(
      afterGeneration.body.workflow.deterministicTestModel.scenarios.length,
    ).toBeGreaterThan(0);

    const afterEnhancement = await request(app).post(
      "/api/test-generation-workflow/ai-enhancement",
    );
    expect(afterEnhancement.status).toBe(200);
    expect(afterEnhancement.body.workflow.stages.aiEnhancement.status).toBe("complete");
    expect(afterEnhancement.body.workflow.activeStageId).toBe("scenarioReview");

    const scenario = afterEnhancement.body.workflow.reviewWorkspace.scenarios[0];
    const afterDecision = await request(app)
      .post("/api/test-generation-workflow/scenario-review/decisions")
      .send({
        updates: [
          {
            scenarioId: scenario.scenarioId,
            revision: scenario.revision,
            action: "accept",
          },
        ],
      });
    expect(afterDecision.status).toBe(200);
    expect(afterDecision.body.outcomes[0].applied).toBe(true);

    const afterFinalize = await request(app).post(
      "/api/test-generation-workflow/scenario-review/finalize",
    );
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
          .send({
            decisions: discovered.map((w: { id: string }) => ({
              workflowId: w.id,
              state: "approved",
            })),
          });
      }
      const afterWorkflowReview = await request(app).post(
        "/api/test-generation-workflow/workflow-review/continue",
      );
      expect(afterWorkflowReview.status).toBe(200);
      currentWorkflow = afterWorkflowReview.body.workflow;
    }
    expect(currentWorkflow.stages.workflowReview.status).toBe("complete");
    expect(currentWorkflow.activeStageId).toBe("postmanGeneration");

    const afterPostman = await request(app)
      .post("/api/test-generation-workflow/postman-generation")
      .send({});
    expect(afterPostman.status).toBe(200);
    expect(afterPostman.body.workflow.stages.postmanGeneration.status).toBe("complete");
    expect(
      afterPostman.body.workflow.postmanArtifact.collection.item.length,
    ).toBeGreaterThan(0);
    const approvedScenarioIds = new Set(
      afterPostman.body.workflow.approvedTestModel.scenarios.map(
        (s: { id: string }) => s.id,
      ),
    );
    const requestItemNames =
      afterPostman.body.workflow.postmanArtifact.collection.item.flatMap(
        (folder: { item: { name: string }[] }) => folder.item.map((item) => item.name),
      );
    expect(requestItemNames.length).toBe(approvedScenarioIds.size);
    expect(afterPostman.body.workflow.postmanArtifact.summary).toMatchObject({
      workflowCount: 0,
      omittedWorkflowCount: 0,
    });
    expect(afterPostman.body.workflow.postmanArtifact.readme).toContain(
      "Rendered workflows: 0",
    );
  });

  it("GET reflects the same state a fresh browser connection would see after a reload (US2, FR-014)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    await request(app).post("/api/test-generation-workflow/api-review/continue");
    const afterGeneration = await request(app).post(
      "/api/test-generation-workflow/deterministic-generation",
    );

    const resumed = await request(app).get("/api/test-generation-workflow");
    expect(resumed.status).toBe(200);
    expect(resumed.body.workflow.activeStageId).toBe(
      afterGeneration.body.workflow.activeStageId,
    );
    expect(resumed.body.workflow.deterministicTestModel).toEqual(
      afterGeneration.body.workflow.deterministicTestModel,
    );
  });

  it("revising an approved scenario after completing the workflow marks downstream stages stale (US3, SC-003)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    await request(app).post("/api/test-generation-workflow/api-review/continue");
    await request(app).post("/api/test-generation-workflow/deterministic-generation");
    const afterEnhancement = await request(app).post(
      "/api/test-generation-workflow/ai-enhancement",
    );
    const scenario = afterEnhancement.body.workflow.reviewWorkspace.scenarios[0];
    await request(app)
      .post("/api/test-generation-workflow/scenario-review/decisions")
      .send({
        updates: [
          {
            scenarioId: scenario.scenarioId,
            revision: scenario.revision,
            action: "accept",
          },
        ],
      });
    const afterFinalize = await request(app).post(
      "/api/test-generation-workflow/scenario-review/finalize",
    );

    let workflow = afterFinalize.body.workflow;
    if (workflow.stages.workflowReview.status === "active") {
      const discovered = workflow.dependencyAnalysis.workflows;
      if (discovered.length > 0) {
        await request(app)
          .post("/api/test-generation-workflow/workflow-review/decisions")
          .send({
            decisions: discovered.map((w: { id: string }) => ({
              workflowId: w.id,
              state: "approved",
            })),
          });
      }
      const afterWorkflowReview = await request(app).post(
        "/api/test-generation-workflow/workflow-review/continue",
      );
      workflow = afterWorkflowReview.body.workflow;
    }
    await request(app).post("/api/test-generation-workflow/postman-generation").send({});

    // Revise the previously-accepted decision.
    const revision = await request(app)
      .post("/api/test-generation-workflow/scenario-review/decisions")
      .send({
        updates: [
          {
            scenarioId: scenario.scenarioId,
            revision: scenario.revision,
            action: "reject",
            reason: "changed mind",
          },
        ],
      });
    expect(revision.status).toBe(200);
    expect(revision.body.workflow.stages.scenarioReview.status).toBe("active");
    expect(revision.body.workflow.stages.dependencyAnalysis.status).toBe("stale");
    expect(revision.body.workflow.stages.workflowReview.status).toBe("stale");
    expect(revision.body.workflow.stages.postmanGeneration.status).toBe("stale");

    const resumed = await request(app).get("/api/test-generation-workflow");
    expect(resumed.body.workflow.stages.postmanGeneration.status).toBe("stale");

    const blockedRetry = await request(app)
      .post("/api/test-generation-workflow/postman-generation")
      .send({});
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
      getInputBudget: async () => undefined,
      infer: async (req) => {
        if (!providerAvailable) {
          throw Object.assign(new Error("unavailable"), {
            category: "PROVIDER_UNAVAILABLE",
          });
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

    const skipped = await request(app).post(
      "/api/test-generation-workflow/ai-enhancement",
    );
    expect(skipped.status).toBe(200);
    expect(skipped.body.workflow.stages.aiEnhancement.status).toBe("skipped");
    expect(skipped.body.workflow.activeStageId).toBe("scenarioReview");

    providerAvailable = true;
    const retried = await request(app).post(
      "/api/test-generation-workflow/ai-enhancement",
    );
    expect(retried.status).toBe(200);
    expect(retried.body.workflow.stages.aiEnhancement.status).toBe("complete");

    const scenario = retried.body.workflow.reviewWorkspace.scenarios[0];
    await request(app)
      .post("/api/test-generation-workflow/scenario-review/decisions")
      .send({
        updates: [
          {
            scenarioId: scenario.scenarioId,
            revision: scenario.revision,
            action: "accept",
          },
        ],
      });
    await request(app).post("/api/test-generation-workflow/scenario-review/finalize");

    const afterFinalizeRetry = await request(app).post(
      "/api/test-generation-workflow/ai-enhancement",
    );
    expect(afterFinalizeRetry.status).toBe(409);
    expect(afterFinalizeRetry.body.error).toBe("stage_not_active");
  });

  it("blocks a stage before its predecessor is complete (FR-002)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    const response = await request(app).post(
      "/api/test-generation-workflow/deterministic-generation",
    );
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("stage_not_active");
  });

  it("GET returns stages.aiEnhancement.progress while a multi-batch run is active, identically across independent polls, and absent again once it finishes (specs/012-ai-enhancement-progress)", async () => {
    const progressPairs: { a: unknown; b: unknown }[] = [];
    // Small budget splits the fixture's 3 operations into one batch each (mirrors the existing
    // "partial outcome" convention in aiEnhancementStage.test.ts).
    const provider: AIProvider = {
      mode: "mock",
      getReadiness: () => ({
        state: "ready",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date(0).toISOString(),
      }),
      getInputBudget: async () => 10,
      infer: async (req) => {
        // Two independent GET calls "mid-batch" simulate two different browser
        // tabs/reconnects polling at the same moment — both must see identical state.
        const pollA = await request(app).get("/api/test-generation-workflow");
        const pollB = await request(app).get("/api/test-generation-workflow");
        progressPairs.push({
          a: pollA.body.workflow.stages.aiEnhancement.progress,
          b: pollB.body.workflow.stages.aiEnhancement.progress,
        });
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
    const afterEnhancement = await request(app).post(
      "/api/test-generation-workflow/ai-enhancement",
    );
    expect(afterEnhancement.status).toBe(200);
    expect(afterEnhancement.body.workflow.stages.aiEnhancement.status).toBe("complete");

    expect(progressPairs).toHaveLength(3);
    progressPairs.forEach((pair, index) => {
      expect(pair.a).toBeDefined();
      // A second, independent poll at the same instant sees exactly the same state (FR-007
      // edge case: reconnecting/another tab is never told something different).
      expect(pair.a).toEqual(pair.b);
      expect((pair.a as { totalBatches: number }).totalBatches).toBe(3);
      expect(
        (pair.a as { batches: { index: number; status: string }[] }).batches[index]
          .status,
      ).toBe("in-progress");
    });

    // Final state: progress absent, terminal status present (FR-006).
    expect(afterEnhancement.body.workflow.stages.aiEnhancement.progress).toBeUndefined();
  });

  it("POST ai-enhancement returns 409 ai_enhancement_already_running when a run is already in progress (specs/012-ai-enhancement-progress FR-008)", async () => {
    let concurrentResponse: { status: number; body: { error?: string } } | undefined;
    const provider: AIProvider = {
      mode: "mock",
      getReadiness: () => ({
        state: "ready",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date(0).toISOString(),
      }),
      getInputBudget: async () => 10,
      infer: async (req) => {
        if (req.requestId.endsWith("-batch1") && !concurrentResponse) {
          concurrentResponse = await request(app).post(
            "/api/test-generation-workflow/ai-enhancement",
          );
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
    const afterEnhancement = await request(app).post(
      "/api/test-generation-workflow/ai-enhancement",
    );

    expect(afterEnhancement.status).toBe(200);
    expect(concurrentResponse?.status).toBe(409);
    expect(concurrentResponse?.body.error).toBe("ai_enhancement_already_running");
  });
});

/**
 * `POST .../ai-enhancement/retry-batch` (specs/015-ai-batch-retry,
 * contracts/ai-enhancement-retry-batch.md). `valid.yaml`'s 3 operations are batched one-per-batch
 * (`getInputBudget` returns 10): GET /pets=0, POST /pets=1, GET /pets/{petId}=2.
 */
describe("POST /api/test-generation-workflow/ai-enhancement/retry-batch", () => {
  beforeEach(() => resetStore());

  const FAILING_KEY = "POST /pets";
  const FAILING_INDEX = 1;

  function controllableProvider() {
    const behavior = new Map<string, "fail" | "succeed">();
    let seq = 0;
    const provider: AIProvider = {
      mode: "mock",
      getReadiness: () => ({
        state: "ready",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date(0).toISOString(),
      }),
      getInputBudget: async () => 10,
      infer: async (req) => {
        const parsed = JSON.parse(req.input) as {
          operations: { path: string; method: string }[];
        };
        const op = parsed.operations[0];
        const key = `${op.method} ${op.path}`;
        if (behavior.get(key) === "fail") {
          throw Object.assign(new Error("unavailable"), {
            category: "PROVIDER_UNAVAILABLE",
          });
        }
        seq += 1;
        return {
          contractVersion: 1,
          requestId: req.requestId,
          status: "success",
          content: JSON.stringify({
            responseVersion: 1,
            candidates: [
              {
                candidateId: `cand-${key}-${seq}`,
                operationPath: op.path,
                operationMethod: op.method,
                category: "positive",
                request: {
                  pathParameters: {},
                  queryParameters: {},
                  headers: {},
                  body: {},
                },
                assertions: [],
                rationale: `Exercise ${key}.`,
                confidence: 0.7,
                assumptions: [],
              },
            ],
          }),
          modelId: "mock-model",
          provider: "mock",
          durationMs: 1,
        };
      },
    };
    return { provider, behavior };
  }

  async function walkToPartialRun(app: ReturnType<typeof createApp>) {
    await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    await request(app).post("/api/test-generation-workflow/api-review/continue");
    await request(app).post("/api/test-generation-workflow/deterministic-generation");
    const afterEnhancement = await request(app).post(
      "/api/test-generation-workflow/ai-enhancement",
    );
    expect(afterEnhancement.body.workflow.stages.aiEnhancement.status).toBe("partial");
    return afterEnhancement;
  }

  it("200s and recomputes the stage to complete when the retried batch succeeds", async () => {
    const { provider, behavior } = controllableProvider();
    behavior.set(FAILING_KEY, "fail");
    const app = createApp(provider);
    await walkToPartialRun(app);

    behavior.set(FAILING_KEY, "succeed");
    const response = await request(app)
      .post("/api/test-generation-workflow/ai-enhancement/retry-batch")
      .send({ batchIndex: FAILING_INDEX });

    expect(response.status).toBe(200);
    expect(response.body.workflow.stages.aiEnhancement.status).toBe("complete");
    expect(
      response.body.workflow.stages.aiEnhancement.batchOutcomes[FAILING_INDEX].status,
    ).toBe("succeeded");
  });

  it("404s on an out-of-range batchIndex", async () => {
    const { provider, behavior } = controllableProvider();
    behavior.set(FAILING_KEY, "fail");
    const app = createApp(provider);
    await walkToPartialRun(app);

    const response = await request(app)
      .post("/api/test-generation-workflow/ai-enhancement/retry-batch")
      .send({ batchIndex: 99 });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("batch_not_found");
  });

  it("409s with batch_not_retryable for a batch that already succeeded", async () => {
    const { provider, behavior } = controllableProvider();
    behavior.set(FAILING_KEY, "fail");
    const app = createApp(provider);
    await walkToPartialRun(app);

    const response = await request(app)
      .post("/api/test-generation-workflow/ai-enhancement/retry-batch")
      .send({ batchIndex: 0 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("batch_not_retryable");
  });

  it("409s with stage_not_active once scenarioReview has been finalized", async () => {
    const { provider, behavior } = controllableProvider();
    behavior.set(FAILING_KEY, "fail");
    const app = createApp(provider);
    const afterEnhancement = await walkToPartialRun(app);

    const scenario = afterEnhancement.body.workflow.reviewWorkspace.scenarios[0];
    await request(app)
      .post("/api/test-generation-workflow/scenario-review/decisions")
      .send({
        updates: [
          {
            scenarioId: scenario.scenarioId,
            revision: scenario.revision,
            action: "accept",
          },
        ],
      });
    await request(app).post("/api/test-generation-workflow/scenario-review/finalize");

    const response = await request(app)
      .post("/api/test-generation-workflow/ai-enhancement/retry-batch")
      .send({ batchIndex: FAILING_INDEX });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("stage_not_active");
  });

  it("409s with ai_enhancement_already_running when a retry is attempted while another operation is in progress", async () => {
    const { provider, behavior } = controllableProvider();
    behavior.set(FAILING_KEY, "fail");
    const app = createApp(provider);
    await walkToPartialRun(app);

    let concurrentResponse: { status: number; body: { error?: string } } | undefined;
    behavior.set(FAILING_KEY, "succeed");
    const originalInfer = provider.infer;
    // The router was constructed with this same `provider` object at app-creation time, so
    // reassigning its `infer` in place is observed by the in-flight request below.
    provider.infer = async (req) => {
      if (!concurrentResponse) {
        concurrentResponse = await request(app)
          .post("/api/test-generation-workflow/ai-enhancement/retry-batch")
          .send({ batchIndex: FAILING_INDEX });
      }
      return originalInfer(req);
    };

    const response = await request(app)
      .post("/api/test-generation-workflow/ai-enhancement/retry-batch")
      .send({ batchIndex: FAILING_INDEX });

    expect(response.status).toBe(200);
    expect(concurrentResponse?.status).toBe(409);
    expect(concurrentResponse?.body.error).toBe("ai_enhancement_already_running");
  });

  it("400s when batchIndex is missing or not an integer", async () => {
    const { provider, behavior } = controllableProvider();
    behavior.set(FAILING_KEY, "fail");
    const app = createApp(provider);
    await walkToPartialRun(app);

    const missing = await request(app).post(
      "/api/test-generation-workflow/ai-enhancement/retry-batch",
    );
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("invalid_request");

    const notInteger = await request(app)
      .post("/api/test-generation-workflow/ai-enhancement/retry-batch")
      .send({ batchIndex: 1.5 });
    expect(notInteger.status).toBe(400);
  });
});
