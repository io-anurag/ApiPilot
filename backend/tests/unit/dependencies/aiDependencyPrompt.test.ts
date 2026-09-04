import { describe, expect, it } from "vitest";
import {
  AI_DEPENDENCY_TIMEOUT_MS,
  buildAIDependencyRequest,
} from "../../../src/dependencies/aiDependencyPrompt";
import { crudChainApiModel } from "../../fixtures/dependencies/dependencyFixtures";

describe("buildAIDependencyRequest", () => {
  it("builds exactly one InferenceRequest matching the AIProvider contract", () => {
    const request = buildAIDependencyRequest("dep-1", crudChainApiModel);
    expect(request.contractVersion).toBe(1);
    expect(request.requestId).toBe("dep-1");
    expect(request.expectedOutputFormat).toBe("json");
    expect(typeof request.input).toBe("string");
  });

  it("sets a feature-specific timeout override rather than leaving it unset", () => {
    const request = buildAIDependencyRequest("dep-1", crudChainApiModel);
    expect(request.timeoutMs).toBe(AI_DEPENDENCY_TIMEOUT_MS);
    expect(AI_DEPENDENCY_TIMEOUT_MS).toBe(8000);
  });

  it("embeds the ApiModel in the prompt content", () => {
    const request = buildAIDependencyRequest("dep-1", crudChainApiModel);
    const parsed = JSON.parse(request.input);
    expect(parsed.apiModel.operations).toHaveLength(crudChainApiModel.operations.length);
  });
});
