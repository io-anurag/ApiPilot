import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import { runDeterministicGeneration } from "../../../src/testGenerationWorkflow/deterministicGenerationStage";
import { StageNotActiveError } from "../../../src/testGenerationWorkflow/errors";
import { resetStore, startWorkflow } from "../../../src/testGenerationWorkflow/workflowStore";
import { continueApiReview } from "../../../src/testGenerationWorkflow/apiReviewStage";

async function validApiModel() {
  const content = readFileSync(
    path.join(__dirname, "..", "..", "fixtures", "openapi", "valid.yaml"),
    "utf-8",
  );
  const { document, issues } = await validateSpec(parseYaml(content));
  return buildApiModel(document, issues);
}

describe("deterministicGenerationStage", () => {
  beforeEach(() => resetStore());

  it("refuses to run while not the active stage", () => {
    expect(() => runDeterministicGeneration()).toThrow(StageNotActiveError);
  });

  it("wraps generateTestModel unchanged, stores the result, and advances to aiEnhancement", async () => {
    const apiModel = await validApiModel();
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    continueApiReview();
    const wf = runDeterministicGeneration();
    expect(wf.stages.deterministicGeneration.status).toBe("complete");
    expect(wf.deterministicTestModel?.scenarios.length).toBeGreaterThan(0);
    expect(wf.activeStageId).toBe("aiEnhancement");
    expect(wf.stages.aiEnhancement.status).toBe("active");
  });
});
