import { describe, expect, it } from "vitest";
import {
  AI_DEPENDENCY_MAX_OUTPUT_TOKENS,
  AI_DEPENDENCY_RESPONSE_VERSION,
  AI_DEPENDENCY_TIMEOUT_MS,
  buildAIDependencyPrompt,
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

  /**
   * 45s, not the original 8s: that figure predated the prompt projection and was never actually
   * achievable on the reference hardware — even a single-operation unit's prefill alone measures
   * ~9.9s at this codebase's own previously-measured throughput rate (specs/014-ai-batching-policy
   * research.md Decision 7 addendum).
   */
  it("sets a feature-specific timeout override large enough for a real request to actually complete", () => {
    const request = buildAIDependencyRequest("dep-1", crudChainApiModel);
    expect(request.timeoutMs).toBe(AI_DEPENDENCY_TIMEOUT_MS);
    expect(AI_DEPENDENCY_TIMEOUT_MS).toBe(45_000);
  });

  it("sets an explicit, capped output allowance rather than the generic default", () => {
    const request = buildAIDependencyRequest("dep-1", crudChainApiModel);
    expect(request.maxOutputTokens).toBe(AI_DEPENDENCY_MAX_OUTPUT_TOKENS);
    expect(AI_DEPENDENCY_MAX_OUTPUT_TOKENS).toBe(128);
  });
});

/**
 * specs/014-ai-batching-policy research.md Decision 6 / T046: the prompt must be a contract
 * projection rather than the raw `ApiModel` — measured at 4,705 characters per operation before
 * this change, versus 837-1,209 for a comparable one-operation enhancement prompt.
 */
describe("buildAIDependencyPrompt (contract projection)", () => {
  it("declares the current response version rather than the pre-projection version 1", () => {
    const parsed = JSON.parse(buildAIDependencyPrompt(crudChainApiModel));
    expect(parsed.responseVersion).toBe(AI_DEPENDENCY_RESPONSE_VERSION);
    expect(AI_DEPENDENCY_RESPONSE_VERSION).toBe(2);
  });

  it("no longer serializes the raw ApiModel", () => {
    const prompt = buildAIDependencyPrompt(crudChainApiModel);
    const parsed = JSON.parse(prompt);
    expect(parsed.apiModel).toBeUndefined();
    expect(Array.isArray(parsed.operations)).toBe(true);
    expect(parsed.operations).toHaveLength(crudChainApiModel.operations.length);
  });

  it("retains operation identity and response-field identity/type for a producer operation", () => {
    const parsed = JSON.parse(buildAIDependencyPrompt(crudChainApiModel));
    const createUser = parsed.operations.find((op: { operationId?: string }) => op.operationId === "createUser");
    expect(createUser).toMatchObject({ path: "/users", method: "POST", operationId: "createUser" });
    expect(createUser.responseFields).toEqual(
      expect.arrayContaining([{ field: "id", type: "string" }]),
    );
  });

  it("retains request-field identity, location, and type for a consumer operation", () => {
    const parsed = JSON.parse(buildAIDependencyPrompt(crudChainApiModel));
    const getUser = parsed.operations.find((op: { operationId?: string }) => op.operationId === "getUser");
    expect(getUser.requestFields).toEqual(
      expect.arrayContaining([{ field: "userId", in: "path", type: "string" }]),
    );
  });

  it("omits descriptions, examples, and tags, which the model does not need to infer a relationship", () => {
    const prompt = buildAIDependencyPrompt(crudChainApiModel);
    expect(prompt).not.toContain('"tags"');
    expect(prompt).not.toContain('"examples"');
    expect(prompt).not.toContain('"description"');
  });
});
