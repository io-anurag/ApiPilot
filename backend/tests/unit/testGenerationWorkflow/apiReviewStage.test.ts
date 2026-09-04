import { beforeEach, describe, expect, it } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import { continueApiReview } from "../../../src/testGenerationWorkflow/apiReviewStage";
import { StageNotActiveError } from "../../../src/testGenerationWorkflow/errors";
import { resetStore, startWorkflow, updateStage } from "../../../src/testGenerationWorkflow/workflowStore";

const apiModel: ApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

describe("apiReviewStage", () => {
  beforeEach(() => resetStore());

  it("refuses to continue while apiReview is not active", () => {
    expect(() => continueApiReview()).toThrow(StageNotActiveError);
  });

  it("completes apiReview and advances to deterministicGeneration when active", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    const wf = continueApiReview();
    expect(wf.stages.apiReview.status).toBe("complete");
    expect(wf.activeStageId).toBe("deterministicGeneration");
    expect(wf.stages.deterministicGeneration.status).toBe("active");
  });

  it("refuses a second continue once apiReview is already complete", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    continueApiReview();
    expect(() => continueApiReview()).toThrow(StageNotActiveError);
  });

  it("refuses while apiReview is stale (not active)", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    continueApiReview();
    updateStage("apiReview", "stale");
    expect(() => continueApiReview()).toThrow(StageNotActiveError);
  });
});
