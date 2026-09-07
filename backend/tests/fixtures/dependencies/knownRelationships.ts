import type { ApiModel, SchemaConstraint } from "@apipilot/shared-domain";

/**
 * A dependency fixture whose true producer/consumer relationships are enumerated alongside the
 * model, so batching's effect on detection coverage can be measured rather than assumed
 * (specs/014-ai-batching-policy SC-013, FR-029).
 *
 * The point of this fixture is the *spread*: relationships deliberately span operations that sit
 * far apart in specification order. A batching policy that puts every operation in its own unit
 * cannot see a relationship whose two ends are in different units, so a unit size chosen only for
 * speed will silently lose coverage here — which is exactly the regression SC-013 exists to catch.
 */

function schema(partial: Partial<SchemaConstraint> = {}): SchemaConstraint {
  return { required: [], properties: {}, ...partial };
}

/** One producer→consumer edge that dependency analysis is expected to find in `knownRelationshipsApiModel`. */
export interface KnownRelationship {
  /** `METHOD path` of the operation whose response carries the value. */
  producer: string;
  /** The response field carrying it. */
  producerField: string;
  /** `METHOD path` of the operation that consumes it. */
  consumer: string;
  /** The parameter or body field consuming it. */
  consumerField: string;
  /**
   * Distance between producer and consumer in specification order. A unit size at or below this
   * distance cannot place both ends in the same unit, so the relationship becomes unfindable by the
   * AI pass and must fall to deterministic matching or be disclosed as unseen (FR-034).
   */
  operationDistance: number;
}

/**
 * Six operations in a deliberate order: the two ends of each relationship are separated so that
 * unit size demonstrably changes what is findable.
 *
 * Order (index): 0 createTenant, 1 listRegions, 2 createProject, 3 getProjectUsage,
 * 4 createDeployment, 5 getDeploymentLog
 */
export const knownRelationshipsApiModel: ApiModel = {
  operations: [
    {
      path: "/tenants",
      method: "POST",
      operationId: "createTenant",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            required: ["displayName"],
            properties: { displayName: schema({ type: "string" }) },
          }),
        },
      },
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: {
                tenantId: schema({ type: "string", format: "uuid" }),
                displayName: schema({ type: "string" }),
              },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["tenants"],
    },
    {
      path: "/regions",
      method: "GET",
      operationId: "listRegions",
      parameters: [],
      requestBody: undefined,
      responses: [
        {
          statusCode: "200",
          description: "Regions",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: { regionCode: schema({ type: "string" }) },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["regions"],
    },
    {
      path: "/projects",
      method: "POST",
      operationId: "createProject",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            required: ["tenantId", "regionCode"],
            properties: {
              // Consumes createTenant's tenantId (distance 2) and listRegions' regionCode (distance 1).
              tenantId: schema({ type: "string", format: "uuid" }),
              regionCode: schema({ type: "string" }),
              name: schema({ type: "string" }),
            },
          }),
        },
      },
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: {
                projectId: schema({ type: "string", format: "uuid" }),
                tenantId: schema({ type: "string", format: "uuid" }),
              },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["projects"],
    },
    {
      path: "/projects/{projectId}/usage",
      method: "GET",
      operationId: "getProjectUsage",
      parameters: [
        // Consumes createProject's projectId (distance 1).
        { name: "projectId", location: "path", required: true, schema: schema({ type: "string", format: "uuid" }) },
      ],
      requestBody: undefined,
      responses: [
        {
          statusCode: "200",
          description: "Usage",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: { creditsRemaining: schema({ type: "integer" }) },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["projects"],
    },
    {
      path: "/deployments",
      method: "POST",
      operationId: "createDeployment",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            required: ["projectId"],
            properties: {
              // Consumes createProject's projectId (distance 2).
              projectId: schema({ type: "string", format: "uuid" }),
              image: schema({ type: "string" }),
            },
          }),
        },
      },
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: { deploymentId: schema({ type: "string", format: "uuid" }) },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["deployments"],
    },
    {
      path: "/deployments/{deploymentId}/log",
      method: "GET",
      operationId: "getDeploymentLog",
      parameters: [
        // Consumes createDeployment's deploymentId (distance 1).
        { name: "deploymentId", location: "path", required: true, schema: schema({ type: "string", format: "uuid" }) },
      ],
      requestBody: undefined,
      responses: [
        {
          statusCode: "200",
          description: "Log",
          contentTypes: { "text/plain": schema({ type: "string" }) },
          examples: {},
        },
      ],
      security: [],
      tags: ["deployments"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 6, schemaCount: 12, securitySchemeCount: 0, issues: [] },
};

/**
 * The relationships the model above genuinely contains. `analyzeDependencies` is not expected to
 * find every one by AI alone — deterministic matching already covers the exact-name cases — but the
 * count found must not *fall* when unit sizing changes (SC-013).
 */
export const knownRelationships: readonly KnownRelationship[] = [
  { producer: "POST /tenants", producerField: "tenantId", consumer: "POST /projects", consumerField: "tenantId", operationDistance: 2 },
  { producer: "GET /regions", producerField: "regionCode", consumer: "POST /projects", consumerField: "regionCode", operationDistance: 1 },
  { producer: "POST /projects", producerField: "projectId", consumer: "GET /projects/{projectId}/usage", consumerField: "projectId", operationDistance: 1 },
  { producer: "POST /projects", producerField: "projectId", consumer: "POST /deployments", consumerField: "projectId", operationDistance: 2 },
  { producer: "POST /deployments", producerField: "deploymentId", consumer: "GET /deployments/{deploymentId}/log", consumerField: "deploymentId", operationDistance: 1 },
];

/** The largest producer→consumer gap in the fixture; a unit smaller than this cannot see every relationship. */
export const maxOperationDistance = Math.max(...knownRelationships.map((r) => r.operationDistance));
