import { describe, expect, it } from "vitest";
import type { ApiDependencyRelationship } from "@apipilot/shared-domain";
import {
  candidateToAIRelationship,
  mergeDeterministicAndAI,
  resolveProducerDisambiguation,
} from "../../../src/dependencies/mergeRelationships";

function relationship(
  overrides: Partial<ApiDependencyRelationship> & Pick<ApiDependencyRelationship, "id">,
): ApiDependencyRelationship {
  return {
    producer: { operationPath: "/a", operationMethod: "POST", field: "id" },
    consumer: { operationPath: "/b", operationMethod: "GET", field: "aId", location: "path" },
    confidence: "LIKELY",
    source: "deterministic",
    evidence: {
      nameMatch: true,
      typeMatch: true,
      formatMatch: false,
      resourceRelationship: false,
      tagAlignment: false,
    },
    explanation: "test",
    ...overrides,
  };
}

describe("resolveProducerDisambiguation", () => {
  it("resolves to exactly one producer when two relationships supply the same consuming field", () => {
    const winner = relationship({ id: "rel-confirmed", confidence: "CONFIRMED" });
    const loser = relationship({
      id: "rel-likely",
      confidence: "LIKELY",
      producer: { operationPath: "/c", operationMethod: "POST", field: "id" },
    });
    const { resolved, excluded } = resolveProducerDisambiguation([winner, loser]);
    expect(resolved.map((r) => r.id)).toEqual(["rel-confirmed"]);
    expect(excluded.map((r) => r.id)).toEqual(["rel-likely"]);
  });

  it("breaks a confidence tie using evidence-signal count", () => {
    const strongerEvidence = relationship({
      id: "rel-strong",
      evidence: {
        nameMatch: true,
        typeMatch: true,
        formatMatch: true,
        resourceRelationship: false,
        tagAlignment: false,
      },
    });
    const weakerEvidence = relationship({
      id: "rel-weak",
      producer: { operationPath: "/c", operationMethod: "POST", field: "id" },
      evidence: {
        nameMatch: true,
        typeMatch: false,
        formatMatch: false,
        resourceRelationship: false,
        tagAlignment: false,
      },
    });
    const { resolved, excluded } = resolveProducerDisambiguation([weakerEvidence, strongerEvidence]);
    expect(resolved.map((r) => r.id)).toEqual(["rel-strong"]);
    expect(excluded.map((r) => r.id)).toEqual(["rel-weak"]);
  });

  it("breaks a full tie deterministically by producer operation path, repeatably regardless of input order", () => {
    const a = relationship({ id: "rel-a", producer: { operationPath: "/a", operationMethod: "POST", field: "id" } });
    const b = relationship({ id: "rel-b", producer: { operationPath: "/b", operationMethod: "POST", field: "id" } });
    const first = resolveProducerDisambiguation([b, a]);
    const second = resolveProducerDisambiguation([a, b]);
    expect(first.resolved.map((r) => r.id)).toEqual(second.resolved.map((r) => r.id));
    expect(first.resolved[0].producer.operationPath).toBe("/a");
  });

  it("returns every relationship as resolved when no consuming field is shared", () => {
    const a = relationship({ id: "rel-a" });
    const b = relationship({
      id: "rel-b",
      consumer: { operationPath: "/z", operationMethod: "GET", field: "zId", location: "path" },
    });
    const { resolved, excluded } = resolveProducerDisambiguation([a, b]);
    expect(resolved.map((r) => r.id).sort()).toEqual(["rel-a", "rel-b"]);
    expect(excluded).toEqual([]);
  });

  it("is deterministic and repeatable across calls", () => {
    const a = relationship({ id: "rel-a", confidence: "CONFIRMED" });
    const b = relationship({
      id: "rel-b",
      confidence: "LIKELY",
      producer: { operationPath: "/c", operationMethod: "POST", field: "id" },
    });
    const first = resolveProducerDisambiguation([a, b]);
    const second = resolveProducerDisambiguation([a, b]);
    expect(first.resolved.map((r) => r.id)).toEqual(second.resolved.map((r) => r.id));
    expect(first.excluded.map((r) => r.id)).toEqual(second.excluded.map((r) => r.id));
  });
});

describe("candidateToAIRelationship", () => {
  const candidate = {
    candidateId: "c1",
    producer: { operationPath: "/accounts", operationMethod: "POST", field: "accountId" },
    consumer: { operationPath: "/transfers", operationMethod: "POST", field: "accountRef", location: "body" as const },
    rationale: "accountRef semantically refers to accountId",
    confidence: 0.9,
  };
  const response = { modelId: "test-model", provider: "mock" as const };

  it("caps a high-confidence AI-only candidate at LIKELY, never CONFIRMED", () => {
    const relationship = candidateToAIRelationship(candidate, response);
    expect(relationship.confidence).toBe("LIKELY");
    expect(relationship.source).toBe("ai");
    expect(relationship.aiCorroboration).toMatchObject({ aiModel: "test-model", aiConfidence: 0.9 });
  });

  it("classifies a low-confidence AI-only candidate as POSSIBLE", () => {
    const relationship = candidateToAIRelationship({ ...candidate, confidence: 0.5 }, response);
    expect(relationship.confidence).toBe("POSSIBLE");
  });

  it("words the explanation as an inference, never as confirmed specification fact (FR-007, constitution III)", () => {
    const relationship = candidateToAIRelationship(candidate, response);
    expect(relationship.explanation).toMatch(/inferred|suggested|AI/i);
    expect(relationship.explanation).not.toMatch(/confirmed by the specification|documented fact/i);
  });
});

describe("mergeDeterministicAndAI", () => {
  it("merges a same-field-pair AI candidate into the existing deterministic relationship", () => {
    const deterministic = relationship({
      id: "rel-det",
      confidence: "CONFIRMED",
      producer: { operationPath: "/users", operationMethod: "POST", field: "id" },
      consumer: { operationPath: "/users/{userId}", operationMethod: "GET", field: "userId", location: "path" },
    });
    const aiRelationship = candidateToAIRelationship(
      {
        candidateId: "c1",
        producer: { operationPath: "/users", operationMethod: "POST", field: "id" },
        consumer: { operationPath: "/users/{userId}", operationMethod: "GET", field: "userId", location: "path" },
        rationale: "corroborates the deterministic match",
        confidence: 0.95,
      },
      { modelId: "test-model", provider: "mock" },
    );

    const merged = mergeDeterministicAndAI([deterministic], [aiRelationship]);

    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe("CONFIRMED");
    expect(merged[0].source).toBe("deterministic+ai");
    expect(merged[0].aiCorroboration).toBeDefined();
    expect(merged[0].evidence).toBeDefined();
  });

  it("keeps an AI-only relationship (no deterministic match) as its own entry", () => {
    const aiRelationship = candidateToAIRelationship(
      {
        candidateId: "c1",
        producer: { operationPath: "/accounts", operationMethod: "POST", field: "accountId" },
        consumer: { operationPath: "/transfers", operationMethod: "POST", field: "accountRef", location: "body" },
        rationale: "semantic match",
        confidence: 0.9,
      },
      { modelId: "test-model", provider: "mock" },
    );

    const merged = mergeDeterministicAndAI([], [aiRelationship]);

    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("ai");
  });
});
