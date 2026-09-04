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
  it("WORKFLOW_STAGE_ORDER matches spec.md FR-001's nine-stage list", () => {
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
    expect(nextStageId("postmanGeneration")).toBeUndefined();
  });
});
