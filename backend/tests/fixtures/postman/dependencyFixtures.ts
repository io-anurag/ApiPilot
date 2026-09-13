import type {
  ApiDependencyGraph,
  ApiDependencyRelationship,
  ApiModel,
  DependencyConfidence,
  DependencyCycleFinding,
  SchemaConstraint,
  TestModel,
  TestScenario,
  WorkflowReviewDecision,
} from "@apipilot/shared-domain";

/**
 * Fixtures for automatic-chaining tests (specs/019-auto-workflow-chaining). `chainingApiModel`
 * covers the feature's running example — `GET /orders` (producer) feeding `GET`, `PATCH`, and
 * `DELETE /orders/{id}` (consumers) — plus a handful of extra operations used only by specific
 * edge-case tests (an alternate producer for disambiguation, a pair whose grouping/tag would sort
 * the consumer before the producer, and an intermediate operation for the single-hop-only test).
 */

function schema(partial: Partial<SchemaConstraint> = {}): SchemaConstraint {
  return { required: [], properties: {}, ...partial };
}

export const chainingApiModel: ApiModel = {
  operations: [
    {
      path: "/orders",
      method: "GET",
      operationId: "listOrders",
      parameters: [],
      requestBody: undefined,
      responses: [
        {
          statusCode: "200",
          description: "OK",
          contentTypes: {
            "application/json": schema({ type: "object", properties: { id: schema({ type: "string", format: "uuid" }) } }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["orders"],
    },
    {
      path: "/orders/{id}",
      method: "GET",
      operationId: "getOrder",
      parameters: [{ name: "id", location: "path", required: true, schema: schema({ type: "string", format: "uuid" }) }],
      requestBody: undefined,
      responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["orders"],
    },
    {
      path: "/orders/{id}",
      method: "PATCH",
      operationId: "updateOrder",
      parameters: [{ name: "id", location: "path", required: true, schema: schema({ type: "string", format: "uuid" }) }],
      requestBody: {
        required: true,
        contentTypes: { "application/json": schema({ type: "object", properties: { status: schema({ type: "string" }) } }) },
      },
      responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["orders"],
    },
    {
      path: "/orders/{id}",
      method: "DELETE",
      operationId: "deleteOrder",
      parameters: [{ name: "id", location: "path", required: true, schema: schema({ type: "string", format: "uuid" }) }],
      requestBody: undefined,
      responses: [{ statusCode: "204", description: "No content", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["orders"],
    },
    // Alternate producer for the disambiguation test (also plausibly produces "id").
    {
      path: "/legacy-orders",
      method: "GET",
      operationId: "listLegacyOrders",
      parameters: [],
      requestBody: undefined,
      responses: [
        {
          statusCode: "200",
          description: "OK",
          contentTypes: {
            "application/json": schema({ type: "object", properties: { id: schema({ type: "string", format: "uuid" }) } }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["legacy"],
    },
    // Ordering-violation pair: different tags whose folder names sort the consumer ("aaa...")
    // before the producer ("zzz...") — the opposite of the common nested-resource case.
    {
      path: "/zzz-late-producer",
      method: "GET",
      operationId: "getLateProducer",
      parameters: [],
      requestBody: undefined,
      responses: [
        {
          statusCode: "200",
          description: "OK",
          contentTypes: {
            "application/json": schema({ type: "object", properties: { token: schema({ type: "string" }) } }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["zzz-late"],
    },
    {
      path: "/aaa-early-consumer/{token}",
      method: "GET",
      operationId: "getEarlyConsumer",
      parameters: [{ name: "token", location: "path", required: true, schema: schema({ type: "string" }) }],
      requestBody: undefined,
      responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["aaa-early"],
    },
    // Single-hop-only fixture: an intermediate operation deliberately left without an approved
    // scenario, so it can never serve as a producer for the operation after it.
    {
      path: "/order-groups/{id}",
      method: "GET",
      operationId: "getOrderGroup",
      parameters: [{ name: "id", location: "path", required: true, schema: schema({ type: "string" }) }],
      requestBody: undefined,
      responses: [
        {
          statusCode: "200",
          description: "OK",
          contentTypes: {
            "application/json": schema({ type: "object", properties: { childId: schema({ type: "string" }) } }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["order-groups"],
    },
    {
      path: "/order-group-children/{childId}",
      method: "GET",
      operationId: "getOrderGroupChild",
      parameters: [{ name: "childId", location: "path", required: true, schema: schema({ type: "string" }) }],
      requestBody: undefined,
      responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["order-group-children"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 9, schemaCount: 5, securitySchemeCount: 0, issues: [] },
};

function ruleScenario(
  id: string,
  overrides: Partial<TestScenario> & Pick<TestScenario, "operationPath" | "operationMethod">,
): TestScenario {
  return {
    id,
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions: [{ type: "status-code", expectedStatusCode: "200" }],
    provenance: { source: "RULE", rule: "positive", description: `Deterministic scenario ${id}.`, duplicateOfRules: [] },
    ...overrides,
  };
}

export const ordersListScenario = ruleScenario("scenario-orders-list", {
  operationPath: "/orders",
  operationMethod: "GET",
});

export const ordersGetScenario = ruleScenario("scenario-orders-get", {
  operationPath: "/orders/{id}",
  operationMethod: "GET",
});

export const ordersPatchScenario = ruleScenario("scenario-orders-patch", {
  operationPath: "/orders/{id}",
  operationMethod: "PATCH",
  request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { status: "shipped" } },
});

export const ordersDeleteScenario = ruleScenario("scenario-orders-delete", {
  operationPath: "/orders/{id}",
  operationMethod: "DELETE",
  assertions: [{ type: "status-code", expectedStatusCode: "204" }],
});

/** A second negative scenario for the same consumer operation, also missing "id" (grouping/dedup coverage). */
export const ordersDeleteInvalidScenario = ruleScenario("scenario-orders-delete-invalid", {
  operationPath: "/orders/{id}",
  operationMethod: "DELETE",
  category: "invalid-format",
  targetLocation: "path",
  targetField: "id",
  assertions: [{ type: "status-code", expectedStatusCode: "4XX" }],
});

export const legacyOrdersListScenario = ruleScenario("scenario-legacy-orders-list", {
  operationPath: "/legacy-orders",
  operationMethod: "GET",
});

export const lateProducerScenario = ruleScenario("scenario-late-producer", {
  operationPath: "/zzz-late-producer",
  operationMethod: "GET",
});

export const earlyConsumerScenario = ruleScenario("scenario-early-consumer", {
  operationPath: "/aaa-early-consumer/{token}",
  operationMethod: "GET",
});

export const orderGroupChildScenario = ruleScenario("scenario-order-group-child", {
  operationPath: "/order-group-children/{childId}",
  operationMethod: "GET",
});

export function testModelOf(...scenarios: TestScenario[]): TestModel {
  return { scenarios };
}

/** Builds one `ApiDependencyRelationship`; every field has a sensible default for the common case. */
export function relationship(
  overrides: Partial<ApiDependencyRelationship> &
    Pick<ApiDependencyRelationship, "id" | "producer" | "consumer">,
): ApiDependencyRelationship {
  return {
    confidence: "CONFIRMED",
    source: "deterministic",
    evidence: { nameMatch: true, typeMatch: true, formatMatch: true, resourceRelationship: true, tagAlignment: true },
    explanation: `"${overrides.consumer.field}" (${overrides.consumer.operationMethod} ${overrides.consumer.operationPath}) matches "${overrides.producer.field}" (${overrides.producer.operationMethod} ${overrides.producer.operationPath}).`,
    ...overrides,
  };
}

/** The flagship relationship: `GET /orders` ("id") → `GET /orders/{id}` ("id" path parameter). */
export function ordersGetRelationship(confidence: DependencyConfidence = "CONFIRMED"): ApiDependencyRelationship {
  return relationship({
    id: "rel-orders-get",
    confidence,
    producer: { operationPath: "/orders", operationMethod: "GET", field: "id" },
    consumer: { operationPath: "/orders/{id}", operationMethod: "GET", field: "id", location: "path" },
  });
}

export function ordersPatchRelationship(confidence: DependencyConfidence = "CONFIRMED"): ApiDependencyRelationship {
  return relationship({
    id: "rel-orders-patch",
    confidence,
    producer: { operationPath: "/orders", operationMethod: "GET", field: "id" },
    consumer: { operationPath: "/orders/{id}", operationMethod: "PATCH", field: "id", location: "path" },
  });
}

export function ordersDeleteRelationship(confidence: DependencyConfidence = "CONFIRMED"): ApiDependencyRelationship {
  return relationship({
    id: "rel-orders-delete",
    confidence,
    producer: { operationPath: "/orders", operationMethod: "GET", field: "id" },
    consumer: { operationPath: "/orders/{id}", operationMethod: "DELETE", field: "id", location: "path" },
  });
}

/** A competing, equally named producer for the same `DELETE /orders/{id}` consumer field. */
export function legacyOrdersDeleteRelationship(confidence: DependencyConfidence = "CONFIRMED"): ApiDependencyRelationship {
  return relationship({
    id: "rel-legacy-orders-delete",
    confidence,
    evidence: { nameMatch: true, typeMatch: true, formatMatch: true, resourceRelationship: false, tagAlignment: false },
    producer: { operationPath: "/legacy-orders", operationMethod: "GET", field: "id" },
    consumer: { operationPath: "/orders/{id}", operationMethod: "DELETE", field: "id", location: "path" },
  });
}

export function orderingViolationRelationship(): ApiDependencyRelationship {
  return relationship({
    id: "rel-ordering-violation",
    producer: { operationPath: "/zzz-late-producer", operationMethod: "GET", field: "token" },
    consumer: { operationPath: "/aaa-early-consumer/{token}", operationMethod: "GET", field: "token", location: "path" },
  });
}

/** `GET /order-groups/{id}` (never approved) → `GET /order-group-children/{childId}`: the second hop of a would-be multi-hop chain (FR-018). */
export function orderGroupChildRelationship(): ApiDependencyRelationship {
  return relationship({
    id: "rel-order-group-child",
    producer: { operationPath: "/order-groups/{id}", operationMethod: "GET", field: "childId" },
    consumer: { operationPath: "/order-group-children/{childId}", operationMethod: "GET", field: "childId", location: "path" },
  });
}

export function graphOf(...relationships: ApiDependencyRelationship[]): ApiDependencyGraph {
  return { relationships };
}

export function cycleFinding(relationshipIds: string[]): DependencyCycleFinding {
  return {
    relationshipIds,
    operations: [],
    message: "A cycle was detected among these relationships.",
  };
}

export function workflowDecision(
  workflowId: string,
  state: WorkflowReviewDecision["state"],
): WorkflowReviewDecision {
  return { workflowId, state, recordedAt: "2026-01-01T00:00:00.000Z" };
}
