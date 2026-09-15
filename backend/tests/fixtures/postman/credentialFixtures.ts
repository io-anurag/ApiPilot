import type {
  ApiDependencyRelationship,
  ApiModel,
  ApiOperation,
  SchemaConstraint,
  SecuritySchemeDefinition,
  TestScenario,
} from "@apipilot/shared-domain";

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

/**
 * Sole unauthenticated operation whose path contains `adminAuth`'s stem "admin" — FR-006 success
 * case. Its response documents exactly one string field, so it also qualifies as an
 * auth-credential producer under specs/023-auto-auth-credential-chaining FR-003.
 */
export const adminLoginOperation = op({
  path: "/auth/admin-login",
  method: "POST",
  operationId: "adminLogin",
  responses: [
    {
      statusCode: "200",
      description: "OK",
      contentTypes: {
        "application/json": {
          required: [],
          properties: { adminToken: { type: "string", required: [], properties: {} } },
        },
      },
      examples: {},
    },
  ],
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

/**
 * Fixtures for specs/023-auto-auth-credential-chaining tests: the primary/default scheme's own
 * producer-and-consumer flagship case, field-shape ambiguity variants, a second independent
 * scheme, a primary scheme whose login endpoint's stem does not match, a `basic` scheme that
 * never chains, and a mixed producer-group case (research.md D7). Nothing above this point is
 * modified by this section.
 */

/**
 * Sole `http`/`bearer` scheme, key `tokenAuth` (stem "token") — the common single-scheme case
 * used for primary-scheme producer discovery (Clarifications 2026-09-15, FR-002). The key is
 * deliberately chosen so its stem actually appears in the flagship producer's path
 * ("/auth/token") and operationId ("issueToken") — unlike an illustrative key such as
 * "bearerAuth", whose stem "bearer" would not (that mismatch is exactly what
 * `primaryNoStemMatchApiModel` below exercises instead).
 */
export const tokenAuthScheme: Record<string, SecuritySchemeDefinition> = {
  tokenAuth: { type: "http", scheme: "bearer" },
};

/** `tokenAuth` declared first (primary), `adminAuth` declared second (secondary) — the
 *  two-independent-schemes case (User Story 2). */
export const tokenAndAdminSchemes: Record<string, SecuritySchemeDefinition> = {
  tokenAuth: { type: "http", scheme: "bearer" },
  adminAuth: { type: "http", scheme: "bearer" },
};

/** A standalone `http`/`basic` scheme — never a producer/consumer chain target (FR-002a). */
export const basicOnlyScheme: Record<string, SecuritySchemeDefinition> = {
  basicAuth: { type: "http", scheme: "basic" },
};

/** A standalone `http`/`bearer` scheme whose key's stem will not match the login endpoint below
 *  (Clarifications 2026-09-15 Q3). */
export const bearerAuthOnlyScheme: Record<string, SecuritySchemeDefinition> = {
  bearerAuth: { type: "http", scheme: "bearer" },
};

function stringField(): SchemaConstraint {
  return { type: "string", required: [], properties: {} };
}

function booleanField(): SchemaConstraint {
  return { type: "boolean", required: [], properties: {} };
}

function jsonResponse(properties: Record<string, SchemaConstraint>) {
  return {
    statusCode: "200",
    description: "OK",
    contentTypes: { "application/json": { required: [], properties } },
    examples: {},
  };
}

/** Unauthenticated login issuing the primary scheme's token; response documents exactly one
 *  plausible credential field — the flagship producer (User Story 1). */
export const issueTokenOperation = op({
  path: "/auth/token",
  method: "POST",
  operationId: "issueToken",
  responses: [jsonResponse({ token: stringField() })],
});

/** Same producer identity, but its response documents two equally plausible string fields — the
 *  field-shape-ambiguity case (User Story 3, FR-004). */
export const issueTokenAmbiguousFieldsOperation = op({
  path: "/auth/token",
  method: "POST",
  operationId: "issueToken",
  responses: [jsonResponse({ token: stringField(), refreshToken: stringField() })],
});

/** Same producer identity, but its response documents zero plausible (string-typed) fields — the
 *  zero-field case (User Story 3, FR-004). */
export const issueTokenNoPlausibleFieldOperation = op({
  path: "/auth/token",
  method: "POST",
  operationId: "issueToken",
  responses: [jsonResponse({ success: booleanField() })],
});

/** Consumes the primary scheme's credential (User Story 1). */
export const tokenInfoOperation = op({
  path: "/auth/token-info",
  method: "GET",
  operationId: "getTokenInfo",
  security: [{ schemes: [{ name: "tokenAuth", scopes: [] }] }],
});

/** A second operation declaring the primary scheme, to exercise fan-out (one producer, several
 *  consumers, FR-009). */
export const tokenProfileOperation = op({
  path: "/auth/token-profile",
  method: "GET",
  operationId: "getTokenProfile",
  security: [{ schemes: [{ name: "tokenAuth", scopes: [] }] }],
});

/** A path-parameter consumer of the same field name ("token") the flagship producer returns —
 *  used only by the mixed producer-group case (research.md D7), where one producer field
 *  simultaneously qualifies as an auth-credential producer and an ordinary path-parameter
 *  producer. */
export const tokenPathConsumerOperation = op({
  path: "/items/{token}",
  method: "GET",
  operationId: "getItemByToken",
  parameters: [
    { name: "token", location: "path", required: true, schema: { type: "string", required: [], properties: {} } },
  ],
});

/** Unauthenticated producer for the second, distinctly-keyed `adminAuth` scheme (User Story 2) —
 *  matches `adminAuth`'s stem "admin"; response documents exactly one plausible field. */
export const issueAdminTokenOperation = op({
  path: "/auth/admin-login",
  method: "POST",
  operationId: "adminLogin",
  responses: [jsonResponse({ adminToken: stringField() })],
});

/** Consumes the second scheme's credential (User Story 2). Deliberately grouped under the same
 *  "/auth/..." folder as its producer (`issueAdminTokenOperation`, path-sorted before it), rather
 *  than e.g. "/admin/reports" — `groupAndName` groups by first path segment, and a folder that
 *  sorted before "auth" would trip the FR-015 ordering guard for reasons unrelated to what this
 *  fixture is meant to test. */
export const adminReportsOperation = op({
  path: "/auth/admin-reports",
  method: "GET",
  operationId: "listAdminReports",
  security: [{ schemes: [{ name: "adminAuth", scopes: [] }] }],
});

/** Primary scheme's login endpoint whose path/operationId does *not* contain the scheme key's own
 *  stem ("bearer") — the no-stem-match edge case (Clarifications 2026-09-15 Q3): the export must
 *  not fall back to a looser, name-convention heuristic. */
export const createSessionOperation = op({
  path: "/session",
  method: "POST",
  operationId: "createSession",
  responses: [jsonResponse({ id: stringField() })],
});

/** Consumes `bearerAuthOnlyScheme`'s credential, so the resulting limitation has a dependent
 *  operation to list. */
export const sessionInfoOperation = op({
  path: "/session-info",
  method: "GET",
  operationId: "getSessionInfo",
  security: [{ schemes: [{ name: "bearerAuth", scopes: [] }] }],
});

/** A `http`/`basic` scheme's own consumer — always falls through to the limitation (FR-002a). */
export const basicProtectedOperation = op({
  path: "/basic/settings",
  method: "GET",
  operationId: "getBasicSettings",
  security: [{ schemes: [{ name: "basicAuth", scopes: [] }] }],
});

/** Full ApiModel: the flagship User Story 1 case — one producer, one consumer, primary scheme. */
export const flagshipTokenApiModel = apiModel([issueTokenOperation, tokenInfoOperation], tokenAuthScheme);

/** Full ApiModel: the flagship producer feeding two consumers (fan-out, FR-009). */
export const flagshipTokenFanOutApiModel = apiModel(
  [issueTokenOperation, tokenInfoOperation, tokenProfileOperation],
  tokenAuthScheme,
);

/** Full ApiModel: field-shape ambiguity (two plausible fields) — no chain, limitation recorded. */
export const ambiguousFieldsApiModel = apiModel(
  [issueTokenAmbiguousFieldsOperation, tokenInfoOperation],
  tokenAuthScheme,
);

/** Full ApiModel: zero plausible fields — no chain, limitation recorded. */
export const noPlausibleFieldApiModel = apiModel(
  [issueTokenNoPlausibleFieldOperation, tokenInfoOperation],
  tokenAuthScheme,
);

/** Full ApiModel: two independent schemes, each with its own producer and consumer (User Story 2, SC-002). */
export const twoIndependentSchemesApiModel = apiModel(
  [issueTokenOperation, tokenInfoOperation, issueAdminTokenOperation, adminReportsOperation],
  tokenAndAdminSchemes,
);

/** Full ApiModel: the primary scheme's login endpoint does not match its own stem — no candidate,
 *  limitation recorded (Clarifications 2026-09-15 Q3). */
export const primaryNoStemMatchApiModel = apiModel(
  [createSessionOperation, sessionInfoOperation],
  bearerAuthOnlyScheme,
);

/** Full ApiModel: a `http`/`basic` scheme with its own consumer — never auto-chained (FR-002a). */
export const basicSchemeApiModel = apiModel([basicProtectedOperation], basicOnlyScheme);

/** Full ApiModel for the mixed producer-group case (research.md D7): the flagship producer, its
 *  auth consumer, and an unrelated path-parameter consumer sharing the same producer field. */
export const mixedProducerGroupApiModel = apiModel(
  [issueTokenOperation, tokenInfoOperation, tokenPathConsumerOperation],
  tokenAuthScheme,
);

/** The flagship producer's field as an auth-credential relationship into `tokenInfoOperation` —
 *  built directly (rather than via `buildAuthCredentialRelationships`) since
 *  `automaticChaining.test.ts` exercises `planAutomaticChains` in isolation, supplying
 *  relationships as direct input. Used standalone, and combined with
 *  `tokenPathRelationship()` for the mixed producer-group case (research.md D7). */
export function tokenAuthRelationship(): ApiDependencyRelationship {
  return {
    id: "rel-token-auth",
    producer: { operationPath: issueTokenOperation.path, operationMethod: issueTokenOperation.method, field: "token" },
    consumer: {
      operationPath: tokenInfoOperation.path,
      operationMethod: tokenInfoOperation.method,
      field: "tokenAuth",
      location: "auth",
    },
    confidence: "CONFIRMED",
    source: "deterministic",
    explanation: "Auth-credential relationship fixture for automaticChaining unit tests.",
  };
}

/** The same flagship producer field as an ordinary "path" relationship into
 *  `tokenPathConsumerOperation`'s "token" path parameter, via ordinary name-based matching —
 *  unrelated to (but sharing a producer field with) `tokenAuthRelationship()`, for the mixed
 *  producer-group case (research.md D7). */
export function tokenPathRelationship(): ApiDependencyRelationship {
  return {
    id: "rel-token-path",
    producer: { operationPath: issueTokenOperation.path, operationMethod: issueTokenOperation.method, field: "token" },
    consumer: {
      operationPath: tokenPathConsumerOperation.path,
      operationMethod: tokenPathConsumerOperation.method,
      field: "token",
      location: "path",
    },
    confidence: "CONFIRMED",
    source: "deterministic",
    evidence: { nameMatch: true, typeMatch: true, formatMatch: false, resourceRelationship: false, tagAlignment: false },
    explanation: "Ordinary path-parameter relationship fixture for the mixed producer-group unit test.",
  };
}

/** Builds an approved positive `TestScenario` for one of this file's operations, with the given
 *  request shape. Mirrors `dependencyFixtures.ts`'s own (non-exported) `ruleScenario` shape. */
function scenario(
  id: string,
  operation: ApiOperation,
  overrides: Partial<TestScenario> = {},
): TestScenario {
  return {
    id,
    operationPath: operation.path,
    operationMethod: operation.method,
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions: [{ type: "status-code", expectedStatusCode: "200" }],
    provenance: { source: "RULE", rule: "positive", description: `Deterministic scenario ${id}.`, duplicateOfRules: [] },
    ...overrides,
  };
}

export const issueTokenScenario = scenario("scenario-issue-token", issueTokenOperation);
export const tokenInfoScenario = scenario("scenario-token-info", tokenInfoOperation);
export const tokenProfileScenario = scenario("scenario-token-profile", tokenProfileOperation);
export const issueAdminTokenScenario = scenario("scenario-issue-admin-token", issueAdminTokenOperation);
export const adminReportsScenario = scenario("scenario-admin-reports", adminReportsOperation);
export const createSessionScenario = scenario("scenario-create-session", createSessionOperation, {
  request: {
    pathParameters: {},
    queryParameters: {},
    headers: {},
    body: { username: "qa", password: "hunter2" },
  },
  assertions: [{ type: "status-code", expectedStatusCode: "201" }],
});
export const sessionInfoScenario = scenario("scenario-session-info", sessionInfoOperation);
export const basicProtectedScenario = scenario("scenario-basic-protected", basicProtectedOperation);
/** Approved but deliberately leaves the "token" path parameter unresolved, so it is a target for
 *  the mixed producer-group's ordinary path-parameter chain. */
export const tokenPathConsumerScenario = scenario("scenario-token-path-consumer", tokenPathConsumerOperation);
/** Same producer field/shape as `issueTokenScenario` — reused instead of duplicated where a test
 *  only needs the ambiguous/zero-field ApiModel's producer scenario. */
export const issueTokenAmbiguousFieldsScenario = scenario(
  "scenario-issue-token-ambiguous",
  issueTokenAmbiguousFieldsOperation,
);
export const issueTokenNoPlausibleFieldScenario = scenario(
  "scenario-issue-token-no-plausible-field",
  issueTokenNoPlausibleFieldOperation,
);
