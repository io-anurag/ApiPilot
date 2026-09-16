import { describe, expect, it } from "vitest";
import { planSchemeVariables } from "../../../src/postman/authMapping";
import { findCredentialProducers } from "../../../src/postman/credentialProducers";
import { buildAuthCredentialRelationships } from "../../../src/postman/authCredentialRelationships";
import { relationshipId } from "../../../src/dependencies/identifiers";
import {
  adminReportsOperation,
  ambiguousFieldsApiModel,
  flagshipTokenApiModel,
  flagshipTokenFanOutApiModel,
  issueAdminTokenOperation,
  issueApiKeyOperation,
  issueTokenOperation,
  noPlausibleFieldApiModel,
  realisticCredentialResponseApiModel,
  tokenAndAdminSchemes,
  tokenInfoOperation,
  tokenProfileOperation,
  twoIndependentSchemesApiModel,
} from "../../fixtures/postman/credentialFixtures";

function relationshipsFor(apiModel: typeof flagshipTokenApiModel) {
  const plan = planSchemeVariables(apiModel.securitySchemes);
  const credentialProducers = findCredentialProducers(apiModel.operations, plan);
  return buildAuthCredentialRelationships(apiModel.operations, credentialProducers);
}

describe("buildAuthCredentialRelationships", () => {
  it("builds one CONFIRMED relationship for a producer with exactly one string-typed response field (US1, FR-003)", () => {
    const relationships = relationshipsFor(flagshipTokenApiModel);
    expect(relationships).toHaveLength(1);
    const [relationship] = relationships;
    expect(relationship.producer).toEqual({
      operationPath: issueTokenOperation.path,
      operationMethod: issueTokenOperation.method,
      field: "token",
    });
    expect(relationship.consumer).toEqual({
      operationPath: tokenInfoOperation.path,
      operationMethod: tokenInfoOperation.method,
      field: "tokenAuth",
      location: "auth",
    });
    expect(relationship.confidence).toBe("CONFIRMED");
    expect(relationship.source).toBe("deterministic");
    expect(relationship.evidence).toBeUndefined();
    expect(relationship.aiCorroboration).toBeUndefined();
  });

  it("derives id via the same relationshipId() function every other relationship uses", () => {
    const [relationship] = relationshipsFor(flagshipTokenApiModel);
    expect(relationship.id).toBe(relationshipId(relationship.producer, relationship.consumer));
  });

  it("gives a non-empty, human-readable explanation naming the scheme and both operations", () => {
    const [relationship] = relationshipsFor(flagshipTokenApiModel);
    expect(relationship.explanation.length).toBeGreaterThan(0);
    expect(relationship.explanation).toContain("tokenAuth");
    expect(relationship.explanation).toContain(issueTokenOperation.path);
    expect(relationship.explanation).toContain(tokenInfoOperation.path);
  });

  it("builds one relationship per consuming operation for a fan-out producer (FR-009)", () => {
    const relationships = relationshipsFor(flagshipTokenFanOutApiModel);
    expect(relationships).toHaveLength(2);
    const consumerPaths = relationships.map((relationship) => relationship.consumer.operationPath).sort();
    expect(consumerPaths).toEqual([tokenInfoOperation.path, tokenProfileOperation.path].sort());
    // Every relationship still shares the identical producer field.
    expect(new Set(relationships.map((relationship) => relationship.producer.field)).size).toBe(1);
  });

  it("builds a relationship for the primary scheme exactly as it would for a non-primary one (Clarifications 2026-09-15 Q1)", () => {
    // flagshipTokenApiModel's sole scheme (tokenAuth) is primary by construction (it is the only
    // scheme of its type declared) — this test exists to make that assumption explicit and
    // regression-proof, since specs/021 never exercised a primary-scheme relationship at all.
    const plan = planSchemeVariables(flagshipTokenApiModel.securitySchemes);
    expect(plan.get("tokenAuth")?.isPrimary).toBe(true);
    expect(relationshipsFor(flagshipTokenApiModel)).toHaveLength(1);
  });

  it("builds no relationship when the producer's response documents two equally plausible string fields (US3, FR-004)", () => {
    expect(relationshipsFor(ambiguousFieldsApiModel)).toEqual([]);
  });

  it("builds no relationship when the producer's response documents zero plausible string fields (US3, FR-004)", () => {
    expect(relationshipsFor(noPlausibleFieldApiModel)).toEqual([]);
  });

  it("resolves to the sole non-structured, non-echoed field when a realistic credential response also documents an id, an enum, timestamps, and an echoed request field (FR-003 addendum)", () => {
    const relationships = relationshipsFor(realisticCredentialResponseApiModel);
    expect(relationships).toHaveLength(1);
    expect(relationships[0].producer).toEqual({
      operationPath: issueApiKeyOperation.path,
      operationMethod: issueApiKeyOperation.method,
      field: "apiKey",
    });
  });

  it("keeps two distinctly-keyed schemes' relationships fully independent, never mixing producer/consumer fields (US2, SC-002)", () => {
    const relationships = relationshipsFor(twoIndependentSchemesApiModel);
    expect(relationships).toHaveLength(2);

    const tokenRelationship = relationships.find((r) => r.consumer.field === "tokenAuth")!;
    const adminRelationship = relationships.find((r) => r.consumer.field === "adminAuth")!;
    expect(tokenRelationship.producer.operationPath).toBe(issueTokenOperation.path);
    expect(tokenRelationship.consumer.operationPath).toBe(tokenInfoOperation.path);
    expect(adminRelationship.producer.operationPath).toBe(issueAdminTokenOperation.path);
    expect(adminRelationship.consumer.operationPath).toBe(adminReportsOperation.path);

    // No cross-contamination: neither relationship's producer/consumer identifies the other scheme.
    expect(tokenRelationship.producer.operationPath).not.toBe(adminRelationship.producer.operationPath);
    expect(tokenRelationship.consumer.field).not.toBe(adminRelationship.consumer.field);
  });

  it("is a pure function of its inputs — recomputing from the same ApiModel yields byte-identical relationships (SC-004)", () => {
    const plan = planSchemeVariables(tokenAndAdminSchemes);
    const credentialProducers = findCredentialProducers(twoIndependentSchemesApiModel.operations, plan);
    const first = buildAuthCredentialRelationships(twoIndependentSchemesApiModel.operations, credentialProducers);
    const second = buildAuthCredentialRelationships(twoIndependentSchemesApiModel.operations, credentialProducers);
    expect(first).toEqual(second);
  });
});
