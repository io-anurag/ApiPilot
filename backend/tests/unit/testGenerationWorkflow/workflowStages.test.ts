import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGE_ORDER, type TestGenerationWorkflow, type WorkflowStageId } from "@apipilot/shared-domain";
import { isStageEnterable, nextStageId, previousStageId } from "../../../src/testGenerationWorkflow/workflowStages";

function workflowWithStatuses(
  statuses: Partial<Record<WorkflowStageId, "not-yet-reached" | "active" | "complete" | "stale" | "skipped">>,
): TestGenerationWorkflow {
  const stages = Object.fromEntries(
    WORKFLOW_STAGE_ORDER.map((stageId) => [
      stageId,
      { stageId, status: statuses[stageId] ?? "not-yet-reached" },
    ]),
  ) as TestGenerationWorkflow["stages"];
  return {
    id: "wf-test",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    activeStageId: "upload",
    stages,
    specificationFilename: "valid.yaml",
  };
}

describe("workflowStages", () => {
  it("WORKFLOW_STAGE_ORDER matches the eleven-stage list (specs/009 Clarifications 2026-09-20 adds 'execution'; AP-029 adds 'performanceTesting')", () => {
    expect(WORKFLOW_STAGE_ORDER).toEqual([
      "upload",
      "analysis",
      "apiReview",
      "deterministicGeneration",
      "aiEnhancement",
      "scenarioReview",
      "dependencyAnalysis",
      "workflowReview",
      "postmanGeneration",
      "execution",
      "performanceTesting",
    ]);
  });

  it("upload is always enterable", () => {
    expect(isStageEnterable(workflowWithStatuses({}), "upload")).toBe(true);
  });

  it("every ordinary stage requires its immediate predecessor complete", () => {
    const wf = workflowWithStatuses({ upload: "complete", analysis: "complete" });
    expect(isStageEnterable(wf, "apiReview")).toBe(true);
    expect(isStageEnterable(wf, "deterministicGeneration")).toBe(false);
  });

  it("scenarioReview is enterable once aiEnhancement is complete", () => {
    const wf = workflowWithStatuses({ aiEnhancement: "complete" });
    expect(isStageEnterable(wf, "scenarioReview")).toBe(true);
  });

  it("scenarioReview is enterable once aiEnhancement is skipped (FR-008)", () => {
    const wf = workflowWithStatuses({ aiEnhancement: "skipped" });
    expect(isStageEnterable(wf, "scenarioReview")).toBe(true);
  });

  it("scenarioReview is not enterable while aiEnhancement is only active", () => {
    const wf = workflowWithStatuses({ aiEnhancement: "active" });
    expect(isStageEnterable(wf, "scenarioReview")).toBe(false);
  });

  it("previousStageId/nextStageId are inverses across the whole order", () => {
    for (let i = 1; i < WORKFLOW_STAGE_ORDER.length; i += 1) {
      expect(previousStageId(WORKFLOW_STAGE_ORDER[i])).toBe(WORKFLOW_STAGE_ORDER[i - 1]);
      expect(nextStageId(WORKFLOW_STAGE_ORDER[i - 1])).toBe(WORKFLOW_STAGE_ORDER[i]);
    }
    expect(previousStageId("upload")).toBeUndefined();
    expect(nextStageId("execution")).toBe("performanceTesting");
    expect(nextStageId("performanceTesting")).toBeUndefined();
  });

  it("performanceTesting is enterable once postmanGeneration is complete, whatever execution's status (AP-029 research D1)", () => {
    for (const execution of ["active", "skipped", "complete", "not-yet-reached"] as const) {
      const wf = workflowWithStatuses({ postmanGeneration: "complete", execution });
      expect(isStageEnterable(wf, "performanceTesting")).toBe(true);
    }
  });

  it("performanceTesting is not enterable while postmanGeneration is not complete", () => {
    for (const postmanGeneration of ["not-yet-reached", "active", "stale"] as const) {
      const wf = workflowWithStatuses({ postmanGeneration, execution: "complete" });
      expect(isStageEnterable(wf, "performanceTesting")).toBe(false);
    }
  });
});
