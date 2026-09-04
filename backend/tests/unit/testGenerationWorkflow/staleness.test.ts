import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGE_ORDER, type StageStatus, type TestGenerationWorkflow } from "@apipilot/shared-domain";
import { computeDownstreamStaleness } from "../../../src/testGenerationWorkflow/staleness";

function workflowWithStatuses(statuses: Partial<Record<string, StageStatus>>): TestGenerationWorkflow {
  const stages = Object.fromEntries(
    WORKFLOW_STAGE_ORDER.map((stageId) => [stageId, { stageId, status: statuses[stageId] ?? "not-yet-reached" }]),
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

describe("computeDownstreamStaleness", () => {
  it("returns every complete stage after the revised one", () => {
    const workflow = workflowWithStatuses({
      scenarioReview: "complete",
      dependencyAnalysis: "complete",
      workflowReview: "complete",
      postmanGeneration: "complete",
    });
    expect(computeDownstreamStaleness(workflow, "scenarioReview")).toEqual([
      "dependencyAnalysis",
      "workflowReview",
      "postmanGeneration",
    ]);
  });

  it("never returns a stage at or before the revised one", () => {
    const workflow = workflowWithStatuses({
      upload: "complete",
      analysis: "complete",
      apiReview: "complete",
      workflowReview: "complete",
    });
    const result = computeDownstreamStaleness(workflow, "workflowReview");
    expect(result).not.toContain("upload");
    expect(result).not.toContain("workflowReview");
    expect(result).toEqual([]);
  });

  it("skips a downstream stage that is not complete (e.g. still not-yet-reached)", () => {
    const workflow = workflowWithStatuses({ scenarioReview: "complete", postmanGeneration: "complete" });
    // dependencyAnalysis/workflowReview are not-yet-reached here — an unusual but possible state.
    expect(computeDownstreamStaleness(workflow, "scenarioReview")).toEqual(["postmanGeneration"]);
  });

  it("is independent of how the complete statuses were set (order-independent by construction)", () => {
    const a = workflowWithStatuses({ workflowReview: "complete", postmanGeneration: "complete" });
    const b = workflowWithStatuses({ postmanGeneration: "complete", workflowReview: "complete" });
    expect(computeDownstreamStaleness(a, "scenarioReview")).toEqual(
      computeDownstreamStaleness(b, "scenarioReview"),
    );
  });
});
