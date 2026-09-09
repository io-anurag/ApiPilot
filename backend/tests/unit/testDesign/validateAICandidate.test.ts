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
      expect.arrayContaining([expect.objectContaining({ code: "invalid-shape" })]),
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
