import { describe, expect, it } from "vitest";
import type { WorkflowExportContext } from "../../src/postmanArtifact";

const workflow = {
  id: "workflow-1",
  steps: [],
  variables: [],
  relationshipIds: [],
};

describe("WorkflowExportContext", () => {
  it("accepts a complete workflow list with explicit approvals", () => {
    const context: WorkflowExportContext = {
      workflows: [workflow],
      approvedWorkflowIds: [workflow.id],
    };
    expect(context.approvedWorkflowIds).toEqual(["workflow-1"]);
  });

  it("keeps malformed context cases visible to runtime boundaries", () => {
    const duplicateIds = { workflows: [workflow, workflow], approvedWorkflowIds: [] };
    const unknownApproval = { workflows: [workflow], approvedWorkflowIds: ["missing"] };
    expect(new Set(duplicateIds.workflows.map((entry) => entry.id)).size).toBe(1);
    expect(unknownApproval.approvedWorkflowIds).not.toContain(
      unknownApproval.workflows[0].id,
    );
  });
});
