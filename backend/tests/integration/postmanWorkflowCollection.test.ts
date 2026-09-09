import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { exportApiModel } from "../fixtures/postman/exportFixtures";
import {
  twoStepHandoffWorkflow,
  unsupportedWorkflow,
} from "../fixtures/postman/workflowFixtures";

const producer = {
  id: "workflow-producer",
  operationPath: "/orders/{orderId}",
  operationMethod: "POST",
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
const consumer = {
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
const apiModel = {
  ...exportApiModel,
  operations: [
    ...exportApiModel.operations,
    {
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
      responses: [
        { statusCode: "200", description: "OK", contentTypes: {}, examples: {} },
      ],
      security: [],
      tags: ["orders"],
    },
  ],
};

function exportRequest(body: unknown) {
  return request(createApp())
    .post("/api/test-models/postman-collection")
    .send(body as object);
}

describe("workflow-aware Postman export", () => {
  it("renders approved workflow context at the HTTP boundary", async () => {
    const response = await exportRequest({
      apiModel,
      testModel: { scenarios: [producer, consumer] },
      workflowContext: {
        workflows: [twoStepHandoffWorkflow()],
        approvedWorkflowIds: ["workflow-handoff"],
      },
    });
    expect(response.status).toBe(200);
    expect(
      response.body.collection.item.map((folder: { name: string }) => folder.name),
    ).toContain("Workflow: workflow-handoff");
    expect(response.body.summary.workflowCount).toBe(1);
    expect(response.body.summary.workflowVariableCount).toBe(1);
    expect(response.body.readme).toContain("Rendered workflows: 1");
    expect(response.body.collection.item[0].item[0].provenance.workflowId).toBe(
      "workflow-handoff",
    );
  });

  it("keeps supplied credentials out of workflow collection, README, and diagnostics", async () => {
    const response = await exportRequest({
      apiModel,
      testModel: {
        scenarios: [
          {
            ...producer,
            request: {
              ...producer.request,
              headers: { Authorization: "Bearer super-secret-token" },
            },
          },
          consumer,
        ],
      },
      workflowContext: {
        workflows: [twoStepHandoffWorkflow()],
        approvedWorkflowIds: ["workflow-handoff"],
      },
      options: { variableValues: { token: "super-secret-token" } },
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body.collection)).not.toContain("super-secret-token");
    expect(response.body.readme).not.toContain("super-secret-token");
    expect(JSON.stringify(response.body.limitations)).not.toContain("super-secret-token");
    expect(response.body.environment.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "token",
          value: "super-secret-token",
          type: "secret",
        }),
      ]),
    );
  });

  it("omits an approved unsupported workflow atomically and reports its limitation", async () => {
    const response = await exportRequest({
      apiModel,
      testModel: { scenarios: [producer, consumer] },
      workflowContext: {
        workflows: [unsupportedWorkflow("workflow-missing")],
        approvedWorkflowIds: ["workflow-missing"],
      },
    });
    expect(response.status).toBe(200);
    expect(
      response.body.collection.item.some(
        (folder: { name: string }) => folder.name === "Workflow: workflow-missing",
      ),
    ).toBe(false);
    expect(response.body.summary.unsupportedWorkflowCount).toBe(1);
    expect(response.body.limitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workflowId: "workflow-missing",
          kind: "workflow-unsupported-sequence",
        }),
      ]),
    );
  });

  it("rejects malformed workflow context instead of treating it as absent", async () => {
    const response = await exportRequest({
      apiModel,
      testModel: { scenarios: [producer] },
      workflowContext: {
        workflows: [
          { id: "duplicate", steps: [], variables: [], relationshipIds: [] },
          { id: "duplicate", steps: [], variables: [], relationshipIds: [] },
        ],
        approvedWorkflowIds: [],
      },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });
});
