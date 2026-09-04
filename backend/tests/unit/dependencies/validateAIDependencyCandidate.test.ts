import { describe, expect, it } from "vitest";
import type { AIDependencyCandidate } from "@apipilot/shared-domain";
import {
  validateAIDependencyCandidateSemantics,
  validateAIDependencyCandidateShape,
} from "../../../src/dependencies/validateAIDependencyCandidate";
import { dissimilarNameAiApiModel } from "../../fixtures/dependencies/dependencyFixtures";

function validCandidate(): AIDependencyCandidate {
  return {
    candidateId: "c1",
    producer: { operationPath: "/accounts", operationMethod: "POST", field: "accountId" },
    consumer: { operationPath: "/transfers", operationMethod: "POST", field: "accountRef", location: "body" },
    rationale: "accountRef semantically refers to accountId",
    confidence: 0.9,
  };
}

describe("validateAIDependencyCandidateShape", () => {
  it("accepts a well-formed candidate", () => {
    expect(validateAIDependencyCandidateShape(validCandidate())).toEqual([]);
  });

  it("rejects a candidate missing required fields", () => {
    const malformed = validCandidate() as Record<string, unknown>;
    delete malformed.producer;
    const findings = validateAIDependencyCandidateShape(malformed);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].code).toBe("invalid-shape");
  });

  it("rejects a candidate with confidence outside [0, 1]", () => {
    const findings = validateAIDependencyCandidateShape({ ...validCandidate(), confidence: 1.5 });
    expect(findings.length).toBeGreaterThan(0);
  });
});

describe("validateAIDependencyCandidateSemantics", () => {
  it("accepts a candidate whose operations and fields exist in the ApiModel", () => {
    const findings = validateAIDependencyCandidateSemantics(validCandidate(), dissimilarNameAiApiModel);
    expect(findings).toEqual([]);
  });

  it("rejects a candidate referencing a nonexistent operation", () => {
    const candidate = { ...validCandidate(), producer: { ...validCandidate().producer, operationPath: "/does-not-exist" } };
    const findings = validateAIDependencyCandidateSemantics(candidate, dissimilarNameAiApiModel);
    expect(findings.some((f) => f.code === "operation-not-found")).toBe(true);
  });

  it("rejects a candidate referencing a nonexistent field", () => {
    const candidate = { ...validCandidate(), consumer: { ...validCandidate().consumer, field: "doesNotExist" } };
    const findings = validateAIDependencyCandidateSemantics(candidate, dissimilarNameAiApiModel);
    expect(findings.some((f) => f.code === "field-not-found")).toBe(true);
  });
});
