import { describe, expect, it } from "vitest";
import { aiScenarioApiModel } from "../../fixtures/testDesign/aiScenarioDesignerFixtures";
import {
  validateAICandidateSemantics,
  validateAICandidateShape,
} from "../../../src/testDesign/validateAICandidate";
import { buildAIScenarioPrompt } from "../../../src/testDesign/aiScenarioPrompt";

const candidate = {
  candidateId: "candidate-1",
  operationPath: "/accounts",
  operationMethod: "POST",
  category: "invalid-format" as const,
  targetLocation: "body" as const,
  targetField: "email",
  request: {
    pathParameters: {},
    queryParameters: {},
    headers: {},
    body: { email: "bad" },
  },
  assertions: [{ type: "status-code" as const, expectedStatusCode: "409" }],
  rationale: "Exercise a malformed email value.",
  confidence: 0.8,
  assumptions: [],
};

describe("AI candidate validation", () => {
  it("accepts a structurally valid candidate and documented references", () => {
    expect(validateAICandidateShape(candidate)).toEqual([]);
    expect(validateAICandidateSemantics(candidate, aiScenarioApiModel)).toEqual([]);
  });

  it("reports malformed metadata and unsupported categories", () => {
    expect(
      validateAICandidateShape({
        ...candidate,
        category: "business-rule",
        confidence: 2,
        rationale: " ",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsupported-category" }),
        expect.objectContaining({ code: "low-confidence" }),
        expect.objectContaining({ code: "missing-rationale" }),
      ]),
    );
  });

  it("rejects unknown fields and undocumented response codes", () => {
    const findings = validateAICandidateSemantics(
      {
        ...candidate,
        targetField: "missing",
        assertions: [{ type: "status-code", expectedStatusCode: "418" }],
      },
      aiScenarioApiModel,
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "field-not-found" }),
        expect.objectContaining({ code: "undocumented-status-code" }),
      ]),
    );
  });

  it("rejects an empty candidate ID", () => {
    expect(validateAICandidateShape({ ...candidate, candidateId: "" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-candidate-id" })]),
    );
  });

  it("validates against the full model when prompt projection omits a later field", () => {
    const operation = aiScenarioApiModel.operations[0];
    const schema = operation.requestBody?.contentTypes["application/json"];
    if (!schema) throw new Error("fixture request body schema is required");

    const fullModel = {
      ...aiScenarioApiModel,
      operations: [
        {
          ...operation,
          requestBody: {
            ...operation.requestBody!,
            contentTypes: {
              "application/json": {
                ...schema,
                properties: {
                  ...schema.properties,
                  ...Object.fromEntries(
                    Array.from({ length: 12 }, (_, index) => [
                      `field${index + 1}`,
                      { type: "string", required: [], properties: {} },
                    ]),
                  ),
                },
              },
            },
          },
        },
      ],
    };
    const prompt = JSON.parse(buildAIScenarioPrompt(fullModel, { scenarios: [] })) as {
      operations: { requestBody?: { fields: { name: string }[] } }[];
    };
    expect(
      prompt.operations[0].requestBody?.fields.map((field) => field.name),
    ).not.toContain("field12");

    const findings = validateAICandidateSemantics(
      {
        ...candidate,
        targetField: "field12",
        request: {
          ...candidate.request,
          body: { field12: "bad" },
        },
      },
      fullModel,
    );
    expect(findings).toEqual([]);
  });
});

describe("AI candidate semantic validation (specs/005 FR-007, FR-009)", () => {
  const arrayModel = {
    ...aiScenarioApiModel,
    operations: [
      {
        ...aiScenarioApiModel.operations[0],
        parameters: [
          {
            name: "X-Trace-Id",
            location: "header" as const,
            required: false,
            schema: { type: "string", required: [], properties: {} },
          },
        ],
        requestBody: {
          required: true,
          contentTypes: {
            "application/json": {
              type: "object",
              required: [],
              properties: {
                items: {
                  type: "array",
                  required: [],
                  properties: {},
                  items: {
                    type: "object",
                    required: [],
                    properties: {
                      sku: { type: "string", required: [], properties: {} },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  };
  const arrayCandidate = {
    ...candidate,
    targetField: "items",
    request: { ...candidate.request, body: { items: [{ sku: "a" }] } },
  };

  it("accepts body keys that exist inside array items", () => {
    expect(validateAICandidateSemantics(arrayCandidate, arrayModel)).toEqual([]);
  });

  it("rejects an unknown body key inside an array item", () => {
    const findings = validateAICandidateSemantics(
      {
        ...arrayCandidate,
        request: { ...candidate.request, body: { items: [{ sku: "a" }, { bogus: 1 }] } },
      },
      arrayModel,
    );
    expect(findings).toEqual([
      expect.objectContaining({
        code: "field-not-found",
        path: "request.body.items[1].bogus",
      }),
    ]);
  });

  it("matches header parameter names case-insensitively", () => {
    const findings = validateAICandidateSemantics(
      {
        ...arrayCandidate,
        request: { ...arrayCandidate.request, headers: { "x-trace-id": "abc" } },
      },
      arrayModel,
    );
    expect(findings).toEqual([]);
  });

  it("does not let a candidate invent an authentication credential the specification does not declare", () => {
    const findings = validateAICandidateSemantics(
      {
        ...arrayCandidate,
        request: {
          ...arrayCandidate.request,
          headers: { Authorization: "Bearer made-up", "X-Api-Key": "made-up" },
        },
      },
      arrayModel,
    );
    expect(findings.map((finding) => finding.path)).toEqual([
      "request.headerParameters.Authorization",
      "request.headerParameters.X-Api-Key",
    ]);
  });
});

describe("a candidate for an operation with no inputs (specs/013 T071 follow-up)", () => {
  const bareModel = {
    ...aiScenarioApiModel,
    operations: [
      {
        ...aiScenarioApiModel.operations[0],
        path: "/reindex",
        operationId: "startReindex",
        parameters: [],
        requestBody: undefined,
        responses: [
          { statusCode: "202", description: "Accepted", contentTypes: {}, examples: {} },
          { statusCode: "409", description: "Already running", contentTypes: {}, examples: {} },
        ],
      },
    ],
  };
  const bareCandidate = {
    candidateId: "c-bare",
    operationPath: "/reindex",
    operationMethod: "POST",
    category: "positive" as const,
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions: [{ type: "status-code" as const, expectedStatusCode: "409" }],
    rationale: "A second request while one is running should be refused.",
    confidence: 0.7,
    assumptions: [],
  };

  it("is valid with no targetLocation and no targetField", () => {
    expect(validateAICandidateShape(bareCandidate)).toEqual([]);
    expect(validateAICandidateSemantics(bareCandidate, bareModel)).toEqual([]);
  });

  it("is rejected when it invents a request body the operation does not take", () => {
    const findings = validateAICandidateSemantics(
      { ...bareCandidate, request: { ...bareCandidate.request, body: { action: "restart" } } },
      bareModel,
    );
    expect(findings).toEqual([
      expect.objectContaining({ code: "field-not-found", path: "request.body" }),
    ]);
  });

  it.each([
    ["an absent body", undefined],
    ["a null body", null],
    ["an empty object", {}],
  ])("accepts %s for an operation that takes no body", (_name, body) => {
    expect(
      validateAICandidateSemantics(
        { ...bareCandidate, request: { ...bareCandidate.request, body } },
        bareModel,
      ),
    ).toEqual([]);
  });

  it("is still rejected when it invents a target the operation does not have", () => {
    const findings = validateAICandidateSemantics(
      { ...bareCandidate, targetLocation: "query" as const, targetField: "force" },
      bareModel,
    );
    expect(findings).toEqual([expect.objectContaining({ code: "field-not-found" })]);
  });
});

describe("AI candidate shape validation of request and assertions (specs/005 FR-007)", () => {
  it.each([
    ["a missing queryParameters object", { ...candidate.request, queryParameters: undefined }],
    ["a non-object headers value", { ...candidate.request, headers: "x" }],
    ["an array pathParameters value", { ...candidate.request, pathParameters: [] }],
  ])("reports %s as an invalid shape instead of throwing", (_name, request) => {
    const findings = validateAICandidateShape({ ...candidate, request });
    expect(findings).toEqual([
      expect.objectContaining({
        code: "invalid-shape",
        candidateId: "candidate-1",
        executable: false,
      }),
    ]);
  });

  it.each([
    ["a null assertion", [null]],
    ["an unsupported assertion type", [{ type: "response-time", expectedStatusCode: "200" }]],
    ["a status-code assertion without a status code", [{ type: "status-code" }]],
    ["a schema-conformance assertion without a schema", [{ type: "schema-conformance" }]],
  ])("reports %s as an invalid shape", (_name, assertions) => {
    const findings = validateAICandidateShape({ ...candidate, assertions });
    expect(findings).toEqual([
      expect.objectContaining({ code: "invalid-shape", path: "assertions[0]" }),
    ]);
  });

  it("reports non-string assumptions as an invalid shape", () => {
    expect(validateAICandidateShape({ ...candidate, assumptions: [1] })).toEqual([
      expect.objectContaining({ code: "invalid-shape", path: "assumptions" }),
    ]);
  });
});

describe("AI candidate identity and confidence metadata (specs/005 FR-014)", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["a number", 7],
  ])("reports a %s candidate ID as invalid-candidate-id only", (_name, candidateId) => {
    expect(validateAICandidateShape({ ...candidate, candidateId })).toEqual([
      expect.objectContaining({
        code: "invalid-candidate-id",
        path: "candidateId",
        executable: false,
      }),
    ]);
  });

  it.each([
    ["missing", undefined],
    ["a string", "0.8"],
    ["null", null],
  ])("reports %s confidence as invalid-confidence only", (_name, confidence) => {
    expect(validateAICandidateShape({ ...candidate, confidence })).toEqual([
      expect.objectContaining({
        code: "invalid-confidence",
        candidateId: "candidate-1",
        path: "confidence",
        executable: false,
      }),
    ]);
  });

  it.each([-0.1, 1.5, Number.POSITIVE_INFINITY])(
    "reports confidence %s outside the documented [0, 1] bound as low-confidence",
    (confidence) => {
      expect(validateAICandidateShape({ ...candidate, confidence })).toEqual([
        expect.objectContaining({ code: "low-confidence", path: "confidence" }),
      ]);
    },
  );

  it.each([0, 1])("accepts the inclusive confidence bound %s", (confidence) => {
    expect(validateAICandidateShape({ ...candidate, confidence })).toEqual([]);
  });

  it("reports an identity defect and a confidence defect together", () => {
    const codes = validateAICandidateShape({
      ...candidate,
      candidateId: "",
      confidence: undefined,
    }).map((finding) => finding.code);
    expect(codes).toEqual(["invalid-candidate-id", "invalid-confidence"]);
  });

  it("still reports other structural defects as invalid-shape", () => {
    expect(validateAICandidateShape({ ...candidate, rationale: 3 })).toEqual([
      expect.objectContaining({ code: "invalid-shape" }),
    ]);
  });
});
