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
    expect(prompt.responseVersion).toBe(5);
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
      expect(operation.operationId).toBe(
        aiScenarioApiModel.operations[index].operationId,
      );
      expect(operation.requestBody).toEqual({
        contentType: "application/json",
        required: true,
        fields: [
          { name: "email", required: true, type: "string", format: "email" },
          { name: "displayName", type: "string" },
        ],
      });
      expect(operation.documentedResponses).toEqual(["201", "409"]);
      // ...while prose and presentation material, which cost tokens without constraining a
      // scenario, are not.
      expect(operation.description).toBeUndefined();
      expect(operation.tags).toBeUndefined();
      expect(operation.security).toBeUndefined();
      expect(operation.examples).toBeUndefined();
      expect(operation.servers).toBeUndefined();
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
    expect(
      projected * 5,
      `realized reduction factor: ${(serialized / projected).toFixed(2)}x`,
    ).toBeLessThan(serialized);
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

  it("declares response version 5, since the instructions changed for operations with no inputs (XXIII)", () => {
    expect(promptFor(aiScenarioApiModel.operations).responseVersion).toBe(5);
  });

  it("carries exactly the operations it was given, so a single-operation unit asks about one operation", () => {
    const prompt = promptFor([withoutBody]);
    expect(prompt.operations).toHaveLength(1);
    expect((prompt.operations as Record<string, unknown>[])[0].path).toBe(
      withoutBody.path,
    );
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

    const ceilingOf = (task: string) => Number(/exactly (\d+)/.exec(task)?.[1]);
    expect(ceilingOf(single)).toBeGreaterThan(0);
    expect(ceilingOf(single)).toBe(1);
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
    const first = buildAIScenarioPrompt(
      { ...aiScenarioApiModel, operations: [withBody] },
      aiScenarioBaseline,
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        buildAIScenarioPrompt(
          { ...aiScenarioApiModel, operations: [withBody] },
          aiScenarioBaseline,
        ),
      ).toBe(first);
    }
  });

  it("sizes the output allowance to a single unit's reply (research.md Decision 2)", () => {
    // The measured body-heavy unit truncates at 192 tokens but completes at 256.
    expect(AI_SCENARIO_MAX_OUTPUT_TOKENS).toBe(256);
  });
});

/**
 * Version 4 (specs/013-ai-enhancement-viability T072). Measured against the default and a stronger
 * local model, the version 3 prompt let both answer `[]`, and a model forced to answer copied the
 * worked example's `400` even where the operation does not document it, and invented targets. The
 * changes below address those observed failures; none changes what is validated.
 */
describe("AI scenario prompt version 4 (specs/013 T072)", () => {
  const operation = (
    overrides: Partial<(typeof aiScenarioApiModel.operations)[number]>,
  ): (typeof aiScenarioApiModel.operations)[number] => ({
    path: "/orders/{orderId}",
    method: "GET",
    operationId: "getOrder",
    parameters: [
      { name: "orderId", location: "path", required: true, schema: { type: "string", required: [], properties: {} } },
      { name: "expand", location: "query", required: false, schema: { type: "string", required: [], properties: {} } },
      { name: "X-Trace", location: "header", required: false, schema: { type: "string", required: [], properties: {} } },
    ],
    requestBody: undefined,
    responses: [
      { statusCode: "200", description: "ok", contentTypes: {}, examples: {} },
      { statusCode: "404", description: "none", contentTypes: {}, examples: {} },
    ],
    security: [],
    tags: [],
    ...overrides,
  });
  const promptOf = (operations: (typeof aiScenarioApiModel.operations)[number][]) =>
    JSON.parse(
      buildAIScenarioPrompt({ ...aiScenarioApiModel, operations }, { scenarios: [] }),
    ) as {
      task: string;
      allowedTargets: { targetLocation: string; targetField: string }[];
      allowedStatusCodes?: string[];
      example: { candidates: { assertions: { expectedStatusCode?: string }[] }[] };
    };

  it("asks for exactly one candidate per operation and says an empty list is not an answer", () => {
    const prompt = promptOf([operation({}), operation({ path: "/orders", operationId: "list" })]);
    expect(prompt.task).toContain("exactly 2");
    expect(prompt.task).toMatch(/never return an empty list/i);
  });

  it("lists the allowed targets: every parameter by location and every body field, in declaration order", () => {
    const withBody = aiScenarioApiModel.operations[0];
    expect(promptOf([operation({})]).allowedTargets).toEqual([
      { targetLocation: "path", targetField: "orderId" },
      { targetLocation: "query", targetField: "expand" },
      { targetLocation: "header", targetField: "X-Trace" },
    ]);
    expect(promptOf([withBody]).allowedTargets).toEqual([
      { targetLocation: "body", targetField: "email" },
      { targetLocation: "body", targetField: "displayName" },
    ]);
  });

  it("lists the documented status codes of the operations in the request, once each in first-seen order", () => {
    const other = operation({
      path: "/orders",
      operationId: "list",
      responses: [
        { statusCode: "200", description: "ok", contentTypes: {}, examples: {} },
        { statusCode: "400", description: "bad", contentTypes: {}, examples: {} },
      ],
    });
    const prompt = promptOf([operation({}), other]);
    expect(prompt.allowedStatusCodes).toEqual(["200", "404", "400"]);
    expect(prompt.task).toMatch(/expectedStatusCode must be one of allowedStatusCodes/);
  });

  it("places the status-code instruction last in the task and the list last in the prompt, where measured to work", () => {
    const prompt = promptOf([operation({})]);
    expect(prompt.task.endsWith("expectedStatusCode must be one of allowedStatusCodes.")).toBe(true);
    expect(Object.keys(prompt).at(-1)).toBe("allowedStatusCodes");
  });

  it("omits the status-code list, and the instruction about it, for an operation documenting no response", () => {
    const prompt = promptOf([operation({ responses: [] })]);
    expect(prompt.allowedStatusCodes).toBeUndefined();
    expect(prompt.task).not.toMatch(/allowedStatusCodes/);
  });

  describe("an operation with no parameters and no request body (specs/013 T071 follow-up)", () => {
    // Measured: with an empty `allowedTargets` and an instruction to pick a pair from it, the model had
    // nothing it was permitted to aim at and answered `{"candidates":[]}` for every such operation.
    const bare = () => operation({ parameters: [], requestBody: undefined });
    const promptOfBare = () =>
      JSON.parse(
        buildAIScenarioPrompt({ ...aiScenarioApiModel, operations: [bare()] }, { scenarios: [] }),
      ) as Record<string, unknown> & { task: string };

    it("sends no allowedTargets list rather than an empty one", () => {
      expect(promptOfBare().allowedTargets).toBeUndefined();
      expect("allowedTargets" in promptOfBare()).toBe(false);
    });

    it("shows an example that has no target either, so there is no path parameter to copy", () => {
      const example = (promptOfBare() as unknown as {
        example: { candidates: Record<string, unknown>[] };
      }).example.candidates[0];
      expect(example).not.toHaveProperty("targetLocation");
      expect(example).not.toHaveProperty("targetField");
      expect(example.request).toEqual({ pathParameters: {}, queryParameters: {}, headers: {} });
      // The operation's own path and method, so copying the example cannot name another operation.
      expect(example.operationPath).toBe(bare().path);
      expect(example.operationMethod).toBe(bare().method.toUpperCase());
      // Still a supported category, and never a status code the operation does not document.
      expect(SCENARIO_CATEGORIES).toContain(example.category as string);
      expect((example.assertions as { expectedStatusCode: string }[]).map((a) => a.expectedStatusCode)).toEqual(["404"]);
    });

    it("keeps the targeted example for an operation that has targets", () => {
      const example = promptOf([operation({})]).example.candidates[0] as unknown as Record<string, unknown>;
      expect(example.targetLocation).toBe("path");
      expect(example.targetField).toBe("itemId");
    });

    it("tells the model to leave out the target instead of choosing one from nothing", () => {
      const { task } = promptOfBare();
      expect(task).toMatch(/no parameters or request body/i);
      expect(task).toMatch(/leave out targetLocation and targetField/i);
      expect(task).not.toMatch(/must be one pair from allowedTargets/);
    });

    it("still asks for exactly one candidate and still ends with the status-code instruction", () => {
      const { task } = promptOfBare();
      expect(task).toContain("exactly 1");
      expect(task.endsWith("expectedStatusCode must be one of allowedStatusCodes.")).toBe(true);
    });

    it("leaves the prompt of an operation that has targets as it was", () => {
      const withTargets = promptOf([operation({})]);
      expect(withTargets.allowedTargets.length).toBeGreaterThan(0);
      expect(withTargets.task).toMatch(/must be one pair from allowedTargets/);
      expect(withTargets.task).not.toMatch(/leave out targetLocation/i);
    });

    it("treats a request as target-less only when none of its operations has a target", () => {
      const mixed = promptOf([bare(), operation({})]);
      expect(mixed.allowedTargets.length).toBeGreaterThan(0);
      expect(mixed.task).toMatch(/must be one pair from allowedTargets/);
    });
  });

  describe("purpose: enhance or replace (specs/013 T071 follow-up)", () => {
    const taskFor = (purpose?: "enhance" | "replace") =>
      (
        JSON.parse(
          buildAIScenarioPrompt(
            { ...aiScenarioApiModel, operations: [operation({})] },
            { scenarios: [] },
            purpose,
          ),
        ) as { task: string }
      ).task;

    it("defaults to enhancement, unchanged", () => {
      expect(taskFor()).toBe(taskFor("enhance"));
      expect(taskFor()).toMatch(/^Suggest exactly 1 more test scenario/);
      expect(taskFor()).toMatch(/Prefer something existingCoverage does not already cover/);
    });

    it("asks for a replacement that differs from the scenario shown, when replacing", () => {
      expect(taskFor("replace")).toMatch(/^Write exactly 1 replacement test scenario/);
      expect(taskFor("replace")).toMatch(/different scenario from the one in existingCoverage/);
      expect(taskFor("replace")).not.toMatch(/more test scenario/);
    });

    it("keeps the rest of the contract the same for both purposes", () => {
      for (const purpose of ["enhance", "replace"] as const) {
        const task = taskFor(purpose);
        expect(task).toMatch(/never return an empty list/i);
        expect(task).toMatch(/must be one pair from allowedTargets/);
        expect(task.endsWith("expectedStatusCode must be one of allowedStatusCodes.")).toBe(true);
      }
    });

    it("changes only the task: operations, targets and example are identical", () => {
      const build = (purpose: "enhance" | "replace") =>
        JSON.parse(
          buildAIScenarioPrompt(
            { ...aiScenarioApiModel, operations: [operation({})] },
            { scenarios: [] },
            purpose,
          ),
        ) as Record<string, unknown>;
      const withoutTask = (prompt: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(prompt).filter(([key]) => key !== "task"));
      expect(withoutTask(build("replace"))).toEqual(withoutTask(build("enhance")));
    });
  });

  it("tells the model to choose its target from that list", () => {
    expect(promptOf([operation({})]).task).toMatch(/allowedTargets/);
  });

  it("makes the example's status code one the operation documents, preferring a client error", () => {
    expect(promptOf([operation({})]).example.candidates[0].assertions).toEqual([
      { type: "status-code", expectedStatusCode: "404" },
    ]);
    expect(
      promptOf([
        operation({
          responses: [
            { statusCode: "201", description: "c", contentTypes: {}, examples: {} },
            { statusCode: "409", description: "x", contentTypes: {}, examples: {} },
          ],
        }),
      ]).example.candidates[0].assertions,
    ).toEqual([{ type: "status-code", expectedStatusCode: "409" }]);
  });

  it("falls back to the first documented code when none is a client error, and to no assertion when none is documented", () => {
    const only200 = operation({
      responses: [{ statusCode: "200", description: "ok", contentTypes: {}, examples: {} }],
    });
    expect(promptOf([only200]).example.candidates[0].assertions).toEqual([
      { type: "status-code", expectedStatusCode: "200" },
    ]);
    expect(promptOf([operation({ responses: [] })]).example.candidates[0].assertions).toEqual([]);
  });

  it("never teaches a status code the operation does not document", () => {
    const prompt = promptOf([operation({})]);
    const documented = ["200", "404"];
    for (const assertion of prompt.example.candidates[0].assertions) {
      expect(documented).toContain(assertion.expectedStatusCode);
    }
  });

  it("stays deterministic across repeated builds", () => {
    expect(promptOf([operation({})])).toEqual(promptOf([operation({})]));
  });
});
