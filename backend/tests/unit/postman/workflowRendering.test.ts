import { describe, expect, it } from "vitest";
import { generateCollection } from "../../../src/postman/generateCollection";
import { planApprovedWorkflows } from "../../../src/postman/workflowRendering";
import { exportApiModel, minimalTestModel } from "../../fixtures/postman/exportFixtures";
import {
  findWorkflowFolder,
  scriptLines,
  workflowFolders,
  workflowItems,
} from "../../fixtures/postman/workflowAssertions";
import {
  integrationWorkflow,
  twoStepHandoffWorkflow,
  twoStepOrderWorkflow,
  workflowStep,
} from "../../fixtures/postman/workflowFixtures";

const consumerOperation = {
  path: "/orders/{orderId}",
  method: "GET" as const,
  operationId: "getOrder",
  parameters: [
    {
      name: "orderId",
      location: "path" as const,
      required: true,
      schema: { required: [], properties: {}, type: "string" as const },
    },
  ],
  requestBody: undefined,
  responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
  security: [],
  tags: ["orders"],
};

const apiModel = {
  ...exportApiModel,
  operations: [...exportApiModel.operations, consumerOperation],
};
const producer = exportApiModel.operations.find(
  (operation) => operation.path === "/orders/{orderId}" && operation.method === "POST",
)!;
const producerScenario = {
  id: "workflow-producer",
  operationPath: producer.path,
  operationMethod: producer.method,
  category: "positive" as const,
  request: {
    pathParameters: { orderId: "source" },
    queryParameters: {},
    headers: {},
    body: { sku: "sku", quantity: 1 },
  },
  assertions: [],
  provenance: {
    source: "RULE" as const,
    rule: "positive",
    description: "producer",
    duplicateOfRules: [],
  },
};
const consumerScenario = {
  id: "workflow-consumer",
  operationPath: "/orders/{orderId}",
  operationMethod: "GET",
  category: "positive" as const,
  request: { pathParameters: { orderId: "wrong" }, queryParameters: {}, headers: {} },
  assertions: [],
  provenance: {
    source: "RULE" as const,
    rule: "positive",
    description: "consumer",
    duplicateOfRules: [],
  },
};

const testModel = { scenarios: [producerScenario, consumerScenario] };

describe("workflow rendering", () => {
  it("selects the deterministic positive scenario for each workflow step", () => {
    const negative = {
      ...producerScenario,
      id: "a-negative",
      category: "invalid-type" as const,
    };
    const positive = {
      ...producerScenario,
      id: "z-positive",
      category: "positive" as const,
    };
    const outcome = planApprovedWorkflows(
      apiModel,
      { scenarios: [negative, positive, consumerScenario] },
      { workflows: [twoStepOrderWorkflow()], approvedWorkflowIds: ["workflow-order"] },
    );

    expect(outcome.plans[0]?.steps[0]?.scenario.id).toBe("z-positive");
  });

  it("omits a workflow atomically when step positions are not contiguous", () => {
    const workflow = integrationWorkflow("workflow-gapped", [
      workflowStep(0, "POST", "/orders/{orderId}"),
      workflowStep(2, "GET", "/orders/{orderId}"),
    ]);
    const outcome = planApprovedWorkflows(apiModel, testModel, {
      workflows: [workflow],
      approvedWorkflowIds: [workflow.id],
    });

    expect(outcome.plans[0]?.steps).toEqual([]);
    expect(outcome.limitations[0]).toMatchObject({
      workflowId: workflow.id,
      kind: "workflow-unsupported-sequence",
    });
  });

  it("omits a workflow atomically when a step has no approved scenario", () => {
    const workflow = integrationWorkflow("workflow-missing-scenario", [
      workflowStep(0, "POST", "/orders/{orderId}"),
      workflowStep(1, "GET", "/orders/{orderId}"),
    ]);
    const outcome = planApprovedWorkflows(
      apiModel,
      { scenarios: [producerScenario] },
      { workflows: [workflow], approvedWorkflowIds: [workflow.id] },
    );

    expect(outcome.plans[0]?.steps).toEqual([]);
    expect(outcome.limitations[0]).toMatchObject({
      workflowId: workflow.id,
      kind: "workflow-missing-scenario",
    });
  });

  it("renders an approved workflow in step order with a response handoff", () => {
    const outcome = generateCollection(
      apiModel,
      testModel,
      {},
      {
        workflows: [twoStepHandoffWorkflow()],
        approvedWorkflowIds: ["workflow-handoff"],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const folder = findWorkflowFolder(outcome.result.collection, "workflow-handoff");
    expect(folder?.item.map((item) => item.request.method)).toEqual(["POST", "GET"]);
    expect(folder?.item[1]?.request.url.variable[0]?.value).toContain(
      "{{workflow-handoff_orderId}}",
    );
    expect(scriptLines(folder!.item[0])).toEqual(
      expect.arrayContaining([expect.stringContaining("workflow-handoff_orderId")]),
    );
    expect(outcome.result.summary).toMatchObject({
      workflowCount: 1,
      workflowRequestCount: 2,
      standaloneRequestCount: 0,
      workflowVariableCount: 1,
      unsupportedWorkflowCount: 0,
      omittedWorkflowCount: 0,
    });
    expect(folder?.item[0]?.provenance).toMatchObject({
      workflowId: "workflow-handoff",
      stepPosition: 0,
      scenarioId: "workflow-producer",
      relationshipIds: ["orderId-relationship"],
    });
  });

  it("does not render unapproved workflow intent and preserves standalone export", () => {
    const outcome = generateCollection(
      apiModel,
      { scenarios: [producerScenario] },
      {},
      {
        workflows: [twoStepOrderWorkflow()],
        approvedWorkflowIds: [],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(workflowFolders(outcome.result.collection)).toHaveLength(0);
    expect(workflowItems(outcome.result.collection)).toHaveLength(0);
    expect(outcome.result.summary.standaloneRequestCount).toBe(1);
    expect(outcome.result.summary.omittedWorkflowCount).toBe(1);
    expect(outcome.result.readme).toContain("Omitted unapproved workflows: 1");
  });

  it("produces byte-stable artifacts and changes only workflow output when approval changes", () => {
    const context = {
      workflows: [twoStepHandoffWorkflow()],
      approvedWorkflowIds: ["workflow-handoff"],
    };
    const first = generateCollection(apiModel, testModel, {}, context);
    const second = generateCollection(apiModel, testModel, {}, context);
    expect(second).toEqual(first);

    const standalone = generateCollection(
      apiModel,
      testModel,
      {},
      {
        ...context,
        approvedWorkflowIds: [],
      },
    );
    expect(standalone.ok).toBe(true);
    if (!standalone.ok || !first.ok) return;
    expect(
      standalone.result.collection.item.some(
        (folder) => folder.name === "Workflow: workflow-handoff",
      ),
    ).toBe(false);
    expect(
      standalone.result.collection.item.filter(
        (folder) => folder.name !== "Workflow: workflow-handoff",
      ),
    ).toEqual(
      expect.arrayContaining(
        first.result.collection.item.filter(
          (folder) => folder.name !== "Workflow: workflow-handoff",
        ),
      ),
    );
  });

  it("keeps the legacy single-operation export unchanged when context is omitted", () => {
    const outcome = generateCollection(
      {
        operations: [
          {
            path: "/ping",
            method: "GET",
            operationId: "ping",
            parameters: [],
            requestBody: undefined,
            responses: [
              { statusCode: "200", description: "OK", contentTypes: {}, examples: {} },
            ],
            security: [],
            tags: [],
          },
        ],
        securitySchemes: {},
        summary: {
          operationCount: 1,
          schemaCount: 0,
          securitySchemeCount: 0,
          issues: [],
        },
      },
      minimalTestModel,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.collection.item.flatMap((folder) => folder.item)).toHaveLength(
      1,
    );
    expect(outcome.result.summary.workflowCount).toBe(0);
  });
});
