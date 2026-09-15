import type { ApiModel, ApiOperation, Parameter, SchemaConstraint } from "@apipilot/shared-domain";

/**
 * Fixtures for AP-022 specification-conformant parameter serialization tests. Deliberately
 * separate from `exportFixtures.ts` so every pre-existing scalar-only fixture stays
 * byte-identical (SC-004) — nothing here is imported by a test that predates this feature.
 * Covers every row of contracts/parameter-serialization.md's conformance table.
 */

function schema(partial: Partial<SchemaConstraint> = {}): SchemaConstraint {
  return { required: [], properties: {}, ...partial };
}

function queryParam(overrides: Partial<Parameter> & Pick<Parameter, "name">): Parameter {
  return {
    location: "query",
    required: false,
    schema: schema({ type: "array" }),
    ...overrides,
  };
}

// --- Query, array-typed, every implemented style (Acceptance Scenarios 1-3) ---

/** No declared style/explode — resolves to the query default (`form`, `explode: true`). */
export const sortDefaultParam = queryParam({ name: "sort" });

export const sortFormExplodeTrueParam = queryParam({ name: "sort", style: "form", explode: true });
export const sortFormExplodeFalseParam = queryParam({ name: "sort", style: "form", explode: false });
export const sortSpaceDelimitedParam = queryParam({ name: "sort", style: "spaceDelimited", explode: false });
export const sortPipeDelimitedParam = queryParam({ name: "sort", style: "pipeDelimited", explode: false });

// --- Query, object-typed, every implemented style (Acceptance Scenarios 4-5) ---

function objectQueryParam(overrides: Partial<Parameter> & Pick<Parameter, "name">): Parameter {
  return {
    location: "query",
    required: false,
    schema: schema({ type: "object", properties: { status: schema({ type: "string" }), owner: schema({ type: "string" }) } }),
    ...overrides,
  };
}

export const filterDeepObjectParam = objectQueryParam({ name: "filter", style: "deepObject" });
export const filterFormExplodeTrueParam = objectQueryParam({ name: "filter", style: "form", explode: true });
export const filterFormExplodeFalseParam = objectQueryParam({ name: "filter", style: "form", explode: false });

// --- Path/header, `simple` style (FR-005, research.md D4) ---

/** No declared style/explode — resolves to the path/header default (`simple`, `explode: false`). */
export const idSimplePathParam: Parameter = {
  name: "id",
  location: "path",
  required: true,
  schema: schema({ type: "array" }),
};

export const tagsSimpleHeaderParam: Parameter = {
  name: "X-Tags",
  location: "header",
  required: false,
  schema: schema({ type: "array" }),
};

// --- Unimplemented styles / content-encoded (FR-007) ---

export const coordsMatrixPathParam: Parameter = {
  name: "coords",
  location: "path",
  required: true,
  schema: schema({ type: "array" }),
  style: "matrix",
};

export const coordsLabelPathParam: Parameter = {
  name: "coords",
  location: "path",
  required: true,
  schema: schema({ type: "array" }),
  style: "label",
};

export const metadataContentEncodedParam = queryParam({
  name: "metadata",
  schema: schema({ type: "object" }),
  contentEncoded: true,
});

function op(overrides: Partial<ApiOperation> & Pick<ApiOperation, "path" | "method" | "parameters">): ApiOperation {
  return {
    operationId: undefined,
    requestBody: undefined,
    responses: [],
    security: [],
    tags: [],
    ...overrides,
  };
}

/** `GET /catalog` with an array query parameter under the default style (`form`/`explode:true`). */
export const sortDefaultOperation = op({
  path: "/catalog",
  method: "GET",
  operationId: "listCatalog",
  parameters: [sortDefaultParam],
});

/** `GET /catalog/filter` with an object query parameter under `deepObject`. */
export const filterDeepObjectOperation = op({
  path: "/catalog/filter",
  method: "GET",
  operationId: "filterCatalog",
  parameters: [filterDeepObjectParam],
});

/** `GET /items/{id}` with an array path parameter under the default `simple` style. */
export const idSimplePathOperation = op({
  path: "/items/{id}",
  method: "GET",
  operationId: "getItem",
  parameters: [idSimplePathParam],
});

/** `GET /items` with an array header parameter under the default `simple` style. */
export const tagsSimpleHeaderOperation = op({
  path: "/items",
  method: "GET",
  operationId: "listItemsByTag",
  parameters: [tagsSimpleHeaderParam],
});

/** `GET /locations/{coords}` with a `matrix`-style path parameter (unimplemented — FR-007). */
export const coordsMatrixOperation = op({
  path: "/locations/{coords}",
  method: "GET",
  operationId: "getLocation",
  parameters: [coordsMatrixPathParam],
});

/** `GET /locations-label/{coords}` with a `label`-style path parameter (unimplemented — FR-007). */
export const coordsLabelOperation = op({
  path: "/locations-label/{coords}",
  method: "GET",
  operationId: "getLocationByLabel",
  parameters: [coordsLabelPathParam],
});

/** `GET /export` with a content-encoded query parameter (unimplemented — FR-007). */
export const metadataContentEncodedOperation = op({
  path: "/export",
  method: "GET",
  operationId: "exportData",
  parameters: [metadataContentEncodedParam],
});

/** Full ApiModel bundling every operation above, for end-to-end integration tests. */
export const parameterApiModel: ApiModel = {
  operations: [
    sortDefaultOperation,
    filterDeepObjectOperation,
    idSimplePathOperation,
    tagsSimpleHeaderOperation,
    coordsMatrixOperation,
    coordsLabelOperation,
    metadataContentEncodedOperation,
  ],
  securitySchemes: {},
  summary: {
    operationCount: 7,
    schemaCount: 0,
    securitySchemeCount: 0,
    issues: [],
  },
};
