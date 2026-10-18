import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { InvalidDefinitionError } from "../errors";
import { API_DEFINITION_SCHEMA_V1 } from "./definitionSchema";
import type { ApiDefinitionV1 } from "./types";

/**
 * Strict validation of an ApiPilot API definition, version 1 (specs/056 FR-023, FR-024, contracts/
 * api-definition-format-v1.md).
 *
 * Two passes, merged into one list so every violation is reported at once:
 *
 * 1. Structure: the JSON Schema, compiled once by Ajv with `strict: true` and `allErrors: true`.
 *    Every Ajv error is rewritten to a corrective message of the form `"<JSON Pointer>: <message>"`;
 *    Ajv's own wording is never returned, and alternatives inside `oneOf` collapse to one message per
 *    location.
 * 2. Cross-checks the schema cannot express: duplicate operations and ids, path parameters against
 *    the path template, response statuses, URLs, security references, hint targets, and embedded
 *    schema consistency. These tolerate a structurally broken document (they skip what is not the
 *    expected shape), so structure and semantic problems appear together.
 *
 * Nothing is fetched or resolved: the schema and the document are plain data. A message may echo a
 * field name or an identifier from the document (truncated to printable characters); it never echoes a
 * value.
 */

const MAX_PROBLEMS = 100;
const MAX_ECHO_LENGTH = 64;

interface Problem {
  pointer: string;
  message: string;
}

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv({ allErrors: true, strict: true });
    compiled = ajv.compile(API_DEFINITION_SCHEMA_V1);
  }
  return compiled;
}

/** A document-supplied name made safe to show: printable ASCII only, truncated. */
function echo(text: string): string {
  const printable = text.replace(/[^\x20-\x7e]/g, "?");
  return printable.length > MAX_ECHO_LENGTH ? `${printable.slice(0, MAX_ECHO_LENGTH)}...` : printable;
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function lastSegment(pointer: string): string {
  const index = pointer.lastIndexOf("/");
  return index < 0 ? pointer : pointer.slice(index + 1);
}

const STATUS_MESSAGE = "must be an integer from 100 to 599";

const PATTERN_MESSAGES: Readonly<Record<string, string>> = {
  path: "must start with '/' and contain no query, fragment or whitespace",
  id: "may contain only letters, digits, '_', '.' and '-' (1 to 100 characters)",
  name: "must start with a letter and contain only letters, digits, '_' or '-' (at most 64 characters)",
  contentType: "must be a media type such as application/json",
  status: STATUS_MESSAGE,
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function describeType(type: unknown): string {
  const types = Array.isArray(type) ? type.map(String) : [String(type)];
  return types.map((name) => (name === "integer" || name === "object" || name === "array" ? `an ${name}` : `a ${name}`)).join(" or ");
}

/** The corrective message for one Ajv error, or undefined for an error that carries no message of its own. */
function messageFor(error: ErrorObject): Problem | undefined {
  const base = error.instancePath;
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "if":
      return undefined;
    case "additionalProperties": {
      const field = String(params.additionalProperty);
      return {
        pointer: `${base}/${escapePointerSegment(echo(field))}`,
        message: `unknown field '${echo(field)}'; check the spelling or remove it`,
      };
    }
    case "required": {
      const field = String(params.missingProperty);
      const conditional = /allOf\/(\d+)\/then/.exec(error.schemaPath);
      const when =
        conditional === null ? "" : conditional[1] === "0" ? " when type is 'api-key'" : " when type is 'oauth2-client-credentials'";
      return { pointer: `${base}/${escapePointerSegment(echo(field))}`, message: `is required${when}` };
    }
    case "const": {
      if (base === "/version") return { pointer: base, message: "must be 1 (the only supported version)" };
      if (base === "/format") return { pointer: base, message: `must be "apipilot.api-definition"` };
      return { pointer: base, message: `must be ${JSON.stringify(params.allowedValue)}` };
    }
    case "enum":
      return { pointer: base, message: `must be one of ${(params.allowedValues as unknown[]).map(String).join(", ")}` };
    case "type":
      return { pointer: base, message: `must be ${describeType(params.type)}` };
    case "pattern":
      return { pointer: base, message: PATTERN_MESSAGES[lastSegment(base)] ?? "does not match the required format" };
    case "minLength": {
      const limit = Number(params.limit);
      return { pointer: base, message: limit === 1 ? "must not be empty" : `must be at least ${limit} ${plural(limit, "character", "characters")} long` };
    }
    case "maxLength":
      return { pointer: base, message: `must be at most ${params.limit} characters long` };
    case "minItems": {
      const limit = Number(params.limit);
      return { pointer: base, message: `must contain at least ${limit} ${plural(limit, "item", "items")}` };
    }
    case "maxItems":
      return { pointer: base, message: `must contain at most ${params.limit} items` };
    case "maxProperties":
      return { pointer: base, message: `must contain at most ${params.limit} properties` };
    case "minimum":
      return { pointer: base, message: `must be at least ${params.limit}` };
    case "maximum":
      return { pointer: base, message: `must be at most ${params.limit}` };
    default:
      return { pointer: base, message: "is not valid here" };
  }
}

/** Ajv errors to problems, with every `oneOf` location collapsed to a single message (the `status` field). */
function structuralProblems(errors: readonly ErrorObject[]): Problem[] {
  const problems: Problem[] = [];
  const collapsed = new Set<string>();
  for (const error of errors) {
    if (error.schemaPath.includes("/oneOf")) {
      if (collapsed.has(error.instancePath)) continue;
      collapsed.add(error.instancePath);
      problems.push({
        pointer: error.instancePath,
        message: lastSegment(error.instancePath) === "status" ? STATUS_MESSAGE : "does not match any of the allowed forms",
      });
      continue;
    }
    const problem = messageFor(error);
    if (problem) problems.push(problem);
  }
  return problems;
}

// ---- Cross-checks --------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isAbsoluteHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function hasQueryOrFragment(text: string): boolean {
  try {
    const url = new URL(text);
    return url.search !== "" || url.hash !== "";
  } catch {
    return false;
  }
}

const PATH_PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;

/** The `{name}` segments of a path template, or undefined with a reason when the template is malformed. */
function pathParameterNames(path: string): { names: string[] } | { malformed: string } {
  const names: string[] = [];
  const stripped = path.replace(/\{([^{}]*)\}/g, (_match, name: string) => {
    names.push(name);
    return "";
  });
  if (stripped.includes("{") || stripped.includes("}")) {
    return { malformed: "path parameters must be written as {name}, with balanced braces" };
  }
  const invalid = names.find((name) => !PATH_PARAMETER_NAME.test(name));
  if (invalid !== undefined) {
    return { malformed: "a path parameter name must start with a letter or '_' and contain only letters, digits, '_', '.' or '-'" };
  }
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) return { malformed: `path parameter '${echo(duplicate)}' appears more than once in the path` };
  return { names };
}

/** Two templates that differ only in parameter names address the same endpoint. */
function templateShape(path: string): string {
  return path.replace(/\{[^{}]*\}/g, "{}");
}

function checkEmbeddedSchema(schema: unknown, pointer: string, problems: Problem[]): void {
  if (!isObject(schema)) return;
  const pattern = schema.pattern;
  if (typeof pattern === "string") {
    try {
      new RegExp(pattern);
    } catch {
      problems.push({ pointer: `${pointer}/pattern`, message: "is not a valid regular expression" });
    }
  }
  const ranges: [string, string][] = [
    ["minimum", "maximum"],
    ["minLength", "maxLength"],
    ["minItems", "maxItems"],
  ];
  for (const [low, high] of ranges) {
    const lowValue = schema[low];
    const highValue = schema[high];
    if (typeof lowValue === "number" && typeof highValue === "number" && lowValue > highValue) {
      problems.push({ pointer: `${pointer}/${low}`, message: `must not be greater than ${high} (${highValue})` });
    }
  }
  if (isObject(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      checkEmbeddedSchema(child, `${pointer}/properties/${escapePointerSegment(echo(name))}`, problems);
    }
  }
  checkEmbeddedSchema(schema.items, `${pointer}/items`, problems);
}

const INVALID_URL_MESSAGE = "must be an absolute http or https URL without credentials, query or fragment";

function isInvalidUrl(value: unknown): boolean {
  return typeof value === "string" && (!isAbsoluteHttpUrl(value) || hasQueryOrFragment(value));
}

/** Authentication schemes: unique names, fields only where the type uses them, a usable token URL. Returns the names by position. */
function checkAuthentication(document: Record<string, unknown>, problems: Problem[]): Map<string, number> {
  const names = new Map<string, number>();
  asArray(document.authentication).forEach((scheme, index) => {
    if (!isObject(scheme)) return;
    const at = `/authentication/${index}`;
    if (typeof scheme.name === "string") {
      const first = names.get(scheme.name);
      if (first === undefined) names.set(scheme.name, index);
      else problems.push({ pointer: `${at}/name`, message: `'${echo(scheme.name)}' is already used by authentication ${first}` });
    }
    const onlyFor: [string, string[]][] = [
      ["api-key", ["in", "parameterName"]],
      ["oauth2-client-credentials", ["tokenUrl", "scopes"]],
    ];
    for (const [type, fields] of onlyFor) {
      if (scheme.type === type) continue;
      for (const field of fields.filter((candidate) => candidate in scheme)) {
        problems.push({ pointer: `${at}/${field}`, message: `is only valid for type '${type}'` });
      }
    }
    if (isInvalidUrl(scheme.tokenUrl)) problems.push({ pointer: `${at}/tokenUrl`, message: INVALID_URL_MESSAGE });
  });
  return names;
}

interface OperationRef {
  label: string;
  /** The path parameter names, or undefined when the path is missing or malformed. */
  names: string[] | undefined;
}

/** What the operations-wide checks share: first occurrences, and every way a hint can name an operation. */
interface OperationIndex {
  firstByShape: Map<string, { index: number; label: string }>;
  firstById: Map<string, number>;
  byReference: Map<string, OperationRef>;
}

function checkParameters(candidate: Record<string, unknown>, at: string, names: string[] | undefined, problems: Problem[]): void {
  const declaredPathParameters = new Set<string>();
  const seen = new Map<string, number>();
  asArray(candidate.parameters).forEach((parameter, index) => {
    if (!isObject(parameter)) return;
    const parameterAt = `${at}/parameters/${index}`;
    const name = typeof parameter.name === "string" ? parameter.name : undefined;
    const location = typeof parameter.in === "string" ? parameter.in : undefined;
    if (name !== undefined && location !== undefined) {
      const key = `${location}\u0000${location === "header" ? name.toLowerCase() : name}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, index);
      else problems.push({ pointer: parameterAt, message: `duplicates parameter ${first} (${location} '${echo(name)}')` });
    }
    if (location === "path" && name !== undefined) {
      declaredPathParameters.add(name);
      if (names !== undefined && !names.includes(name)) {
        problems.push({ pointer: parameterAt, message: `path parameter '${echo(name)}' does not appear in the path` });
      }
      if (parameter.required === false) problems.push({ pointer: `${parameterAt}/required`, message: "path parameters are always required" });
    }
    checkEmbeddedSchema(parameter.schema, `${parameterAt}/schema`, problems);
  });
  for (const name of (names ?? []).filter((candidateName) => !declaredPathParameters.has(candidateName))) {
    problems.push({ pointer: `${at}/path`, message: `path parameter '${echo(name)}' is in the path but is not declared in parameters` });
  }
}

/** Responses: a status appears once, a schema or examples need a content type, embedded schemas are consistent. */
function checkResponses(candidate: Record<string, unknown>, at: string, problems: Problem[]): void {
  const seen = new Map<string, number>();
  asArray(candidate.responses).forEach((response, index) => {
    if (!isObject(response)) return;
    const responseAt = `${at}/responses/${index}`;
    const status = typeof response.status === "number" || typeof response.status === "string" ? String(response.status) : undefined;
    if (status !== undefined && /^[1-5]\d\d$/.test(status)) {
      const first = seen.get(status);
      if (first === undefined) seen.set(status, index);
      else problems.push({ pointer: `${responseAt}/status`, message: `status ${status} is already declared by response ${first}` });
    }
    if (response.contentType === undefined && (response.schema !== undefined || asArray(response.examples).length > 0)) {
      problems.push({ pointer: `${responseAt}/contentType`, message: "is required when a schema or examples are given" });
    }
    checkEmbeddedSchema(response.schema, `${responseAt}/schema`, problems);
  });
}

/** Records the operation under its method and path (when both exist) and its id, reporting a duplicate of either. */
function registerOperation(
  candidate: Record<string, unknown>,
  index: number,
  names: string[] | undefined,
  known: OperationIndex,
  problems: Problem[],
): void {
  const at = `/operations/${index}`;
  const method = typeof candidate.method === "string" ? candidate.method : undefined;
  const path = typeof candidate.path === "string" ? candidate.path : undefined;
  if (method !== undefined && path !== undefined) {
    const shape = `${method} ${templateShape(path)}`;
    const first = known.firstByShape.get(shape);
    if (first) problems.push({ pointer: at, message: `duplicates operation ${first.index} (${echo(first.label)})` });
    else known.firstByShape.set(shape, { index, label: `${method} ${path}` });
    known.byReference.set(`${method} ${path}`, { label: `${method} ${path}`, names });
  }
  // Registered even when the method or path is missing, so one mistake does not also report every hint that names it.
  if (typeof candidate.id === "string") {
    const first = known.firstById.get(candidate.id);
    if (first === undefined) {
      known.firstById.set(candidate.id, index);
      known.byReference.set(candidate.id, { label: `${method ?? "?"} ${path ?? "?"}`, names });
    } else {
      problems.push({ pointer: `${at}/id`, message: `'${echo(candidate.id)}' is already used by operation ${first}` });
    }
  }
}

/** The path parameter names of an operation's path, reporting a malformed template. */
function checkPathTemplate(candidate: Record<string, unknown>, at: string, problems: Problem[]): string[] | undefined {
  const path = typeof candidate.path === "string" ? candidate.path : undefined;
  if (path === undefined || !/^\/[^?#\s]*$/.test(path)) return undefined;
  const parsed = pathParameterNames(path);
  if ("malformed" in parsed) {
    problems.push({ pointer: `${at}/path`, message: parsed.malformed });
    return undefined;
  }
  return parsed.names;
}

function checkOperations(document: Record<string, unknown>, authNames: ReadonlyMap<string, number>, problems: Problem[]): OperationIndex {
  const known: OperationIndex = { firstByShape: new Map(), firstById: new Map(), byReference: new Map() };
  asArray(document.operations).forEach((candidate, index) => {
    if (!isObject(candidate)) return;
    const at = `/operations/${index}`;
    const names = checkPathTemplate(candidate, at, problems);
    registerOperation(candidate, index, names, known, problems);
    checkParameters(candidate, at, names, problems);
    if (isObject(candidate.requestBody)) checkEmbeddedSchema(candidate.requestBody.schema, `${at}/requestBody/schema`, problems);
    checkResponses(candidate, at, problems);
    asArray(candidate.security).forEach((reference, referenceIndex) => {
      if (typeof reference === "string" && !authNames.has(reference)) {
        problems.push({ pointer: `${at}/security/${referenceIndex}`, message: `'${echo(reference)}' is not declared in authentication` });
      }
    });
  });
  return known;
}

/**
 * Dependency hints: both operations must exist; a path-located consumer field must be a path parameter.
 * Skipped when `operations` is not a list at all, since every hint would then be a cascade of that one problem.
 */
function checkHints(document: Record<string, unknown>, known: OperationIndex, problems: Problem[]): void {
  const hints = Array.isArray(document.operations) ? asArray(document.dependencyHints) : [];
  hints.forEach((hint, index) => {
    if (!isObject(hint)) return;
    for (const side of ["producer", "consumer"] as const) {
      const part = hint[side];
      if (!isObject(part) || typeof part.operation !== "string") continue;
      const target = known.byReference.get(part.operation);
      const at = `/dependencyHints/${index}/${side}`;
      if (!target) {
        problems.push({ pointer: `${at}/operation`, message: `no operation with id or key '${echo(part.operation)}'` });
        continue;
      }
      const pathField = side === "consumer" && part.location === "path" && typeof part.field === "string" ? part.field : undefined;
      if (pathField !== undefined && target.names !== undefined && !target.names.includes(pathField)) {
        problems.push({ pointer: `${at}/field`, message: `'${echo(pathField)}' is not a path parameter of ${echo(target.label)}` });
      }
    }
  });
}

function crossChecks(document: Record<string, unknown>): Problem[] {
  const problems: Problem[] = [];
  if (isInvalidUrl(document.baseUrl)) problems.push({ pointer: "/baseUrl", message: INVALID_URL_MESSAGE });
  const authNames = checkAuthentication(document, problems);
  const known = checkOperations(document, authNames, problems);
  checkHints(document, known, problems);
  return problems;
}

function compareProblems(a: Problem, b: Problem): number {
  if (a.pointer !== b.pointer) return a.pointer < b.pointer ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

/** One line per distinct problem, in a stable order, capped so the response stays bounded. */
function toLines(found: readonly Problem[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const problem of [...found].sort(compareProblems)) {
    const line = `${problem.pointer === "" ? "/" : problem.pointer}: ${problem.message}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  if (lines.length > MAX_PROBLEMS) {
    const hidden = lines.length - MAX_PROBLEMS;
    lines.length = MAX_PROBLEMS;
    lines.push(`/: ${hidden} more ${plural(hidden, "problem is", "problems are")} not listed; fix the ones above and upload again`);
  }
  return lines;
}

/**
 * Validates a parsed JSON document against definition version 1. Returns it typed when it is valid;
 * otherwise throws `InvalidDefinitionError` carrying every problem, in a stable order.
 */
export function validateDefinition(document: Record<string, unknown>): ApiDefinitionV1 {
  const validate = validator();
  const valid = validate(document);
  const found: Problem[] = [...(valid ? [] : structuralProblems(validate.errors ?? [])), ...crossChecks(document)];
  if (found.length === 0) {
    // The schema and the cross-checks above are the proof of this shape.
    return document as unknown as ApiDefinitionV1;
  }
  throw new InvalidDefinitionError(toLines(found));
}
