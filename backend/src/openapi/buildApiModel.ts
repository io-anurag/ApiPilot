import type {
  AnalysisIssue,
  AnalysisSummary,
  ApiInfo,
  ApiModel,
  ApiOperation,
  Parameter,
  RequestBody,
  Response as ApiResponse,
  SchemaConstraint,
  SecurityRequirement,
  SecuritySchemeDefinition,
} from "@apipilot/shared-domain";
import { createLogger } from "../logger";

const logger = createLogger("openapi.buildApiModel");

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/**
 * OpenAPI 3.x constructs this engine deliberately does not extract (FR-013). `allOf` is not
 * among them: unlike `oneOf`/`anyOf` (which branch applies is genuinely ambiguous) or
 * `discriminator` (polymorphic dispatch), `allOf` unambiguously means every branch's constraints
 * apply simultaneously — merging them (see `extractSchemaConstraint` below) is the construct's
 * literal meaning, not a guess, so it is extracted rather than skipped.
 */
const UNSUPPORTED_CONSTRUCTS = ["callbacks", "links", "discriminator", "oneOf", "anyOf", "webhooks"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Safeguard against deeply nested, non-circular schema chains (e.g. adversarially
 * crafted specs) consuming unbounded stack/CPU while extracting constraints (FR-006
 * "safety"; OWASP resource-exhaustion hardening). Extraction simply stops descending
 * past this depth rather than rejecting the whole upload.
 */
const MAX_SCHEMA_DEPTH = 50;

function extractSchemaConstraint(
  node: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): SchemaConstraint {
  if (!isPlainObject(node) || seen.has(node) || depth >= MAX_SCHEMA_DEPTH) {
    return { required: [], properties: {} };
  }
  seen.add(node);
  const constraint: SchemaConstraint = {
    required: Array.isArray(node.required)
      ? (node.required as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
    properties: {},
  };
  if (typeof node.type === "string") constraint.type = node.type;
  if (Array.isArray(node.enum)) constraint.enum = node.enum;
  if (typeof node.format === "string") constraint.format = node.format;
  if (typeof node.minimum === "number") constraint.minimum = node.minimum;
  if (typeof node.maximum === "number") constraint.maximum = node.maximum;
  if (typeof node.pattern === "string") constraint.pattern = node.pattern;
  if (typeof node.minLength === "number") constraint.minLength = node.minLength;
  if (typeof node.maxLength === "number") constraint.maxLength = node.maxLength;
  if (typeof node.minItems === "number") constraint.minItems = node.minItems;
  if (typeof node.maxItems === "number") constraint.maxItems = node.maxItems;
  if (isPlainObject(node.properties)) {
    for (const [key, value] of Object.entries(node.properties)) {
      constraint.properties[key] = extractSchemaConstraint(value, seen, depth + 1);
    }
  }
  if (node.items !== undefined) {
    constraint.items = extractSchemaConstraint(node.items, seen, depth + 1);
  }
  mergeAllOfBranches(node.allOf, constraint, seen, depth);
  return constraint;
}

/** Extracts and folds in every `allOf` branch's constraint, when `allOf` is declared (see `mergeSchemaConstraint`). */
function mergeAllOfBranches(
  allOf: unknown,
  constraint: SchemaConstraint,
  seen: WeakSet<object>,
  depth: number,
): void {
  if (!Array.isArray(allOf)) return;
  for (const branch of allOf) {
    mergeSchemaConstraint(constraint, extractSchemaConstraint(branch, seen, depth + 1));
  }
}

/**
 * Folds an `allOf` branch's already-extracted constraint into the composing node's own
 * (`extractSchemaConstraint` above) — `allOf` means every branch applies simultaneously, so this
 * is the construct's literal meaning rather than a guess. `required` names union (order of first
 * appearance); a `properties` key keeps whichever branch declared it first (the composing node's
 * own properties, having been extracted before any branch is merged in, always win); every scalar
 * constraint keeps the first value seen for the same reason. A real conflict between branches
 * (e.g. two incompatible `type`s) is not reported — the composed schema still legitimately limits
 * scenarios to the intersection this resolves, it just does not surface as a distinct issue.
 */
function mergeSchemaConstraint(into: SchemaConstraint, branch: SchemaConstraint): void {
  for (const name of branch.required) {
    if (!into.required.includes(name)) into.required.push(name);
  }
  for (const [key, value] of Object.entries(branch.properties)) {
    if (!(key in into.properties)) into.properties[key] = value;
  }
  into.type ??= branch.type;
  into.enum ??= branch.enum;
  into.format ??= branch.format;
  into.minimum ??= branch.minimum;
  into.maximum ??= branch.maximum;
  into.pattern ??= branch.pattern;
  into.minLength ??= branch.minLength;
  into.maxLength ??= branch.maxLength;
  into.minItems ??= branch.minItems;
  into.maxItems ??= branch.maxItems;
  into.items ??= branch.items;
}


/** Counts a schema node and all nested property/item schemas (for AnalysisSummary.schemaCount). */
function countSchemas(node: unknown, seen: WeakSet<object> = new WeakSet()): number {
  if (!isPlainObject(node) || seen.has(node)) return 0;
  seen.add(node);
  let count = 1;
  if (isPlainObject(node.properties)) {
    for (const value of Object.values(node.properties)) {
      count += countSchemas(value, seen);
    }
  }
  if (node.items !== undefined) {
    count += countSchemas(node.items, seen);
  }
  return count;
}

function findUnsupportedConstructs(
  node: unknown,
  path: string,
  issues: AnalysisIssue[],
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (!isPlainObject(node) || seen.has(node)) return;
  seen.add(node);
  for (const construct of UNSUPPORTED_CONSTRUCTS) {
    if (construct in node) {
      issues.push({
        kind: "unsupported-construct",
        location: path,
        message: `Unsupported OpenAPI construct "${construct}" was found and is not processed`,
      });
    }
  }
  // Recorded informationally, not as `unsupported-construct` — extractSchemaConstraint above
  // does merge these branches into real constraints, so scenarios ARE generated from them.
  if (Array.isArray(node.allOf)) {
    issues.push({
      kind: "composed-schema",
      location: path,
      message: `Schema constraints were merged from ${node.allOf.length} allOf branch${node.allOf.length === 1 ? "" : "es"}`,
    });
  }
  for (const [key, value] of Object.entries(node)) {
    findUnsupportedConstructs(value, `${path}/${key}`, issues, seen);
  }
}

function extractContentTypes(content: unknown): Record<string, SchemaConstraint> {
  const result: Record<string, SchemaConstraint> = {};
  if (!isPlainObject(content)) return result;
  for (const [mediaType, mediaObj] of Object.entries(content)) {
    result[mediaType] =
      isPlainObject(mediaObj) && mediaObj.schema !== undefined
        ? extractSchemaConstraint(mediaObj.schema)
        : { required: [], properties: {} };
  }
  return result;
}

function extractExamples(content: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!isPlainObject(content)) return result;
  for (const mediaObj of Object.values(content)) {
    if (!isPlainObject(mediaObj)) continue;
    if (mediaObj.example !== undefined) {
      result.example = mediaObj.example;
    }
    if (isPlainObject(mediaObj.examples)) {
      for (const [name, example] of Object.entries(mediaObj.examples)) {
        result[name] = isPlainObject(example) && "value" in example ? example.value : example;
      }
    }
  }
  return result;
}

function extractParameters(rawParams: unknown): Parameter[] {
  if (!Array.isArray(rawParams)) return [];
  const parameters: Parameter[] = [];
  for (const p of rawParams) {
    if (!isPlainObject(p) || typeof p.name !== "string") continue;
    const location: Parameter["location"] =
      p.in === "path" || p.in === "query" || p.in === "header" || p.in === "cookie" ? p.in : "query";
    parameters.push({
      name: p.name,
      location,
      required: p.required === true || location === "path",
      schema: extractSchemaConstraint(p.schema),
      ...(typeof p.style === "string" ? { style: p.style } : {}),
      ...(typeof p.explode === "boolean" ? { explode: p.explode } : {}),
      // A `content`-based parameter (media-type-encoded value) is mutually exclusive with
      // `schema`+`style` per OpenAPI 3.x; `style`/`explode` are meaningless when this is true
      // (specs/022-openapi-parameter-serialization research.md D7).
      ...(isPlainObject(p.content) ? { contentEncoded: true } : {}),
    });
  }
  return parameters;
}

function extractRequestBody(rawBody: unknown): RequestBody | undefined {
  if (!isPlainObject(rawBody)) return undefined;
  return {
    required: rawBody.required === true,
    contentTypes: extractContentTypes(rawBody.content),
  };
}

function extractResponses(rawResponses: unknown): ApiResponse[] {
  if (!isPlainObject(rawResponses)) return [];
  const responses: ApiResponse[] = [];
  for (const [statusCode, value] of Object.entries(rawResponses)) {
    if (!isPlainObject(value)) continue;
    responses.push({
      statusCode,
      description: typeof value.description === "string" ? value.description : "",
      contentTypes: extractContentTypes(value.content),
      examples: extractExamples(value.content),
    });
  }
  return responses;
}

/** Preserves security requirements as a raw OR-of-ANDs list; never flattened (research.md decision 6). */
function extractSecurity(rawSecurity: unknown): SecurityRequirement[] {
  if (!Array.isArray(rawSecurity)) return [];
  const requirements: SecurityRequirement[] = [];
  for (const entry of rawSecurity) {
    if (!isPlainObject(entry)) continue;
    const schemes = Object.entries(entry).map(([name, scopes]) => ({
      name,
      scopes: Array.isArray(scopes) ? (scopes as unknown[]).filter((s): s is string => typeof s === "string") : [],
    }));
    requirements.push({ schemes });
  }
  return requirements;
}

/** The document's `info.title`/`info.version`, when `info.title` is a non-empty string (never fabricated). */
function extractInfo(document: Record<string, unknown>): ApiInfo | undefined {
  const info = document.info;
  if (!isPlainObject(info) || typeof info.title !== "string" || info.title.trim().length === 0) {
    return undefined;
  }
  return {
    title: info.title,
    version: typeof info.version === "string" ? info.version : "",
  };
}

/**
 * Reads `flows.clientCredentials` off a raw `oauth2` scheme node, verbatim, when present
 * (FR-001). `scopes` is an OpenAPI object mapping scope-identifier → human-readable description;
 * only the identifiers are needed for the grant request (FR-005), kept in declaration order
 * rather than re-sorted. A missing/non-string `tokenUrl` yields no `flows` at all — never a
 * fabricated placeholder URL.
 */
function extractClientCredentialsFlow(
  value: Record<string, unknown>,
): SecuritySchemeDefinition["flows"] | undefined {
  const flows = value.flows;
  if (!isPlainObject(flows) || !isPlainObject(flows.clientCredentials)) return undefined;
  const tokenUrl = flows.clientCredentials.tokenUrl;
  if (typeof tokenUrl !== "string" || tokenUrl.length === 0) return undefined;
  const scopes = flows.clientCredentials.scopes;
  return {
    clientCredentials: {
      tokenUrl,
      scopes: isPlainObject(scopes) ? Object.keys(scopes) : [],
    },
  };
}

function extractSecuritySchemes(document: Record<string, unknown>): Record<string, SecuritySchemeDefinition> {
  const components = document.components;
  const schemes: Record<string, SecuritySchemeDefinition> = {};
  if (!isPlainObject(components) || !isPlainObject(components.securitySchemes)) return schemes;
  for (const [name, value] of Object.entries(components.securitySchemes)) {
    if (!isPlainObject(value) || typeof value.type !== "string") continue;
    const flows = value.type === "oauth2" ? extractClientCredentialsFlow(value) : undefined;
    schemes[name] = {
      type: value.type,
      scheme: typeof value.scheme === "string" ? value.scheme : undefined,
      in: typeof value.in === "string" ? value.in : undefined,
      name: typeof value.name === "string" ? value.name : undefined,
      ...(flows ? { flows } : {}),
    };
  }
  return schemes;
}

/**
 * Builds the normalized ApiModel from a validated/dereferenced OpenAPI document
 * (FR-007–FR-013). `priorIssues` carries forward ref-related issues found during
 * validateSpec (unresolved-ref / circular-ref); this function appends
 * duplicate-operation and unsupported-construct issues.
 */
export function buildApiModel(document: Record<string, unknown>, priorIssues: AnalysisIssue[]): ApiModel {
  logger.info("build_start");
  const issues: AnalysisIssue[] = [...priorIssues];
  const operations: ApiOperation[] = [];
  const seenOperationIds = new Map<string, number>();
  const seenPathMethod = new Set<string>();
  let schemaCount = 0;

  const paths = document.paths;
  if (isPlainObject(paths)) {
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!isPlainObject(pathItem)) continue;
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!isPlainObject(operation)) continue;

        const operationId = typeof operation.operationId === "string" ? operation.operationId : undefined;
        const upperMethod = method.toUpperCase();
        const location = `#/paths/${path}/${method}`;
        const pathMethodKey = `${upperMethod} ${path}`;

        if (operationId) {
          const count = (seenOperationIds.get(operationId) ?? 0) + 1;
          seenOperationIds.set(operationId, count);
          if (count > 1) {
            issues.push({
              kind: "duplicate-operation",
              location,
              message: `Duplicate operationId "${operationId}" is also used elsewhere in this specification`,
            });
          }
        }
        if (seenPathMethod.has(pathMethodKey)) {
          issues.push({
            kind: "duplicate-operation",
            location,
            message: `Duplicate path+method combination: ${pathMethodKey}`,
          });
        }
        seenPathMethod.add(pathMethodKey);

        const requestBody = extractRequestBody(operation.requestBody);
        const responses = extractResponses(operation.responses);
        const parameters = extractParameters(operation.parameters);

        if (requestBody) {
          for (const schema of Object.values(requestBody.contentTypes)) schemaCount += countSchemas(schema);
        }
        for (const response of responses) {
          for (const schema of Object.values(response.contentTypes)) schemaCount += countSchemas(schema);
        }
        for (const parameter of parameters) {
          schemaCount += countSchemas(parameter.schema);
        }

        // Explicit operation-level security (including an empty array override) always
        // wins over the document-level default; only fall back when truly absent.
        const security = extractSecurity(operation.security ?? document.security);

        operations.push({
          path,
          method: upperMethod,
          operationId,
          parameters,
          requestBody,
          responses,
          security,
          tags: Array.isArray(operation.tags)
            ? (operation.tags as unknown[]).filter((t): t is string => typeof t === "string")
            : [],
        });

        findUnsupportedConstructs(operation, location, issues);
      }
    }
  }

  const securitySchemes = extractSecuritySchemes(document);

  const summary: AnalysisSummary = {
    operationCount: operations.length,
    schemaCount,
    securitySchemeCount: Object.keys(securitySchemes).length,
    issues,
  };

  logger.info("build_success", {
    operationCount: summary.operationCount,
    schemaCount: summary.schemaCount,
    issueCount: summary.issues.length,
  });
  return { operations, securitySchemes, summary, info: extractInfo(document) };
}
