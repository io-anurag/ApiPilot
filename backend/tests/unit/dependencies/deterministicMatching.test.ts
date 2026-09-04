import { describe, expect, it } from "vitest";
import type { DeterministicDependencyEvidence } from "@apipilot/shared-domain";
import {
  classifyDeterministicEvidence,
  computeDeterministicRelationships,
  computeResourceRelationship,
  computeTagAlignment,
  fieldsNameMatch,
} from "../../../src/dependencies/deterministicMatching";
import {
  crudChainApiModel,
  unrelatedNameCollisionApiModel,
} from "../../fixtures/dependencies/dependencyFixtures";

function evidence(partial: Partial<DeterministicDependencyEvidence>): DeterministicDependencyEvidence {
  return {
    nameMatch: true,
    typeMatch: false,
    formatMatch: false,
    resourceRelationship: false,
    tagAlignment: false,
    ...partial,
  };
}

describe("fieldsNameMatch", () => {
  it("matches identical names, case-insensitively", () => {
    expect(fieldsNameMatch("name", "Name")).toBe(true);
  });

  it("matches a bare 'id' producer against a camelCase '...Id' consumer", () => {
    expect(fieldsNameMatch("id", "userId")).toBe(true);
    expect(fieldsNameMatch("userId", "id")).toBe(true);
  });

  it("matches a bare 'id' producer against a snake_case '..._id' consumer", () => {
    expect(fieldsNameMatch("id", "user_id")).toBe(true);
  });

  it("matches the last segment of a dotted producer path", () => {
    expect(fieldsNameMatch("user.id", "userId")).toBe(true);
  });

  it("does not match two different '...Id'-suffixed names to each other", () => {
    expect(fieldsNameMatch("gadgetId", "widgetId")).toBe(false);
  });

  it("does not treat an ordinary word ending in 'id' as an identifier field", () => {
    expect(fieldsNameMatch("id", "valid")).toBe(false);
  });

  it("does not match unrelated names", () => {
    expect(fieldsNameMatch("email", "phoneNumber")).toBe(false);
  });
});

describe("computeResourceRelationship", () => {
  it("recognizes a collection path as a prefix of its item path", () => {
    expect(computeResourceRelationship("/users", "/users/{userId}")).toBe(true);
    expect(computeResourceRelationship("/users/{userId}", "/users")).toBe(true);
  });

  it("recognizes a nested resource path", () => {
    expect(computeResourceRelationship("/sessions", "/sessions/{userId}/profile")).toBe(true);
  });

  it("rejects unrelated resources", () => {
    expect(computeResourceRelationship("/products", "/users")).toBe(false);
  });
});

describe("computeTagAlignment", () => {
  it("is true when at least one tag is shared", () => {
    expect(computeTagAlignment(["users", "admin"], ["users"])).toBe(true);
  });

  it("is false when no tag is shared", () => {
    expect(computeTagAlignment(["products"], ["users"])).toBe(false);
  });
});

describe("classifyDeterministicEvidence", () => {
  it("returns null when there is no name match", () => {
    expect(classifyDeterministicEvidence(evidence({ nameMatch: false }))).toBeNull();
  });

  it("classifies name + resource + type/format as CONFIRMED", () => {
    expect(
      classifyDeterministicEvidence(evidence({ resourceRelationship: true, typeMatch: true })),
    ).toBe("CONFIRMED");
    expect(
      classifyDeterministicEvidence(evidence({ resourceRelationship: true, formatMatch: true })),
    ).toBe("CONFIRMED");
  });

  it("classifies name + resource alone (no type/format) as LIKELY", () => {
    expect(classifyDeterministicEvidence(evidence({ resourceRelationship: true }))).toBe("LIKELY");
  });

  it("classifies name + two other signals (no resource) as LIKELY", () => {
    expect(classifyDeterministicEvidence(evidence({ typeMatch: true, formatMatch: true }))).toBe(
      "LIKELY",
    );
    expect(classifyDeterministicEvidence(evidence({ typeMatch: true, tagAlignment: true }))).toBe(
      "LIKELY",
    );
    expect(
      classifyDeterministicEvidence(evidence({ formatMatch: true, tagAlignment: true })),
    ).toBe("LIKELY");
  });

  it("classifies name + at most one other signal (no resource) as POSSIBLE", () => {
    expect(classifyDeterministicEvidence(evidence({}))).toBe("POSSIBLE");
    expect(classifyDeterministicEvidence(evidence({ typeMatch: true }))).toBe("POSSIBLE");
    expect(classifyDeterministicEvidence(evidence({ formatMatch: true }))).toBe("POSSIBLE");
    expect(classifyDeterministicEvidence(evidence({ tagAlignment: true }))).toBe("POSSIBLE");
  });

  it("never classifies above POSSIBLE without a name match, and never CONFIRMED/LIKELY from name alone (FR-003, SC-002)", () => {
    expect(classifyDeterministicEvidence(evidence({}))).not.toBe("CONFIRMED");
    expect(classifyDeterministicEvidence(evidence({}))).not.toBe("LIKELY");
  });
});

describe("computeDeterministicRelationships", () => {
  it("detects the CONFIRMED CRUD-chain relationship with a non-empty explanation", () => {
    const relationships = computeDeterministicRelationships(crudChainApiModel);
    const created = relationships.find(
      (r) => r.producer.operationPath === "/users" && r.consumer.operationPath === "/users/{userId}",
    );
    expect(created).toBeDefined();
    expect(created?.confidence).toBe("CONFIRMED");
    expect(created?.source).toBe("deterministic");
    expect(created?.explanation.length).toBeGreaterThan(0);
    expect(created?.explanation).toMatch(/resource path|matching data type|matching format/);
  });

  it("never classifies the unrelated-name-collision fixture above POSSIBLE", () => {
    const relationships = computeDeterministicRelationships(unrelatedNameCollisionApiModel);
    expect(relationships.length).toBeGreaterThan(0);
    for (const relationship of relationships) {
      expect(relationship.confidence).toBe("POSSIBLE");
    }
  });
});
