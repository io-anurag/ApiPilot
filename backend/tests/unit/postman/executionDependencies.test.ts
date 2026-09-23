import type { ApiModel, ApiOperation, TestScenario, WorkflowExportContext } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import {
  generateCollection,
  generateExecutableCollection,
  type ExecutionDependencyMap,
} from "../../../src/postman/generateCollection";
import {
  itemIdForOAuth2TokenFetch,
  itemIdForScenario,
  itemIdForWorkflowStep,
} from "../../../src/postman/identifiers";
import {
  chainingApiModel,
  graphOf,
  ordersGetRelationship,
  ordersGetScenario,
  ordersListScenario,
  testModelOf,
} from "../../fixtures/postman/dependencyFixtures";
import {
  flagshipTokenApiModel,
  issueTokenScenario,
  oauth2ApiModel,
  oauth2ProtectedScenario,
  tokenInfoScenario,
} from "../../fixtures/postman/credentialFixtures";
import { twoStepHandoffWorkflow } from "../../fixtures/postman/workflowFixtures";

/**
 * specs/029-execution-gap-closure research.md D1/D2: `generateExecutableCollection()` returns the
 * data hand-offs between the items it builds (approved workflows and data automatic chains only),
 * alongside an `ExportResult` identical to `generateCollection()`'s.
 */

const orderIdParameter = {
  name: "orderId",
  location: "path" as const,
  required: true,
  schema: { required: [], properties: {}, type: "string" as const },
};

const createOrderOperation: ApiOperation = {
  path: "/orders/{orderId}",
  method: "POST",
  operationId: "createOrder",
  parameters: [orderIdParameter],
  requestBody: {
    required: true,
    contentTypes: { "application/json": { required: [], properties: {}, type: "object" } },
  },
  responses: [{ statusCode: "201", description: "Created", contentTypes: {}, examples: {} }],
  security: [],
  tags: ["orders"],
};

const getOrderOperation: ApiOperation = {
  path: "/orders/{orderId}",
  method: "GET",
  operationId: "getOrder",
  parameters: [orderIdParameter],
  requestBody: undefined,
  responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
  security: [],
  tags: ["orders"],
};

const workflowApiModel: ApiModel = {
  operations: [createOrderOperation, getOrderOperation],
  securitySchemes: {},
  summary: { operationCount: 2, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

function scenario(id: string, operation: ApiOperation, overrides: Partial<TestScenario> = {}): TestScenario {
  return {
    id,
    category: "positive",
    operationPath: operation.path,
    operationMethod: operation.method,
    request: { pathParameters: { orderId: "seed" }, queryParameters: {}, headers: {} },
    assertions: [],
    provenance: { source: "RULE", rule: "positive", description: `Scenario ${id}.`, duplicateOfRules: [] },
    ...overrides,
  };
}

const producerScenario = scenario("workflow-producer", createOrderOperation, {
  request: { pathParameters: { orderId: "seed" }, queryParameters: {}, headers: {}, body: { sku: "a" } },
});
const consumerScenario = scenario("workflow-consumer", getOrderOperation);

function dependenciesOf(
  apiModel: ApiModel,
  scenarios: TestScenario[],
  context?: WorkflowExportContext,
): ExecutionDependencyMap {
  const outcome = generateExecutableCollection(apiModel, testModelOf(...scenarios), {}, context);
  if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
  return outcome.dataDependencies;
}

function automaticChainingContext(relationships = graphOf()): WorkflowExportContext {
  return { workflows: [], approvedWorkflowIds: [], automaticChaining: { graph: relationships, cycles: [], workflowDecisions: {} } };
}

describe("generateExecutableCollection — data dependencies (specs/029 research.md D1)", () => {
  it("links an approved workflow's consuming step to its producing step (a)", () => {
    const workflow = twoStepHandoffWorkflow();
    const dependencies = dependenciesOf(workflowApiModel, [producerScenario, consumerScenario], {
      workflows: [workflow],
      approvedWorkflowIds: [workflow.id],
    });

    expect([...dependencies.entries()]).toEqual([
      [
        itemIdForWorkflowStep(workflow.id, 1, consumerScenario.id),
        [itemIdForWorkflowStep(workflow.id, 0, producerScenario.id)],
      ],
    ]);
  });

  it("links a data automatic chain's consumer to its producer (b)", () => {
    const dependencies = dependenciesOf(
      chainingApiModel,
      [ordersListScenario, ordersGetScenario],
      automaticChainingContext(graphOf(ordersGetRelationship())),
    );

    expect([...dependencies.entries()]).toEqual([
      [itemIdForScenario(ordersGetScenario.id), [itemIdForScenario(ordersListScenario.id)]],
    ]);
  });

  it("adds no entry for an auth-credential chain (c, FR-006)", () => {
    const outcome = generateExecutableCollection(
      flagshipTokenApiModel,
      testModelOf(issueTokenScenario, tokenInfoScenario),
      {},
      automaticChainingContext(),
    );
    if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
    // The credential chain is really there — it is excluded, not absent.
    expect(outcome.result.summary.automaticChainCount).toBeGreaterThanOrEqual(1);
    expect(outcome.dataDependencies.size).toBe(0);
  });

  it("never includes an OAuth2 token-fetch item (d, FR-007)", () => {
    const dependencies = dependenciesOf(oauth2ApiModel, [oauth2ProtectedScenario]);
    const tokenFetchId = itemIdForOAuth2TokenFetch(Object.keys(oauth2ApiModel.securitySchemes)[0]);
    const everyId = [...dependencies.entries()].flatMap(([consumer, producers]) => [consumer, ...producers]);
    expect(everyId).not.toContain(tokenFetchId);
  });

  it("returns an ExportResult identical to generateCollection() (e, constitution XVI)", () => {
    const workflow = twoStepHandoffWorkflow();
    const context = { workflows: [workflow], approvedWorkflowIds: [workflow.id] };
    const testModel = testModelOf(producerScenario, consumerScenario);
    const executable = generateExecutableCollection(workflowApiModel, testModel, {}, context);
    const plain = generateCollection(workflowApiModel, testModel, {}, context);
    if (!executable.ok || !plain.ok) throw new Error("expected successful exports");
    expect(JSON.stringify(executable.result)).toBe(JSON.stringify(plain.result));
  });

  it("is deterministic across repeated generation (f)", () => {
    const workflow = twoStepHandoffWorkflow();
    const context = { workflows: [workflow], approvedWorkflowIds: [workflow.id] };
    const first = dependenciesOf(workflowApiModel, [producerScenario, consumerScenario], context);
    const second = dependenciesOf(workflowApiModel, [producerScenario, consumerScenario], context);
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it("keeps two workflows that share a step scenario separate (g)", () => {
    const first = twoStepHandoffWorkflow("workflow-a");
    const second = twoStepHandoffWorkflow("workflow-b");
    const dependencies = dependenciesOf(workflowApiModel, [producerScenario, consumerScenario], {
      workflows: [first, second],
      approvedWorkflowIds: [first.id, second.id],
    });

    expect(dependencies.get(itemIdForWorkflowStep("workflow-a", 1, consumerScenario.id))).toEqual([
      itemIdForWorkflowStep("workflow-a", 0, producerScenario.id),
    ]);
    expect(dependencies.get(itemIdForWorkflowStep("workflow-b", 1, consumerScenario.id))).toEqual([
      itemIdForWorkflowStep("workflow-b", 0, producerScenario.id),
    ]);
    expect(dependencies.size).toBe(2);
  });
});
