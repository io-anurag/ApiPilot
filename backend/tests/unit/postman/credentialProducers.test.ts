import { describe, expect, it } from "vitest";
import { planSchemeVariables } from "../../../src/postman/authMapping";
import { findCredentialProducers } from "../../../src/postman/credentialProducers";
import {
  adminAuthOperation,
  adminLoginOperation,
  authenticatedAdminLookingOperation,
  basicOnlyScheme,
  basicProtectedOperation,
  bearerAuthOperation,
  bearerAuthOnlyScheme,
  createSessionOperation,
  issueTokenOperation,
  operationsWithAmbiguousProducer,
  operationsWithDiscoverableProducer,
  operationsWithNoProducer,
  sessionInfoOperation,
  tokenAuthScheme,
  tokenInfoOperation,
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

  // specs/023-auto-auth-credential-chaining Clarifications 2026-09-15 (Q1/Q3) extend discovery to
  // the primary scheme too, using the identical stem-match rule with no relaxed fallback.
  it("also searches the primary scheme, finding a candidate when its stem matches", () => {
    const tokenPlan = planSchemeVariables(tokenAuthScheme);
    const candidates = findCredentialProducers([issueTokenOperation, tokenInfoOperation], tokenPlan);
    expect(candidates).toEqual([
      {
        schemeKey: "tokenAuth",
        variableName: "token",
        producerOperationPath: issueTokenOperation.path,
        producerOperationMethod: issueTokenOperation.method,
      },
    ]);
  });

  it("yields no candidate for the primary scheme when its login endpoint's path/operationId does not contain its own stem", () => {
    const bearerPlan = planSchemeVariables(bearerAuthOnlyScheme);
    const candidates = findCredentialProducers([createSessionOperation, sessionInfoOperation], bearerPlan);
    expect(candidates).toEqual([]);
  });

  it("never yields a candidate for a http/basic scheme, even as the primary (sole) scheme", () => {
    const basicPlan = planSchemeVariables(basicOnlyScheme);
    const candidates = findCredentialProducers([basicProtectedOperation], basicPlan);
    expect(candidates).toEqual([]);
  });
});
