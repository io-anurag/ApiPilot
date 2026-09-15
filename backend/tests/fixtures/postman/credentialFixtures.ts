import type { ApiModel, ApiOperation, SecuritySchemeDefinition } from "@apipilot/shared-domain";

/**
 * Fixtures for AP-021 distinct-credential provisioning tests. Deliberately separate from
 * `exportFixtures.ts` so every pre-existing single-scheme test's fixture stays byte-identical
 * (SC-001) — nothing here is ever imported by a test that predates this feature.
 */

/** Two `http`/`bearer` schemes, `bearerAuth` declared first — primacy fixture (FR-002/FR-003). */
export const twoBearerSchemes: Record<string, SecuritySchemeDefinition> = {
  bearerAuth: { type: "http", scheme: "bearer" },
  adminAuth: { type: "http", scheme: "bearer" },
};

/** Two `apiKey` schemes sharing the same header name but different keys (Acceptance Scenario 3). */
export const twoApiKeySchemesSameHeader: Record<string, SecuritySchemeDefinition> = {
  apiKeyAuth: { type: "apiKey", in: "header", name: "X-Api-Key" },
  partnerApiKeyAuth: { type: "apiKey", in: "header", name: "X-Api-Key" },
};

/** A non-primary scheme key with no trailing `Auth`/`Scheme` suffix to strip (FR-003). */
export const noSuffixSchemes: Record<string, SecuritySchemeDefinition> = {
  bearerAuth: { type: "http", scheme: "bearer" },
  partnerCredential: { type: "http", scheme: "bearer" },
};

function op(overrides: Partial<ApiOperation> & Pick<ApiOperation, "path" | "method">): ApiOperation {
  return {
    operationId: undefined,
    parameters: [],
    requestBody: undefined,
    responses: [],
    security: [],
    tags: [],
    ...overrides,
  };
}

/** Operation under the primary scheme (`bearerAuth`). */
export const bearerAuthOperation = op({
  path: "/orders",
  method: "GET",
  operationId: "listOrders",
  security: [{ schemes: [{ name: "bearerAuth", scopes: [] }] }],
});

/** Operation under the distinct scheme (`adminAuth`). */
export const adminAuthOperation = op({
  path: "/reports",
  method: "GET",
  operationId: "listReports",
  security: [{ schemes: [{ name: "adminAuth", scopes: [] }] }],
});

/** Sole unauthenticated operation whose path contains `adminAuth`'s stem "admin" — FR-006 success case. */
export const adminLoginOperation = op({
  path: "/auth/admin-login",
  method: "POST",
  operationId: "adminLogin",
});

/** Regular unauthenticated login; path/operationId do not contain "admin". */
export const regularLoginOperation = op({
  path: "/auth/login",
  method: "POST",
  operationId: "login",
});

/** A second, equally-plausible unauthenticated operation also matching "admin" — ambiguous-match case. */
export const ambiguousAdminOperation = op({
  path: "/auth/admin-signup",
  method: "POST",
  operationId: "adminSignup",
});

/** An *authenticated* operation whose path still contains "admin" — must never be selected as a producer. */
export const authenticatedAdminLookingOperation = op({
  path: "/admin/settings",
  method: "GET",
  operationId: "adminSettings",
  security: [{ schemes: [{ name: "adminAuth", scopes: [] }] }],
});

/** Operation set: exactly one unauthenticated operation matches `adminAuth`'s stem (producer found). */
export const operationsWithDiscoverableProducer: ApiOperation[] = [
  regularLoginOperation,
  adminLoginOperation,
  bearerAuthOperation,
  adminAuthOperation,
];

/** Operation set: two unauthenticated operations both match `adminAuth`'s stem (ambiguous, no candidate). */
export const operationsWithAmbiguousProducer: ApiOperation[] = [
  adminLoginOperation,
  ambiguousAdminOperation,
  bearerAuthOperation,
  adminAuthOperation,
];

/** Operation set: no unauthenticated operation at all (no candidate). */
export const operationsWithNoProducer: ApiOperation[] = [
  bearerAuthOperation,
  adminAuthOperation,
];

function apiModel(
  operations: ApiOperation[],
  securitySchemes: Record<string, SecuritySchemeDefinition>,
): ApiModel {
  return {
    operations,
    securitySchemes,
    summary: {
      operationCount: operations.length,
      schemaCount: 0,
      securitySchemeCount: Object.keys(securitySchemes).length,
      issues: [],
    },
  };
}

/** Full ApiModel: two bearer schemes, no discoverable producer for `adminAuth`. */
export const twoBearerSchemeApiModel = apiModel(operationsWithNoProducer, twoBearerSchemes);

/** Full ApiModel: two bearer schemes, `POST /auth/admin-login` is `adminAuth`'s sole producer candidate. */
export const discoverableProducerApiModel = apiModel(operationsWithDiscoverableProducer, twoBearerSchemes);

/** Full ApiModel: two bearer schemes, two equally-plausible unauthenticated operations for `adminAuth`. */
export const ambiguousProducerApiModel = apiModel(operationsWithAmbiguousProducer, twoBearerSchemes);

/** Full ApiModel: two bearer schemes, zero unauthenticated operations. */
export const noProducerApiModel = apiModel(operationsWithNoProducer, twoBearerSchemes);
