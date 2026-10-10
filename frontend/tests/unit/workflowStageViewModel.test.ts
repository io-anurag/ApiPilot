import { describe, expect, it } from "vitest";
import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";
import {
  STAGE_LABELS,
  WORKFLOW_PHASES,
  getLockReason,
  getPhaseOfStage,
  getPhaseProgress,
} from "../../src/components/workflowStageViewModel";

function workflowWithStatuses(
  statuses: Partial<Record<WorkflowStageId, StageStatus>>,
): TestGenerationWorkflow {
  const stages = Object.fromEntries(
    WORKFLOW_STAGE_ORDER.map((stageId) => [
      stageId,
      { stageId, status: statuses[stageId] ?? "not-yet-reached" },
    ]),
  ) as TestGenerationWorkflow["stages"];
  return {
    id: "wf-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    activeStageId: "postmanGeneration",
    stages,
    specificationFilename: "valid.yaml",
  };
}

const THROUGH_POSTMAN: Partial<Record<WorkflowStageId, StageStatus>> = Object.fromEntries(
  WORKFLOW_STAGE_ORDER.slice(0, WORKFLOW_STAGE_ORDER.indexOf("postmanGeneration") + 1).map(
    (stageId) => [stageId, "complete" as StageStatus],
  ),
);

describe("workflowStageViewModel (AP-029)", () => {
  it("labels the performance stage", () => {
    expect(STAGE_LABELS.performanceTesting).toBe("Performance Testing");
  });

  it("locks performanceTesting until Postman Generation is complete", () => {
    const wf = workflowWithStatuses({ ...THROUGH_POSTMAN, postmanGeneration: "active" });
    expect(getLockReason("performanceTesting", wf)).toBe("Complete Postman Generation first");
  });

  it("never locks performanceTesting on the execution stage's status (research D1)", () => {
    for (const execution of ["not-yet-reached", "active", "skipped"] as StageStatus[]) {
      const wf = workflowWithStatuses({ ...THROUGH_POSTMAN, execution });
      expect(getLockReason("performanceTesting", wf)).toBeUndefined();
    }
  });

  it("still locks execution on its own predecessor", () => {
    const wf = workflowWithStatuses({ ...THROUGH_POSTMAN, postmanGeneration: "active" });
    expect(getLockReason("execution", wf)).toBe("Complete Postman Generation first");
  });
});

describe("workflow phases", () => {
  it("assigns every stage to exactly one phase, in workflow order", () => {
    expect(WORKFLOW_PHASES.flatMap((phase) => phase.stages)).toEqual([...WORKFLOW_STAGE_ORDER]);
    expect(getPhaseOfStage("scenarioReview").id).toBe("design");
  });

  const execute = WORKFLOW_PHASES.find((phase) => phase.id === "execute")!;

  it("reads an untouched phase as locked and a partly finished one as in progress", () => {
    expect(getPhaseProgress(execute, workflowWithStatuses({})).status).toBe("locked");
    expect(
      getPhaseProgress(execute, workflowWithStatuses({ postmanGeneration: "complete" })),
    ).toMatchObject({ status: "in-progress", doneCount: 1, totalCount: 3 });
  });

  it("does not hold the Execute phase back for the optional performance stage", () => {
    const wf = workflowWithStatuses({ postmanGeneration: "complete", execution: "complete" });
    expect(getPhaseProgress(execute, wf)).toMatchObject({ status: "complete", doneCount: 2 });
  });

  it("lets a stale stage override completeness", () => {
    const design = WORKFLOW_PHASES.find((phase) => phase.id === "design")!;
    const wf = workflowWithStatuses({
      deterministicGeneration: "complete",
      aiEnhancement: "complete",
      scenarioReview: "stale",
    });
    expect(getPhaseProgress(design, wf).status).toBe("attention");
  });
});
