import type {
  ApiModel,
  ApiOperation,
  ExecutionRun,
  RequestResult,
  SchemaConstraint,
  TestModel,
  TestScenario,
  WorkflowExportContext,
} from "@apipilot/shared-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runExecution } from "../../../src/execution/runExecution";
import { createRun, getRun, requestCancel } from "../../../src/execution/executionRunStore";
import { enterTestSession } from "../../../src/session/sessionContext";
import { TargetServer } from "../../fixtures/execution/targetServer";
import {
  flagshipTokenApiModel,
  issueTokenScenario,
  oauth2ClientCredentialsScheme,
  oauth2ProtectedOperation,
  tokenInfoScenario,
} from "../../fixtures/postman/credentialFixtures";
import {
  chainingApiModel,
  graphOf,
  ordersGetRelationship,
  ordersGetScenario,
  ordersListScenario,
} from "../../fixtures/postman/dependencyFixtures";
import {
  integrationWorkflow,
  workflowStep,
  workflowVariable,
} from "../../fixtures/postman/workflowFixtures";

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

/**
 * specs/029-execution-gap-closure User Story 1 (FR-001–FR-007): a request whose data dependency
 * (an approved-workflow step or a data automatic chain) had a blocking outcome is withheld as
 * `not-attempted`/`"dependency-not-met"`, naming its unmet producers. A schema mismatch alone is
 * not blocking, and credential hand-offs are never enforced.
 */
describe("runExecution — dependency-aware execution (specs/029-execution-gap-closure)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    enterTestSession("test-session-dependency-execution");
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  function field(type: SchemaConstraint["type"]): SchemaConstraint {
    return { type, required: [], properties: {} };
  }

  function pathParameter(name: string) {
    return { name, location: "path" as const, required: true, schema: field("string") };
  }

  function operation(method: string, path: string, overrides: Partial<ApiOperation> = {}): ApiOperation {
    return {
      path,
      method,
      operationId: undefined,
      parameters: [],
      requestBody: undefined,
      responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
      security: [],
      tags: [],
      ...overrides,
    };
  }

  const jsonBody = { required: true, contentTypes: { "application/json": field("object") } };
  const createdOrderSchema: SchemaConstraint = {
    type: "object",
    required: ["id", "total"],
    properties: { id: field("string"), total: field("number") },
  };

  const createOrder = operation("POST", "/orders", { requestBody: jsonBody });
  const getOrder = operation("GET", "/orders/{orderId}", { parameters: [pathParameter("orderId")] });
  const createCustomer = operation("POST", "/customers", { requestBody: jsonBody });
  const getCustomer = operation("GET", "/customers/{customerId}", { parameters: [pathParameter("customerId")] });
  const getCustomerOrder = operation("GET", "/customers/{customerId}/orders/{orderId}", {
    parameters: [pathParameter("customerId"), pathParameter("orderId")],
  });
  const health = operation("GET", "/health");

  function apiModelOf(...operations: ApiOperation[]): ApiModel {
    return {
      operations,
      securitySchemes: {},
      summary: { operationCount: operations.length, schemaCount: 0, securitySchemeCount: 0, issues: [] },
    };
  }

  function scenario(id: string, op: ApiOperation, overrides: Partial<TestScenario> = {}): TestScenario {
    const pathParameters = Object.fromEntries(
      op.parameters.filter((parameter) => parameter.location === "path").map((parameter) => [parameter.name, "seed"]),
    );
    return {
      id,
      category: "positive",
      operationPath: op.path,
      operationMethod: op.method,
      request: {
        pathParameters,
        queryParameters: {},
        headers: {},
        ...(op.requestBody ? { body: { name: "x" } } : {}),
      },
      assertions: [{ type: "status-code", expectedStatusCode: "200" }],
      provenance: { source: "RULE", rule: "positive", description: `Scenario ${id}.`, duplicateOfRules: [] },
      ...overrides,
    };
  }

  const createOrderScenario = scenario("scenario-create-order", createOrder, {
    assertions: [
      { type: "status-code", expectedStatusCode: "201" },
      { type: "schema-conformance", expectedSchema: createdOrderSchema },
    ],
  });
  const getOrderScenario = scenario("scenario-get-order", getOrder);
  const createCustomerScenario = scenario("scenario-create-customer", createCustomer, {
    assertions: [{ type: "status-code", expectedStatusCode: "201" }],
  });
  const getCustomerScenario = scenario("scenario-get-customer", getCustomer);
  const getCustomerOrderScenario = scenario("scenario-get-customer-order", getCustomerOrder);
  const healthScenario = scenario("scenario-health", health);

  /** POST /orders ("id") → GET /orders/{orderId}. */
  const orderWorkflow = integrationWorkflow(
    "workflow-order",
    [
      workflowStep(0, "POST", "/orders", { producesVariableNames: ["orderId"] }),
      workflowStep(1, "GET", "/orders/{orderId}", { consumesVariableNames: ["orderId"] }),
    ],
    [workflowVariable("orderId", 0, "id", 1, "path", "orderId")],
  );

  /** POST /orders ("id") → GET /orders/{orderId} ("customerId") → GET /customers/{customerId}. */
  const threeStepWorkflow = integrationWorkflow(
    "workflow-three-step",
    [
      workflowStep(0, "POST", "/orders", { producesVariableNames: ["orderId"] }),
      workflowStep(1, "GET", "/orders/{orderId}", {
        consumesVariableNames: ["orderId"],
        producesVariableNames: ["customerId"],
      }),
      workflowStep(2, "GET", "/customers/{customerId}", { consumesVariableNames: ["customerId"] }),
    ],
    [
      workflowVariable("orderId", 0, "id", 1, "path", "orderId"),
      workflowVariable("customerId", 1, "customerId", 2, "path", "customerId"),
    ],
  );

  /** POST /orders ("id") and POST /customers ("id") both feed GET /customers/{customerId}/orders/{orderId}. */
  const twoProducerWorkflow = integrationWorkflow(
    "workflow-two-producers",
    [
      workflowStep(0, "POST", "/orders", { producesVariableNames: ["orderId"] }),
      workflowStep(1, "POST", "/customers", { producesVariableNames: ["customerId"] }),
      workflowStep(2, "GET", "/customers/{customerId}/orders/{orderId}", {
        consumesVariableNames: ["orderId", "customerId"],
      }),
    ],
    [
      workflowVariable("orderId", 0, "id", 2, "path", "orderId"),
      workflowVariable("customerId", 1, "id", 2, "path", "customerId"),
    ],
  );

  function approved(...workflows: ReturnType<typeof integrationWorkflow>[]): WorkflowExportContext {
    return { workflows, approvedWorkflowIds: workflows.map((workflow) => workflow.id) };
  }

  async function run(
    apiModel: ApiModel,
    scenarios: TestScenario[],
    workflowContext: WorkflowExportContext | undefined,
    baseUrl: string,
    duringRun?: (runId: string) => Promise<void>,
  ): Promise<ExecutionRun> {
    const created = createRun({
      workflowId: "workflow-1",
      environmentId: "env-1",
      environmentSnapshot: { name: "Local", tier: "local", baseUrl },
    });
    const execution = runExecution({
      runId: created.id,
      apiModel,
      approvedTestModel: { scenarios },
      workflowContext,
      environment: { id: "env-1", name: "Local", tier: "local", baseUrl, variableValues: {}, requestDelayMs: 0 },
    });
    await duringRun?.(created.id);
    await execution;
    return getRun(created.id);
  }

  function resultFor(settled: ExecutionRun, scenarioId: string): RequestResult {
    const result = settled.results.find((candidate) => candidate.scenarioId === scenarioId);
    if (!result) throw new Error(`no result for ${scenarioId}`);
    return result;
  }

  function identity(source: TestScenario) {
    return { scenarioId: source.id, operationPath: source.operationPath, operationMethod: source.operationMethod };
  }

  function sentPaths(): string[] {
    return targetServer.requests.map((request) => `${request.method} ${request.path}`);
  }

  const chainingContext = (relationships = graphOf()): WorkflowExportContext => ({
    workflows: [],
    approvedWorkflowIds: [],
    automaticChaining: { graph: relationships, cycles: [], workflowDecisions: {} },
  });

  it("withholds the dependent step when its producer returns an unexpected status (1)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("POST", "/orders", { status: 500, body: {} });

    const settled = await run(
      apiModelOf(createOrder, getOrder),
      [createOrderScenario, getOrderScenario],
      approved(orderWorkflow),
      baseUrl,
    );

    expect(sentPaths().filter((path) => path.startsWith("GET /orders/"))).toEqual([]);
    const dependent = resultFor(settled, getOrderScenario.id);
    expect(dependent.outcome).toBe("not-attempted");
    expect(dependent.notAttemptedReason).toBe("dependency-not-met");
    expect(dependent.unmetDependencies).toEqual([identity(createOrderScenario)]);
    expect(resultFor(settled, createOrderScenario.id).failureCategory).toBe("unexpected-status");
  }, 15000);

  it("sends the dependent step with the produced value when the producer passes (2)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("POST", "/orders", { status: 201, body: { id: "o-1", total: 10 } });

    const settled = await run(
      apiModelOf(createOrder, getOrder),
      [createOrderScenario, getOrderScenario],
      approved(orderWorkflow),
      baseUrl,
    );

    expect(sentPaths()).toContain("GET /orders/o-1");
    expect(resultFor(settled, getOrderScenario.id).outcome).toBe("passed");
    expect(resultFor(settled, getOrderScenario.id).unmetDependencies).toBeUndefined();
  }, 15000);

  it("still sends the dependent step when the producer's only failure is a schema mismatch (3)", async () => {
    const baseUrl = await targetServer.start();
    // Right status, "id" present, but the documented required "total" is missing.
    targetServer.configure("POST", "/orders", { status: 201, body: { id: "o-2" } });

    const settled = await run(
      apiModelOf(createOrder, getOrder),
      [createOrderScenario, getOrderScenario],
      approved(orderWorkflow),
      baseUrl,
    );

    const producer = resultFor(settled, createOrderScenario.id);
    expect(producer.outcome).toBe("failed");
    expect(producer.failureCategory).toBe("assertion-failed");
    expect(sentPaths()).toContain("GET /orders/o-2");
    expect(resultFor(settled, getOrderScenario.id).notAttemptedReason).toBeUndefined();
  }, 15000);

  it("withholds the dependent step when the producer's target is unreachable (4)", async () => {
    const baseUrl = await targetServer.start();
    await targetServer.stop();

    const settled = await run(
      apiModelOf(createOrder, getOrder),
      [createOrderScenario, getOrderScenario],
      approved(orderWorkflow),
      baseUrl,
    );

    expect(resultFor(settled, createOrderScenario.id).failureCategory).toBe("connectivity-failure");
    expect(resultFor(settled, getOrderScenario.id).notAttemptedReason).toBe("dependency-not-met");
  }, 15000);

  it("withholds transitively, each step naming its own direct producer (5, FR-003)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("POST", "/orders", { status: 500, body: {} });

    const settled = await run(
      apiModelOf(createOrder, getOrder, getCustomer),
      [createOrderScenario, getOrderScenario, getCustomerScenario],
      approved(threeStepWorkflow),
      baseUrl,
    );

    expect(sentPaths()).toEqual(["POST /orders"]);
    expect(resultFor(settled, getOrderScenario.id).unmetDependencies).toEqual([identity(createOrderScenario)]);
    const third = resultFor(settled, getCustomerScenario.id);
    expect(third.notAttemptedReason).toBe("dependency-not-met");
    expect(third.unmetDependencies).toEqual([identity(getOrderScenario)]);
  }, 15000);

  it("still runs an unrelated standalone request normally (6, FR-004)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("POST", "/orders", { status: 500, body: {} });

    const settled = await run(
      apiModelOf(createOrder, getOrder, health),
      [createOrderScenario, getOrderScenario, healthScenario],
      approved(orderWorkflow),
      baseUrl,
    );

    expect(sentPaths()).toContain("GET /health");
    expect(resultFor(settled, healthScenario.id).outcome).toBe("passed");
    expect(resultFor(settled, getOrderScenario.id).notAttemptedReason).toBe("dependency-not-met");
  }, 15000);

  it("records a dependent as cancelled, not dependency-not-met, when the run is cancelled first (7, FR-005)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("POST", "/orders", { status: 500, body: {}, delayMs: 1500 });

    const settled = await run(
      apiModelOf(createOrder, getOrder),
      [createOrderScenario, getOrderScenario],
      approved(orderWorkflow),
      baseUrl,
      async (runId) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        requestCancel(runId);
      },
    );

    expect(settled.status).toBe("cancelled");
    expect(resultFor(settled, createOrderScenario.id).outcome).toBe("failed");
    const dependent = resultFor(settled, getOrderScenario.id);
    expect(dependent.notAttemptedReason).toBe("cancelled");
    expect(dependent.unmetDependencies).toBeUndefined();
  }, 15000);

  it("withholds the consumer of a data automatic chain whose producer fails (8, AP-019)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/orders", { status: 500, body: {} });

    const settled = await run(
      chainingApiModel,
      [ordersListScenario, ordersGetScenario],
      chainingContext(graphOf(ordersGetRelationship())),
      baseUrl,
    );

    expect(sentPaths()).toEqual(["GET /orders"]);
    const consumer = resultFor(settled, ordersGetScenario.id);
    expect(consumer.notAttemptedReason).toBe("dependency-not-met");
    expect(consumer.unmetDependencies).toEqual([identity(ordersListScenario)]);
  }, 15000);

  it("still sends the consumer of an auth-credential chain whose producer fails (9, FR-006)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("POST", "/auth/token", { status: 500, body: {} });

    const settled = await run(
      flagshipTokenApiModel,
      [issueTokenScenario, tokenInfoScenario],
      chainingContext(),
      baseUrl,
    );

    expect(sentPaths()).toContain("GET /auth/token-info");
    expect(resultFor(settled, tokenInfoScenario.id).notAttemptedReason).toBeUndefined();
  }, 15000);

  it("names exactly the failed producer when only one of two fails (10, FR-002)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("POST", "/orders", { status: 500, body: {} });
    targetServer.configure("POST", "/customers", { status: 201, body: { id: "c-1" } });

    const settled = await run(
      apiModelOf(createOrder, createCustomer, getCustomerOrder),
      [createOrderScenario, createCustomerScenario, getCustomerOrderScenario],
      approved(twoProducerWorkflow),
      baseUrl,
    );

    const consumer = resultFor(settled, getCustomerOrderScenario.id);
    expect(consumer.notAttemptedReason).toBe("dependency-not-met");
    expect(consumer.unmetDependencies).toEqual([identity(createOrderScenario)]);
    expect(sentPaths().some((path) => path.startsWith("GET /customers/"))).toBe(false);
  }, 15000);

  it("names every failed producer, in execution order, when both fail (11, FR-002)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("POST", "/orders", { status: 500, body: {} });
    targetServer.configure("POST", "/customers", { status: 500, body: {} });

    const settled = await run(
      apiModelOf(createOrder, createCustomer, getCustomerOrder),
      [createOrderScenario, createCustomerScenario, getCustomerOrderScenario],
      approved(twoProducerWorkflow),
      baseUrl,
    );

    expect(resultFor(settled, getCustomerOrderScenario.id).unmetDependencies).toEqual([
      identity(createOrderScenario),
      identity(createCustomerScenario),
    ]);
  }, 15000);

  /** data-model.md's invariants, checked over every result of a settled run (SC-002, SC-003). */
  function expectResultInvariants(settled: ExecutionRun): void {
    settled.results.forEach((result, index) => {
      expect(result.processingStage).toBeDefined();
      expect(result.outcome === "not-attempted").toBe(result.processingStage === "not-sent");
      expect(result.failureCategory === "connectivity-failure" || result.failureCategory === "timeout").toBe(
        result.processingStage === "no-response",
      );
      expect(result.unmetDependencies !== undefined).toBe(result.notAttemptedReason === "dependency-not-met");
      const earlierScenarioIds = settled.results.slice(0, index).map((earlier) => earlier.scenarioId);
      for (const dependency of result.unmetDependencies ?? []) {
        expect(earlierScenarioIds).toContain(dependency.scenarioId);
      }
    });
  }

  describe("processing stage (specs/029 User Story 2, FR-008/FR-009)", () => {
    it("records response-received for sent requests and not-sent for a withheld dependent", async () => {
      const baseUrl = await targetServer.start();
      targetServer.configure("POST", "/orders", { status: 500, body: {} });

      const settled = await run(
        apiModelOf(createOrder, getOrder, health),
        [createOrderScenario, getOrderScenario, healthScenario],
        approved(orderWorkflow),
        baseUrl,
      );

      expect(resultFor(settled, healthScenario.id).processingStage).toBe("response-received");
      expect(resultFor(settled, createOrderScenario.id).processingStage).toBe("response-received");
      expect(resultFor(settled, getOrderScenario.id).processingStage).toBe("not-sent");
      expectResultInvariants(settled);
    }, 15000);

    it("records no-response for an unreachable target", async () => {
      const baseUrl = await targetServer.start();
      await targetServer.stop();

      const settled = await run(apiModelOf(health), [healthScenario], undefined, baseUrl);

      expect(resultFor(settled, healthScenario.id).processingStage).toBe("no-response");
      expectResultInvariants(settled);
    }, 15000);

    it("records not-sent for requests left unreached by a cancellation", async () => {
      const baseUrl = await targetServer.start();
      targetServer.configure("GET", "/health", { status: 200, body: {}, delayMs: 1500 });
      const secondHealth = scenario("scenario-health-2", operation("GET", "/health-2"));

      const settled = await run(
        apiModelOf(health, operation("GET", "/health-2")),
        [healthScenario, secondHealth],
        undefined,
        baseUrl,
        async (runId) => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          requestCancel(runId);
        },
      );

      expect(settled.status).toBe("cancelled");
      expect(resultFor(settled, healthScenario.id).processingStage).toBe("response-received");
      expect(resultFor(settled, secondHealth.id)).toMatchObject({
        notAttemptedReason: "cancelled",
        processingStage: "not-sent",
      });
      expectResultInvariants(settled);
    }, 15000);
  });
});
