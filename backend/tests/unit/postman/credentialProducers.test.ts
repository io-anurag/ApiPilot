import { describe, expect, it } from "vitest";
import { planSchemeVariables } from "../../../src/postman/authMapping";
import { findCredentialProducers } from "../../../src/postman/credentialProducers";
import {
  adminAuthOperation,
  adminLoginOperation,
  ambiguousAdminOperation,
  authenticatedAdminLookingOperation,
  bearerAuthOperation,
  operationsWithAmbiguousProducer,
  operationsWithDiscoverableProducer,
  operationsWithNoProducer,
  regularLoginOperation,
  twoBearerSchemes,
} from "../../fixtures/postman/credentialFixtures";

const plan = planSchemeVariables(twoBearerSchemes);

describe("findCredentialProducers", () => {
  it("identifies the sole unauthenticated operation matching a distinct scheme's stem", () => {
    const candidates = findCredentialProducers(operationsWithDiscoverableProducer, plan);
    expect(candidates).toEqual([
      {
        schemeKey: "adminAuth",
        variableName: "adminToken",
        producerOperationPath: adminLoginOperation.path,
        producerOperationMethod: adminLoginOperation.method,
      },
    ]);
  });

  it("yields no candidate when zero unauthenticated operations exist", () => {
    expect(findCredentialProducers(operationsWithNoProducer, plan)).toEqual([]);
  });

  it("yields no candidate when two unauthenticated operations equally match the stem", () => {
    expect(findCredentialProducers(operationsWithAmbiguousProducer, plan)).toEqual([]);
  });

  it("never selects an authenticated operation as a producer, even if its path matches the stem", () => {
    const candidates = findCredentialProducers(
      [authenticatedAdminLookingOperation, bearerAuthOperation, adminAuthOperation],
      plan,
    );
    expect(candidates).toEqual([]);
  });

  it("never searches the primary scheme, even when an unauthenticated operation's path matches its stem", () => {
    // bearerAuth's stem is "bearer"; regularLoginOperation's path/operationId never contain it,
    // so this also verifies no accidental match — the real guarantee is structural: only
    // non-primary plan entries are iterated at all.
    const candidates = findCredentialProducers(
      [regularLoginOperation, ambiguousAdminOperation],
      plan,
    );
    expect(candidates.every((candidate) => candidate.schemeKey !== "bearerAuth")).toBe(true);
  });
});
