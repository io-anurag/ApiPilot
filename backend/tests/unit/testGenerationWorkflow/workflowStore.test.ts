import { beforeEach, describe, expect, it } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import {
  InvalidStageTransitionError,
  getCurrentWorkflow,
  patchWorkflow,
  resetStore,
  startWorkflow,
  updateStage,
} from "../../../src/testGenerationWorkflow/workflowStore";

const apiModel: ApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

describe("workflowStore", () => {
  beforeEach(() => resetStore());

  it("returns undefined when nothing has started", () => {
    expect(getCurrentWorkflow()).toBeUndefined();
  });

  it("startWorkflow seeds apiReview active and every later stage not-yet-reached", () => {
    const wf = startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    expect(wf.activeStageId).toBe("apiReview");
    expect(wf.stages.upload.status).toBe("complete");
    expect(wf.stages.analysis.status).toBe("complete");
    expect(wf.stages.apiReview.status).toBe("active");
    expect(wf.stages.deterministicGeneration.status).toBe("not-yet-reached");
    expect(wf.stages.postmanGeneration.status).toBe("not-yet-reached");
    expect(getCurrentWorkflow()).toEqual(wf);
  });

  it("startWorkflow replaces a prior in-progress workflow", () => {
    const first = startWorkflow({ specificationFilename: "a.yaml", apiModel });
    const second = startWorkflow({ specificationFilename: "b.yaml", apiModel });
    expect(getCurrentWorkflow()?.id).toBe(second.id);
    expect(second.id).not.toBe(first.id);
  });

  it("updateStage allows not-yet-reached -> active -> complete", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    updateStage("deterministicGeneration", "active");
    const wf = updateStage("deterministicGeneration", "complete");
    expect(wf.stages.deterministicGeneration.status).toBe("complete");
    expect(wf.stages.deterministicGeneration.completedAt).toBeDefined();
  });

  it("updateStage rejects an invalid transition", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    expect(() => updateStage("postmanGeneration", "complete")).toThrow(InvalidStageTransitionError);
  });

  it("updateStage allows active -> skipped only for aiEnhancement", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    updateStage("aiEnhancement", "active");
    const wf = updateStage("aiEnhancement", "skipped", {
      aiErrorCategory: "PROVIDER_UNAVAILABLE",
      aiErrorMessage: "not ready",
    });
    expect(wf.stages.aiEnhancement.status).toBe("skipped");
    expect(wf.stages.aiEnhancement.aiErrorCategory).toBe("PROVIDER_UNAVAILABLE");

    updateStage("deterministicGeneration", "active");
    expect(() => updateStage("deterministicGeneration", "skipped")).toThrow(InvalidStageTransitionError);
  });

  it("updateStage allows skipped -> active for aiEnhancement retry (FR-008a)", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    updateStage("aiEnhancement", "active");
    updateStage("aiEnhancement", "skipped");
    const wf = updateStage("aiEnhancement", "active");
    expect(wf.stages.aiEnhancement.status).toBe("active");
    expect(wf.stages.aiEnhancement.aiErrorCategory).toBeUndefined();
  });

  it("updateStage allows complete -> stale and stale -> active (staleness cascade)", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    updateStage("deterministicGeneration", "active");
    updateStage("deterministicGeneration", "complete");
    const stale = updateStage("deterministicGeneration", "stale");
    expect(stale.stages.deterministicGeneration.status).toBe("stale");
    const active = updateStage("deterministicGeneration", "active");
    expect(active.stages.deterministicGeneration.status).toBe("active");
  });

  it("patchWorkflow merges arbitrary fields and bumps updatedAt", async () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    const before = getCurrentWorkflow()!.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 2));
    const wf = patchWorkflow({ activeStageId: "deterministicGeneration" });
    expect(wf.activeStageId).toBe("deterministicGeneration");
    expect(wf.updatedAt).not.toBe(before);
  });

  it("a second caller sees the exact same state after mutations (resume, FR-014/FR-018)", () => {
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    updateStage("apiReview", "complete");
    updateStage("deterministicGeneration", "active");
    const firstCallerView = getCurrentWorkflow();
    const secondCallerView = getCurrentWorkflow();
    expect(secondCallerView).toEqual(firstCallerView);
    expect(secondCallerView?.stages.deterministicGeneration.status).toBe("active");
  });

  it("updateStage/patchWorkflow throw when no workflow is in progress", () => {
    expect(() => updateStage("apiReview", "active")).toThrow();
    expect(() => patchWorkflow({})).toThrow();
  });
});
