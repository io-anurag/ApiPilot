import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AIScenarioCandidate, ApiModel } from "@apipilot/shared-domain";
import { buildHarModel } from "../../../src/apiInput/har/buildHarModel";
import { DEFAULT_INPUT_LIMITS } from "../../../src/apiInput/limits";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import {
  AI_SCENARIO_RESPONSE_VERSION,
  PROVENANCE_NOTE,
  buildAIScenarioPrompt,
} from "../../../src/testDesign/aiScenarioPrompt";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import { validateAICandidateSemantics } from "../../../src/testDesign/validateAICandidate";
import { harOf, jsonEntry } from "../../fixtures/apiInput/harBuilders";

/**
 * specs/056 FR-039, research R23: the OpenAPI prompt is byte-identical (the contract version stays 5);
 * a prompt for observed or declared operations carries one extra key; AI candidates that reference
 * anything absent from the model are rejected.
 */

async function openApiModel(): Promise<ApiModel> {
  const { document, issues } = await validateSpec(parseYaml(readFileSync(path.resolve(__dirname, "../../fixtures/openapi/valid.yaml"), "utf-8")));
  return buildApiModel(document, issues);
}

const API = "https://api.shop.test";
async function harModel(): Promise<ApiModel> {
  return buildHarModel(
    harOf([
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: "o1" }, { sku: "A", quantity: 1 }),
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: "o2" }, { sku: "B", quantity: 2 }),
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: "o3" }, { sku: "C", quantity: 3 }),
    ]),
    DEFAULT_INPUT_LIMITS,
  );
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("the AI scenario prompt for an OpenAPI model is unchanged", () => {
  it("keeps the contract version at 5 and adds no key", async () => {
    expect(AI_SCENARIO_RESPONSE_VERSION).toBe(5);
    const model = await openApiModel();
    const prompt = JSON.parse(buildAIScenarioPrompt(model, generateTestModel(model))) as Record<string, unknown>;
    expect(prompt.provenanceNote).toBeUndefined();
    expect(Object.keys(prompt)).toEqual(["responseVersion", "task", "operations", "allowedTargets", "existingCoverage", "categories", "example", "allowedStatusCodes"]);
  });

  it("is byte-identical to the stored prompt for the fixture specification", async () => {
    const model = await openApiModel();
    const prompt = buildAIScenarioPrompt(model, generateTestModel(model));
    const golden = readFileSync(path.resolve(__dirname, "../../fixtures/testDesign/golden/openapi-valid-prompt.golden.json"), "utf-8");
    expect(sha256(prompt)).toBe(sha256(golden.trimEnd()));
    expect(prompt).toBe(golden.trimEnd());
  });
});

describe("the AI scenario prompt for observed and declared operations", () => {
  it("carries the provenance note, and nothing else changes", async () => {
    const model = await harModel();
    const prompt = JSON.parse(buildAIScenarioPrompt(model, generateTestModel(model))) as Record<string, unknown>;
    expect(prompt.provenanceNote).toBe(PROVENANCE_NOTE);
    expect(PROVENANCE_NOTE).toBe("These operations come from captured or declared traffic; listed statuses are observed or declared, not documented guarantees.");
    expect(prompt.responseVersion).toBe(5);
    expect(Object.keys(prompt).indexOf("provenanceNote")).toBeLessThan(Object.keys(prompt).indexOf("operations"));
    // The task wording the models were measured on is untouched.
    expect(String(prompt.task)).not.toContain("captured");
  });

  it("carries it for a declared operation and not for one explicitly documented", async () => {
    const model = await harModel();
    const declared: ApiModel = { ...model, operations: model.operations.map((o) => ({ ...o, provenance: { origin: "declared" as const } })) };
    expect(JSON.parse(buildAIScenarioPrompt(declared, generateTestModel(declared))).provenanceNote).toBe(PROVENANCE_NOTE);
    const documented: ApiModel = { ...model, operations: model.operations.map((o) => ({ ...o, provenance: { origin: "documented" as const } })) };
    expect(JSON.parse(buildAIScenarioPrompt(documented, generateTestModel(documented))).provenanceNote).toBeUndefined();
  });

  it("lists only observed statuses and fields, and no credential value", async () => {
    const entries = [
      jsonEntry("POST", `${API}/v1/login`, 200, { accessToken: "SEEDED-SECRET-PROMPT-TOKEN" }, { user: "ada", password: "SEEDED-SECRET-PROMPT-PW" }, { requestHeaders: { Authorization: "Bearer SEEDED-SECRET-PROMPT-AUTH" } }),
    ];
    const model = await buildHarModel(harOf(entries), DEFAULT_INPUT_LIMITS);
    const text = buildAIScenarioPrompt(model, generateTestModel(model));
    expect(text).not.toContain("SEEDED-SECRET");
    const prompt = JSON.parse(text) as { allowedStatusCodes: string[]; allowedTargets?: { targetField: string }[] };
    expect(prompt.allowedStatusCodes).toEqual(["200"]);
  });
});

describe("AI candidates are validated against the observed model (FR-039)", () => {
  const candidate = (overrides: Partial<AIScenarioCandidate>): AIScenarioCandidate => ({
    candidateId: "c1",
    operationPath: "/v1/orders",
    operationMethod: "POST",
    category: "missing-field",
    targetLocation: "body",
    targetField: "sku",
    request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { quantity: 1 } },
    assertions: [{ type: "status-code", expectedStatusCode: "201" }],
    rationale: "r",
    confidence: 0.9,
    assumptions: [],
    ...overrides,
  });

  it("accepts a candidate that references only what was observed", async () => {
    expect(validateAICandidateSemantics(candidate({}), await harModel())).toEqual([]);
  });

  it("rejects an operation, a field and a status that the capture never showed", async () => {
    const model = await harModel();
    expect(validateAICandidateSemantics(candidate({ operationPath: "/v1/refunds" }), model).map((f) => f.code)).toEqual(["operation-not-found"]);
    expect(validateAICandidateSemantics(candidate({ targetField: "couponCode" }), model).map((f) => f.code)).toContain("field-not-found");
    const undocumented = validateAICandidateSemantics(candidate({ assertions: [{ type: "status-code", expectedStatusCode: "422" }] }), model);
    expect(undocumented.length).toBeGreaterThan(0);
  });
});
