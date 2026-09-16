import type { ApiModel, TestModel } from "@apipilot/shared-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runExecution } from "../../../src/execution/runExecution";
import { createRun, getRun } from "../../../src/execution/executionRunStore";
import { enterTestSession } from "../../../src/session/sessionContext";
import { TargetServer } from "../../fixtures/execution/targetServer";
import {
  oauth2ClientCredentialsScheme,
  oauth2ProtectedOperation,
} from "../../fixtures/postman/credentialFixtures";

/**
 * Integration coverage for AP-024's `runExecution.ts` change (research.md D6): the synthesized
 * OAuth2 token-fetch item has no `provenance.scenarioId`, so it must run for its side effect on
 * the shared environment without throwing and without producing its own `RequestResult` — while
 * the real, scenario-backed request that actually needs the token still authenticates and reports
 * normally. `executionRuns.test.ts` drives this through the full HTTP-upload workflow against a
 * fixed pet-store spec that declares no OAuth2 scheme; this file instead calls `runExecution()`
 * directly against a purpose-built OAuth2 ApiModel, since that is the narrowest way to exercise
 * this behavior without changing that shared, fixed fixture.
 */

function oauth2ApiModelWithBaseUrl(): ApiModel {
  return {
    operations: [oauth2ProtectedOperation],
    securitySchemes: oauth2ClientCredentialsScheme,
    summary: { operationCount: 1, schemaCount: 0, securitySchemeCount: 1, issues: [] },
  };
}

function oauth2ApprovedTestModel(): TestModel {
  return {
    scenarios: [
      {
        id: "scenario-oauth2-widgets",
        category: "positive",
        operationPath: oauth2ProtectedOperation.path,
        operationMethod: oauth2ProtectedOperation.method,
        request: { pathParameters: {}, queryParameters: {}, headers: {} },
        assertions: [{ type: "status-code", expectedStatusCode: "200" }],
        provenance: { source: "RULE", rule: "positive", description: "d.", duplicateOfRules: [] },
      },
    ],
  };
}

describe("runExecution — OAuth2 token-fetch items (specs/024-oauth2-client-credentials-auth)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    enterTestSession("test-session-oauth2-execution");
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("runs the token-fetch item first without throwing or recording its own result, then authenticates the dependent request (US2, FR-004a)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("POST", "/oauth2/token", { status: 200, body: { access_token: "tok-123" } });
    targetServer.configure("GET", "/widgets", { status: 200, body: [] });

    const run = createRun({
      workflowId: "workflow-1",
      environmentId: "env-1",
      environmentSnapshot: { name: "Local", tier: "local", baseUrl },
    });

    await runExecution({
      runId: run.id,
      apiModel: oauth2ApiModelWithBaseUrl(),
      approvedTestModel: oauth2ApprovedTestModel(),
      environment: {
        id: "env-1",
        name: "Local",
        tier: "local",
        baseUrl,
        variableValues: { clientId: "test-client-id", clientSecret: "test-client-secret" },
        requestDelayMs: 0,
      },
    });

    const settled = getRun(run.id);
    expect(settled.status).toBe("completed");
    // Exactly one RequestResult — the widgets scenario. The token-fetch item never produces one.
    expect(settled.results).toHaveLength(1);
    expect(settled.results[0].scenarioId).toBe("scenario-oauth2-widgets");
    expect(settled.results[0].outcome).toBe("passed");

    const tokenRequests = targetServer.requests.filter((r) => r.path === "/oauth2/token");
    const widgetRequests = targetServer.requests.filter((r) => r.path === "/widgets");
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0].method).toBe("POST");
    expect(widgetRequests).toHaveLength(1);
    // The access token fetched from the token endpoint was actually applied to the dependent
    // request's Authorization header — proving end-to-end automatic authentication, not just
    // that both requests happened to run.
    expect(widgetRequests[0].headers.authorization).toBe("Bearer tok-123");
  }, 15000);

  it("does not retry or substitute a fallback when the token-fetch request is rejected — the dependent request visibly fails instead (US2 Acceptance Scenario 4, FR-004b)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("POST", "/oauth2/token", { status: 401, body: { error: "invalid_client" } });
    // A real API rejecting an unauthenticated/invalid-token request — simulates the visible
    // downstream failure FR-004b requires when no real access token was ever obtained.
    targetServer.configure("GET", "/widgets", { status: 401, body: { error: "unauthorized" } });

    const run = createRun({
      workflowId: "workflow-1",
      environmentId: "env-1",
      environmentSnapshot: { name: "Local", tier: "local", baseUrl },
    });

    await runExecution({
      runId: run.id,
      apiModel: oauth2ApiModelWithBaseUrl(),
      approvedTestModel: oauth2ApprovedTestModel(),
      environment: {
        id: "env-1",
        name: "Local",
        tier: "local",
        baseUrl,
        variableValues: { clientId: "test-client-id", clientSecret: "test-client-secret" },
        requestDelayMs: 0,
      },
    });

    const settled = getRun(run.id);
    expect(settled.status).toBe("completed");
    expect(settled.results).toHaveLength(1);
    expect(settled.results[0].outcome).toBe("failed");
    expect(settled.results[0].failureCategory).toBe("unexpected-status");

    // Exactly one attempt at the token endpoint — never retried.
    expect(targetServer.requests.filter((r) => r.path === "/oauth2/token")).toHaveLength(1);
  }, 15000);
});
