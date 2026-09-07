import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCENARIO_CATEGORIES, type InferenceResponse } from "@apipilot/shared-domain";
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
    expect(prompt.responseVersion).toBe(3);
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

    // The baseline is compressed to what stops the model repeating it, not reproduced in full:
    // nested operation -> category -> covered fields (specs/014-ai-batching-policy).
    const coverage = prompt.existingCoverage as Record<string, Record<string, string[]>>;
    expect(typeof coverage).toBe("object");
    for (const byCategory of Object.values(coverage)) {
      for (const fields of Object.values(byCategory)) {
        expect(Array.isArray(fields)).toBe(true);
      }
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

/**
 * specs/014-ai-batching-policy: the prompt's *scope* is what makes its reply usable. Asking a small
 * local model about a whole specification made it echo the request back instead of answering; asking
 * about one operation produced a valid reply for 6 of 6 operations of a real specification
 * (research.md Decisions 1 and 3).
 */
describe("AI scenario prompt scope and worked example (specs/014-ai-batching-policy)", () => {
  // The shared fixture carries only body-bearing operations, so the control case for the
  // conditional-example rule is built here rather than by widening a fixture other tests depend on.
  const withBody = aiScenarioApiModel.operations[0];
  const withoutBody: (typeof aiScenarioApiModel.operations)[number] = {
    path: "/accounts/{accountId}",
    method: "GET",
    operationId: "getAccount",
    parameters: [
      {
        name: "accountId",
        location: "path",
        required: true,
        schema: { required: [], properties: {}, type: "string" },
      },
    ],
    requestBody: undefined,
    responses: [
      { statusCode: "200", description: "Account", contentTypes: {}, examples: {} },
      { statusCode: "404", description: "Not Found", contentTypes: {}, examples: {} },
    ],
    security: [],
    tags: ["accounts"],
  };

  const baselineForBodyless = {
    scenarios: [
      {
        ...aiScenarioBaseline.scenarios[0],
        operationPath: withoutBody.path,
        operationMethod: withoutBody.method,
      },
    ],
  };

  function promptFor(
    operations: typeof aiScenarioApiModel.operations,
    baseline: typeof aiScenarioBaseline = aiScenarioBaseline,
  ) {
    return JSON.parse(
      buildAIScenarioPrompt({ ...aiScenarioApiModel, operations }, baseline),
    ) as Record<string, unknown>;
  }

  it("declares response version 3, since request scope changed even though structure did not (XXIII)", () => {
    expect(promptFor(aiScenarioApiModel.operations).responseVersion).toBe(3);
  });

  it("carries exactly the operations it was given, so a single-operation unit asks about one operation", () => {
    const prompt = promptFor([withoutBody]);
    expect(prompt.operations).toHaveLength(1);
    expect((prompt.operations as Record<string, unknown>[])[0].path).toBe(withoutBody.path);
  });

  it("scopes existingCoverage to the operations in the unit, so a unit is never told about coverage it cannot see", () => {
    const mixedBaseline = {
      scenarios: [...aiScenarioBaseline.scenarios, ...baselineForBodyless.scenarios],
    };

    const prompt = promptFor([withoutBody], mixedBaseline);

    const coverage = prompt.existingCoverage as Record<string, Record<string, string[]>>;
    const operationKeys = Object.keys(coverage);
    expect(operationKeys.length).toBeGreaterThan(0);
    expect(operationKeys.every((key) => key.includes(withoutBody.path))).toBe(true);
  });

  it("requests candidates per operation, so the total requested grows with specification size (FR-003)", () => {
    const threeOperations = [
      withoutBody,
      { ...withoutBody, path: "/accounts/{accountId}/limits", operationId: "getLimits" },
      { ...withoutBody, path: "/accounts/{accountId}/owner", operationId: "getOwner" },
    ];

    const single = promptFor([withoutBody], baselineForBodyless).task as string;
    const many = promptFor(threeOperations, baselineForBodyless).task as string;

    const ceilingOf = (task: string) => Number(/at most (\d+)/.exec(task)?.[1]);
    expect(ceilingOf(single)).toBeGreaterThan(0);
    // Three operations must request more than one does — the previous per-request ceiling meant a
    // 200-operation specification could yield at most six AI scenarios in total.
    expect(ceilingOf(many)).toBe(ceilingOf(single) * 3);
  });

  it("addresses a single-operation unit in the singular, so the ask reads as one operation", () => {
    const single = promptFor([withoutBody], baselineForBodyless).task as string;
    expect(single).toContain("the operation below");
  });

  it("includes the worked example for an operation carrying a request body", () => {
    expect(promptFor([withBody]).example).toBeDefined();
  });

  /**
   * The example is attached unconditionally. The conditional rule this replaces assumed it was
   * redundant for body-less operations; the first real-model run disproved that — without it the
   * model invented flat request shapes (`{"limit":5,"page":1}`) on exactly those operations and every
   * such candidate was rejected. It also now replaces the prose output specification it used to sit
   * beside, so attaching it always is cheaper than the alternative it removes
   * (specs/014-ai-batching-policy research.md Decision 3).
   */
  it("includes the worked example for an operation with no request body, which needs the request shape demonstrated too", () => {
    expect(promptFor([withoutBody], baselineForBodyless).example).toBeDefined();
  });

  it("demonstrates a supported category and the keyed request shape in the example", () => {
    const example = promptFor([withBody]).example as {
      candidates: { category: string; request: Record<string, unknown> }[];
    };
    const candidate = example.candidates[0];
    // An invented category is rejected outright, so the example must not teach one.
    expect(SCENARIO_CATEGORIES).toContain(candidate.category);
    expect(candidate.request).toHaveProperty("pathParameters");
    expect(candidate.request).toHaveProperty("queryParameters");
    expect(candidate.request).toHaveProperty("headers");
  });

  it("states the closed category vocabulary, so the model cannot invent one", () => {
    expect(promptFor([withoutBody], baselineForBodyless).categories).toEqual([
      ...SCENARIO_CATEGORIES,
    ]);
  });

  it("keeps the example a pure function of the operation, so unit derivation stays reproducible (SC-008)", () => {
    const first = buildAIScenarioPrompt({ ...aiScenarioApiModel, operations: [withBody] }, aiScenarioBaseline);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        buildAIScenarioPrompt({ ...aiScenarioApiModel, operations: [withBody] }, aiScenarioBaseline),
      ).toBe(first);
    }
  });

  it("sizes the output allowance to a single unit's reply (research.md Decision 2)", () => {
    // 192 truncated the largest-body operation; 256 gave 6 of 6. A larger allowance costs nothing on
    // easy operations because generation stops when the document closes.
    expect(AI_SCENARIO_MAX_OUTPUT_TOKENS).toBe(256);
  });
});
