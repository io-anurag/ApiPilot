import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiModel, SeedSource, StageStatus, TestGenerationWorkflow, WorkflowStageId } from "@apipilot/shared-domain";
import {
  completeExecutionForUpload,
  completePerformanceForRun,
  shouldCompleteExecution,
  shouldCompletePerformance,
} from "../../../src/testGenerationWorkflow/runCompletion";
import {
  getCurrentWorkflow,
  resetStore,
  startWorkflow,
  updateStage,
} from "../../../src/testGenerationWorkflow/workflowStore";
import { runWithSession } from "../../../src/session/sessionContext";

vi.mock("../../../src/testGenerationWorkflow/workflowStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/testGenerationWorkflow/workflowStore")>();
  return { ...actual, updateStage: vi.fn(actual.updateStage) };
});

const apiModel: ApiModel = {
  info: { title: "Orders API" },
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

function workflowWith(statuses: Partial<Record<WorkflowStageId, StageStatus>>): TestGenerationWorkflow {
  const base = startWorkflow({ specificationFilename: "orders.yaml", apiModel });
  const stages = { ...base.stages };
  for (const [stageId, status] of Object.entries(statuses) as Array<[WorkflowStageId, StageStatus]>) {
    stages[stageId] = { ...stages[stageId], status };
  }
  return { ...base, stages };
}

describe("shouldCompleteExecution", () => {
  const active = (): TestGenerationWorkflow => workflowWith({ execution: "active" });

  it("completes an active Execution for a completed run of the workflow's own upload", () => {
    const workflow = active();
    expect(shouldCompleteExecution(workflow, { sourceWorkflowId: workflow.id }, "completed")).toBe(true);
  });

  it("does nothing for a cancelled or in-progress run", () => {
    const workflow = active();
    expect(shouldCompleteExecution(workflow, { sourceWorkflowId: workflow.id }, "cancelled")).toBe(false);
    expect(shouldCompleteExecution(workflow, { sourceWorkflowId: workflow.id }, "in-progress")).toBe(false);
  });

  it("does nothing for an upload with no link or another workflow's link", () => {
    const workflow = active();
    expect(shouldCompleteExecution(workflow, {}, "completed")).toBe(false);
    expect(shouldCompleteExecution(workflow, { sourceWorkflowId: "wf-1-1" }, "completed")).toBe(false);
  });

  it.each<StageStatus>(["skipped", "complete", "stale", "not-yet-reached"])(
    "leaves an Execution that is %s alone",
    (status) => {
      const workflow = workflowWith({ execution: status });
      expect(shouldCompleteExecution(workflow, { sourceWorkflowId: workflow.id }, "completed")).toBe(false);
    },
  );
});

describe("shouldCompletePerformance", () => {
  const ready = (): TestGenerationWorkflow => workflowWith({ postmanGeneration: "complete" });
  const workflowSeed: SeedSource = { kind: "workflow", specificationTitle: "Orders API" };
  const specificationSeed: SeedSource = { kind: "specification", filename: "orders.yaml" };

  it("does nothing while the run is in progress", () => {
    expect(shouldCompletePerformance(ready(), "in-progress", workflowSeed)).toBe(false);
  });

  it.each(["completed", "failed", "cancelled"] as const)("completes for a %s run seeded from the workflow", (status) => {
    expect(shouldCompletePerformance(ready(), status, workflowSeed)).toBe(true);
  });

  it("completes for a specification seed with the workflow's file name", () => {
    expect(shouldCompletePerformance(ready(), "completed", specificationSeed)).toBe(true);
  });

  it("does nothing for a null seed or a collection seed", () => {
    expect(shouldCompletePerformance(ready(), "completed", null)).toBe(false);
    expect(
      shouldCompletePerformance(ready(), "completed", { kind: "collection", collectionId: "c", collectionName: "n" }),
    ).toBe(false);
  });

  it("does nothing for a different title or file name", () => {
    expect(shouldCompletePerformance(ready(), "completed", { kind: "workflow", specificationTitle: "Other" })).toBe(false);
    expect(shouldCompletePerformance(ready(), "completed", { kind: "specification", filename: "other.yaml" })).toBe(false);
  });

  it("does nothing when the workflow's model declares no title", () => {
    const workflow = { ...ready(), apiModel: { ...apiModel, info: undefined } };
    expect(shouldCompletePerformance(workflow, "completed", workflowSeed)).toBe(false);
  });

  it("does nothing while Postman Generation is not complete", () => {
    const workflow = workflowWith({ postmanGeneration: "active" });
    expect(shouldCompletePerformance(workflow, "completed", workflowSeed)).toBe(false);
  });

  it("does nothing when Performance Testing is already complete", () => {
    const workflow = workflowWith({ postmanGeneration: "complete", performanceTesting: "complete" });
    expect(shouldCompletePerformance(workflow, "completed", workflowSeed)).toBe(false);
  });

  it("completes an active Performance Testing stage", () => {
    const workflow = workflowWith({ postmanGeneration: "complete", performanceTesting: "active" });
    expect(shouldCompletePerformance(workflow, "completed", workflowSeed)).toBe(true);
  });
});

describe("appliers", () => {
  const SESSION = "session-run-completion";

  beforeEach(() => {
    resetStore();
    vi.restoreAllMocks();
    vi.mocked(updateStage).mockClear();
  });

  function prepare(statuses: { execution?: boolean; postman?: boolean }): TestGenerationWorkflow {
    const workflow = startWorkflow({ specificationFilename: "orders.yaml", apiModel });
    if (statuses.postman) {
      updateStage("deterministicGeneration", "active");
      updateStage("deterministicGeneration", "complete");
      updateStage("postmanGeneration", "active");
      updateStage("postmanGeneration", "complete");
    }
    if (statuses.execution) updateStage("execution", "active");
    return workflow;
  }

  it("completes Execution once and leaves completedAt unchanged on a second application", () => {
    runWithSession(SESSION, () => {
      const workflow = prepare({ postman: true, execution: true });
      completeExecutionForUpload(workflow.id, "completed");
      const first = getCurrentWorkflow()!.stages.execution;
      expect(first.status).toBe("complete");
      completeExecutionForUpload(workflow.id, "completed");
      expect(getCurrentWorkflow()!.stages.execution.completedAt).toBe(first.completedAt);
    });
  });

  it("completes Performance Testing from not-yet-reached and is idempotent", () => {
    runWithSession(SESSION, () => {
      prepare({ postman: true });
      const seed: SeedSource = { kind: "workflow", specificationTitle: "Orders API" };
      completePerformanceForRun(SESSION, "completed", seed);
      const first = getCurrentWorkflow()!.stages.performanceTesting;
      expect(first.status).toBe("complete");
      completePerformanceForRun(SESSION, "failed", seed);
      expect(getCurrentWorkflow()!.stages.performanceTesting.completedAt).toBe(first.completedAt);
    });
  });

  it("does nothing, and does not throw, when the session has no workflow", () => {
    runWithSession(SESSION, () => {
      expect(() => completeExecutionForUpload("wf-1-1", "completed")).not.toThrow();
    });
    expect(() => completePerformanceForRun(SESSION, "completed", { kind: "workflow", specificationTitle: "x" })).not.toThrow();
  });

  it("logs a store error and does not rethrow it", () => {
    runWithSession(SESSION, () => {
      const workflow = prepare({ postman: true, execution: true });
      vi.mocked(updateStage).mockImplementationOnce(() => {
        throw new Error("boom");
      });
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(() => completeExecutionForUpload(workflow.id, "completed")).not.toThrow();
      expect(log.mock.calls.some(([line]) => String(line).includes("stage_update_failed"))).toBe(true);
    });
  });

  it("applies the performance rule for a session with no request context", () => {
    runWithSession(SESSION, () => prepare({ postman: true }));
    // Called outside any runWithSession, as a settling k6 run's callbacks are.
    completePerformanceForRun(SESSION, "cancelled", { kind: "specification", filename: "orders.yaml" });
    const stage = runWithSession(SESSION, () => getCurrentWorkflow()!.stages.performanceTesting);
    expect(stage.status).toBe("complete");
  });
});
