import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { InferenceResponse } from "@apipilot/shared-domain";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import {
  aiScenarioApiModel,
  aiScenarioBaseline,
} from "../../fixtures/testDesign/aiScenarioDesignerFixtures";
import {
  AI_SCENARIO_MAX_OUTPUT_TOKENS,
  buildAIScenarioPrompt,
  buildAIScenarioRequest,
} from "../../../src/testDesign/aiScenarioPrompt";
import { parseAIScenarioResponse } from "../../../src/testDesign/parseAIScenarioResponse";

describe("AI scenario prompt and response contract", () => {
  it("constructs a versioned JSON request from normalized models", () => {
    const request = buildAIScenarioRequest(
      "request-1",
      aiScenarioApiModel,
      aiScenarioBaseline,
    );
    const prompt = JSON.parse(request.input) as Record<string, unknown>;

    expect(request.expectedOutputFormat).toBe("json");
    // Sized against measured throughput rather than against "big enough not to truncate": at the
    // ~2 tokens/second the previous configuration achieved, the old 1024-token bound needed ~34
    // minutes against a 5-minute timeout, so the stage could never complete
    // (specs/013-ai-enhancement-viability FR-011).
    expect(request.maxOutputTokens).toBe(AI_SCENARIO_MAX_OUTPUT_TOKENS);
    expect(prompt.responseVersion).toBe(2);
  });

  it("sends an operation-contract projection, not the serialized models (FR-009)", () => {
    const request = buildAIScenarioRequest(
      "request-1",
      aiScenarioApiModel,
      aiScenarioBaseline,
    );
    const prompt = JSON.parse(request.input) as Record<string, unknown>;

    // The models themselves are no longer embedded: the previous prompt serialized the whole
    // dereferenced ApiModel and every deterministic scenario, measured at 22,095 characters for a
    // three-operation specification, of which prompt processing alone cost ~94 seconds.
    expect(prompt.apiModel).toBeUndefined();
    expect(prompt.deterministicTestModel).toBeUndefined();

    const operations = prompt.operations as Record<string, unknown>[];
    expect(operations).toHaveLength(aiScenarioApiModel.operations.length);
    for (const [index, operation] of operations.entries()) {
      // Contract facts the model needs to stay grounded are still present...
      expect(operation.path).toBe(aiScenarioApiModel.operations[index].path);
      expect(operation.method).toBe(
        aiScenarioApiModel.operations[index].method.toUpperCase(),
      );
      // ...while prose and presentation material, which cost tokens without constraining a
      // scenario, are not.
      expect(operation.description).toBeUndefined();
      expect(operation.tags).toBeUndefined();
      expect(operation.security).toBeUndefined();
    }

    // The baseline is compressed to what stops the model repeating it, not reproduced in full.
    const coverage = prompt.existingCoverage as string[];
    expect(Array.isArray(coverage)).toBe(true);
    for (const entry of coverage) {
      expect(typeof entry).toBe("string");
    }
  });

  it("produces a materially smaller prompt than the serialized models it replaces (FR-009)", async () => {
    // Measured against the real Pet Store specification rather than the small hand-built fixture
    // above: the cost this feature removes is dereferenced schemas and full scenario objects,
    // which a synthetic three-field model barely contains. On the real fixture the previous
    // prompt measured 22,095 characters / 5,845 tokens, of which prompt processing alone cost
    // ~94 seconds — the single largest contributor to the stage being unable to finish.
    const content = readFileSync(
      path.join(__dirname, "..", "..", "fixtures", "openapi", "valid.yaml"),
      "utf-8",
    );
    const { document, issues } = await validateSpec(parseYaml(content));
    const apiModel = buildApiModel(document, issues);
    const testModel = generateTestModel(apiModel);

    const projected = buildAIScenarioPrompt(apiModel, testModel).length;
    // What the previous implementation would have sent for the same input.
    const serialized = JSON.stringify({
      apiModel,
      deterministicTestModel: testModel,
    }).length;

    // Measured at 11x (21,802 -> 1,985 characters) when this was written. Asserting 5x leaves
    // room for fixture growth while still failing loudly if the projection regresses toward
    // embedding the models again.
    expect(projected * 5).toBeLessThan(serialized);
  });

  it("parses only the supported structured response shape", () => {
    const response: InferenceResponse = {
      contractVersion: 1,
      requestId: "request-1",
      status: "success",
      content: JSON.stringify({ responseVersion: 1, candidates: [] }),
      modelId: "model-1",
      provider: "mock",
      durationMs: 0,
    };

    expect(parseAIScenarioResponse(response)).toEqual({
      responseVersion: 1,
      candidates: [],
    });
  });

  it("does not include raw provider content in malformed-response errors", () => {
    const response: InferenceResponse = {
      contractVersion: 1,
      requestId: "request-1",
      status: "success",
      content: "not-json-with-sensitive-content",
      modelId: "model-1",
      provider: "mock",
      durationMs: 0,
    };

    expect(() => parseAIScenarioResponse(response)).toThrow("valid JSON");
    expect(() => parseAIScenarioResponse(response)).not.toThrow("sensitive-content");
  });
});
