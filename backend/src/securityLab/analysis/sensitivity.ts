import type { ApiOperation, SchemaConstraint, SensitivityBasis } from "@apipilot/shared-domain";
import { DESTRUCTIVE_METHODS } from "../../execution/destructiveOperations";

/**
 * What "sensitive" means to the Security Lab analysis (specs/057 FR-007, FR-009). The lists below are fixed
 * and documented, never learned, so identical input always gives identical observations (FR-005). Every
 * classification records its **basis**: a property flagged only by its name is labelled `name-match` and is
 * never presented as a confirmed sensitive field.
 */

/** Whole path segments that suggest an operation handles accounts, money, secrets or bulk data. */
const SENSITIVE_PATH_TOKENS: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "account",
  "accounts",
  "user",
  "users",
  "customer",
  "customers",
  "password",
  "passwords",
  "token",
  "tokens",
  "secret",
  "secrets",
  "key",
  "keys",
  "credential",
  "credentials",
  "payment",
  "payments",
  "billing",
  "invoice",
  "invoices",
  "refund",
  "refunds",
  "transfer",
  "transfers",
  "role",
  "roles",
  "permission",
  "permissions",
  "export",
  "import",
  "session",
  "sessions",
  "reset",
]);

/** Property names that resemble a credential or a protected personal or financial value. */
const SENSITIVE_NAME_PATTERN =
  /(pass(word|wd|phrase)?|secret|token|api[-_]?key|private[-_]?key|ssn|social[-_]?security|credit[-_]?card|card[-_]?number|cvv|cvc|iban|account[-_]?number|routing[-_]?number)/i;

const IDENTIFIER_PARAMETER = /^(id|uuid|guid)$|(Id|ID|_id|-id)$/;

/** The reasons an operation looks sensitive, each named so the observation can say why (FR-007). */
export type OperationSensitivityBasis = "method" | "path-token" | "identifier-parameter";

export interface OperationSensitivity {
  readonly bases: readonly OperationSensitivityBasis[];
  readonly detail: readonly string[];
}

/** The path parameters that look like a resource identifier, in declaration order. */
export function identifierPathParameters(operation: ApiOperation): string[] {
  return operation.parameters
    .filter((parameter) => parameter.location === "path" && IDENTIFIER_PARAMETER.test(parameter.name))
    .map((parameter) => parameter.name);
}

export function isStateChangingMethod(method: string): boolean {
  return DESTRUCTIVE_METHODS.has(method.toUpperCase());
}

/** Splits a path template into its literal segments, dropping `{param}` segments. */
function literalSegments(path: string): string[] {
  return path
    .split("/")
    .filter((segment) => segment !== "" && !segment.startsWith("{"))
    .map((segment) => segment.toLowerCase());
}

/** Why an operation looks sensitive. An empty `bases` means it does not. */
export function describeOperationSensitivity(operation: ApiOperation): OperationSensitivity {
  const bases: OperationSensitivityBasis[] = [];
  const detail: string[] = [];

  if (operation.method.toUpperCase() === "DELETE") {
    bases.push("method");
    detail.push("it deletes a resource");
  }

  const tokens = [...new Set(literalSegments(operation.path).filter((segment) => SENSITIVE_PATH_TOKENS.has(segment)))].sort();
  if (tokens.length > 0) {
    bases.push("path-token");
    detail.push(`its path names ${tokens.map((token) => `"${token}"`).join(", ")}`);
  }

  const identifiers = operation.parameters
    .filter((parameter) => parameter.location === "path" && IDENTIFIER_PARAMETER.test(parameter.name))
    .map((parameter) => parameter.name)
    .sort();
  if (identifiers.length > 0) {
    bases.push("identifier-parameter");
    detail.push(`it takes the resource identifier ${identifiers.map((name) => `"${name}"`).join(", ")}`);
  }

  return { bases, detail };
}

export interface PropertyClassification {
  readonly basis: SensitivityBasis;
  readonly detail: string;
}

/**
 * Why a property is classified sensitive, or undefined. Declared bases outrank a name match, and a name match
 * on its own is the weakest basis. A user-configured name is recorded as user-provided, never as fact.
 */
export function classifyProperty(
  name: string,
  constraint: SchemaConstraint,
  configured: ReadonlySet<string>,
): PropertyClassification | undefined {
  if (constraint.format === "password") {
    return { basis: "format-password", detail: "the specification declares it as format: password" };
  }
  if (configured.has(name.toLowerCase())) {
    return { basis: "user-configured", detail: "it is on the list of sensitive fields you configured" };
  }
  if (constraint.writeOnly === true) {
    return { basis: "write-only", detail: "the specification declares it writeOnly" };
  }
  if (SENSITIVE_NAME_PATTERN.test(name)) {
    return { basis: "name-match", detail: "only its name resembles a sensitive field; the specification declares nothing about it" };
  }
  return undefined;
}

export interface WalkedProperty {
  /** Dotted path from the schema root, with `[]` for array items. */
  readonly path: string;
  readonly name: string;
  readonly constraint: SchemaConstraint;
}

const MAX_WALK_DEPTH = 6;

/** Every named property of a schema, depth first in declaration order, to a bounded depth. */
export function walkProperties(schema: SchemaConstraint, prefix = "", depth = 0): WalkedProperty[] {
  if (depth >= MAX_WALK_DEPTH) return [];
  const found: WalkedProperty[] = [];
  for (const [name, child] of Object.entries(schema.properties)) {
    const path = prefix === "" ? name : `${prefix}.${name}`;
    found.push({ path, name, constraint: child });
    found.push(...walkProperties(child, path, depth + 1));
  }
  if (schema.items) found.push(...walkProperties(schema.items, `${prefix}[]`, depth + 1));
  return found;
}

/** The configured sensitive field names as a lowercase set, as `classifyProperty` expects. */
export function configuredSet(names: readonly string[]): ReadonlySet<string> {
  return new Set(names.map((name) => name.trim().toLowerCase()).filter((name) => name !== ""));
}
