import { beforeEach, describe, expect, it } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import { continueApiReview } from "../../../src/testGenerationWorkflow/apiReviewStage";
import {
  StageNotActiveError,
  UnknownOperationKeyError,
} from "../../../src/testGenerationWorkflow/errors";
import {
  getCurrentWorkflow,
  resetStore,
  startWorkflow,
  updateStage,
} from "../../../src/testGenerationWorkflow/workflowStore";

const apiModel: ApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

const twoOperationApiModel: ApiModel = {
  ...apiModel,
  operations: ["/a", "/b"].map((path) => ({
    path,
    method: "get",
    operationId: undefined,
    parameters: [],
    requestBody: undefined,
    responses: [],
    security: [],
    tags: [],
  })),
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

  it("records no selection when continued without one, keeping every operation in scope", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel: twoOperationApiModel });
    expect(continueApiReview([]).selectedOperationKeys).toBeUndefined();
  });

  it("records the chosen operations", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel: twoOperationApiModel });
    expect(continueApiReview(["GET /b"]).selectedOperationKeys).toEqual(["GET /b"]);
  });

  it("refuses an unknown operation key without completing the stage", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel: twoOperationApiModel });
    expect(() => continueApiReview(["GET /missing"])).toThrow(UnknownOperationKeyError);
    const wf = getCurrentWorkflow()!;
    expect(wf.stages.apiReview.status).toBe("active");
    expect(wf.selectedOperationKeys).toBeUndefined();
  });
});
