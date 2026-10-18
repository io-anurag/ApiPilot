import type { ApiModel, CleanupStrategy, EnvironmentTier, SecurityProfileInput, TestDataEntry, TestIdentity, TlsPolicy } from "@apipilot/shared-domain";
import { operationKeyOf } from "../analysis/effectiveSecurity";
import { PROFILE_DEFAULTS, type SecurityLabLimits } from "../config";
import { SecurityLabError, invalidRequest } from "../errors";
import { describeBlockReason, evaluateDestination, isAddressOrRange, normalizeHost } from "../execution/destinationPolicy";
import { executableCategoryIds, isCategoryId } from "../registry/categories";
import { isCredentialFieldName, isCredentialValue } from "../scenarios/credentialPlaceholders";
import { allowsRelaxedTls, allowsRestrictedAddresses, isProductionTier } from "./tierPolicy";

/**
 * Profile input parsing and validation (specs/057 data-model.md section 5, contracts/execution-safety-rules.md).
 * Two layers: `parseProfileInput` checks shape and refuses what a profile must never carry (a credential value),
 * and `validateProfile` applies the product rules and returns **every** violation with a code and a sentence, so
 * the engineer can fix them in one pass. Validation runs on save and again on use, because the specification and
 * the environment can change between the two.
 */

export const PROFILE_VIOLATION_CODES = [
  "production_tier_refused",
  "base_url_blocked",
  "allowed_host_invalid",
  "address_ranges_local_only",
  "invalid_address_range",
  "relaxed_tls_local_only",
  "limit_above_ceiling",
  "limit_too_low",
  "unknown_category",
  "category_not_executable",
  "identity_name_duplicate",
  "identity_scheme_unknown",
  "test_data_identity_unknown",
  "test_data_operation_unknown",
  "test_data_credential_shaped",
  // Raised by the profile service rather than the pure rules: they need the store, the session or the network.
  "environment_not_found",
  "name_duplicate",
  "credential_identity_unknown",
  "credential_scheme_not_declared",
  "host_not_resolved",
  "destination_blocked",
] as const;
export type ProfileViolationCode = (typeof PROFILE_VIOLATION_CODES)[number];

export interface ProfileViolation {
  /** A path into the submitted profile, such as `identities[1].credentialSchemes[0]`. */
  field: string;
  code: ProfileViolationCode;
  message: string;
}

export interface ProfileValidationContext {
  readonly environment: { readonly name: string; readonly tier: EnvironmentTier; readonly baseUrl: string };
  readonly ceilings: SecurityLabLimits["ceilings"];
  /** The loaded specification, when there is one: scheme and operation names are checked against it. */
  readonly apiModel?: ApiModel;
}

// ---------------------------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------------------------

const MAX_NAME = 100;
const MAX_IDENTITIES = 10;
const MAX_TEST_DATA = 200;
const MAX_HOSTS = 50;
const MAX_PORTS = 20;
const MAX_RANGES = 50;
const MAX_VALUE = 500;
const MIN_TIMEOUT_MS = 100;
const IDENTITY_NAME = /^[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+)*$/;

const TOP_LEVEL_KEYS = new Set([
  "name",
  "environmentId",
  "allowedHosts",
  "allowedPorts",
  "allowedAddressRanges",
  "tlsPolicy",
  "identities",
  "testData",
  "timeoutMs",
  "maxRequests",
  "maxConcurrency",
  "permittedCategories",
  "destructivePermitted",
  "cleanup",
]);
const IDENTITY_KEYS = new Set(["name", "role", "credentialSchemes", "expiredCredentialSchemes"]);
const TEST_DATA_KEYS = new Set(["ownerIdentity", "operationKey", "parameter", "value"]);

const CREDENTIAL_HINT = "Credentials are never part of a profile: set them through the profile's credentials route, which accepts a value and never returns one.";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw invalidRequest(`'${field}' must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

function list<T>(value: unknown, field: string, max: number, item: (entry: unknown, index: number) => T): T[] {
  if (!Array.isArray(value)) throw invalidRequest(`'${field}' must be an array.`);
  if (value.length > max) throw invalidRequest(`'${field}' may hold at most ${max} entries.`);
  return value.map((entry, index) => item(entry, index));
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    const credentialLike = isCredentialFieldName(key);
    throw invalidRequest(`'${where}${key}' is not a profile field.${credentialLike ? ` ${CREDENTIAL_HINT}` : ""}`);
  }
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw invalidRequest(`'${field}' must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function optionalLimit(record: Record<string, unknown>, field: "timeoutMs" | "maxRequests" | "maxConcurrency"): number {
  const value = record[field];
  if (value === undefined) return PROFILE_DEFAULTS[field];
  return integer(value, field, 1, Number.MAX_SAFE_INTEGER);
}

function parseIdentity(entry: unknown, index: number): TestIdentity {
  const where = `identities[${index}]`;
  if (!isObject(entry)) throw invalidRequest(`'${where}' must be an object.`);
  rejectUnknownKeys(entry, IDENTITY_KEYS, `${where}.`);
  const name = text(entry.name, `${where}.name`, 50);
  if (!IDENTITY_NAME.test(name)) throw invalidRequest(`'${where}.name' may contain letters, digits, '.', '_', '-' and single spaces.`);
  const schemes = (field: string, value: unknown) => list(value, `${where}.${field}`, 20, (scheme, i) => text(scheme, `${where}.${field}[${i}]`, 100));
  const identity: TestIdentity = {
    name,
    role: text(entry.role, `${where}.role`, 50),
    credentialSchemes: schemes("credentialSchemes", entry.credentialSchemes ?? []),
  };
  if (entry.expiredCredentialSchemes !== undefined) identity.expiredCredentialSchemes = schemes("expiredCredentialSchemes", entry.expiredCredentialSchemes);
  return identity;
}

function parseTestData(entry: unknown, index: number): TestDataEntry {
  const where = `testData[${index}]`;
  if (!isObject(entry)) throw invalidRequest(`'${where}' must be an object.`);
  rejectUnknownKeys(entry, TEST_DATA_KEYS, `${where}.`);
  if (typeof entry.value !== "string" || entry.value === "" || entry.value.length > MAX_VALUE) {
    throw invalidRequest(`'${where}.value' must be a non-empty string of at most ${MAX_VALUE} characters.`);
  }
  const parsed: TestDataEntry = {
    ownerIdentity: text(entry.ownerIdentity, `${where}.ownerIdentity`, 50),
    parameter: text(entry.parameter, `${where}.parameter`, 100),
    value: entry.value,
  };
  if (entry.operationKey !== undefined) parsed.operationKey = text(entry.operationKey, `${where}.operationKey`, 300);
  return parsed;
}

function parseCleanup(value: unknown): CleanupStrategy {
  if (value === undefined) return { strategy: "none" };
  if (!isObject(value)) throw invalidRequest("'cleanup' must be an object.");
  if (value.strategy === "none") return { strategy: "none" };
  if (value.strategy === "delete-created-via-spec") return { strategy: "delete-created-via-spec", idField: text(value.idField, "cleanup.idField", 100) };
  throw invalidRequest("'cleanup.strategy' must be \"none\" or \"delete-created-via-spec\".");
}

/** Shape-checks a request body into a profile input, applying the documented defaults for limits and TLS. */
export function parseProfileInput(body: unknown): SecurityProfileInput {
  if (!isObject(body)) throw invalidRequest("The request body must be an object.");
  rejectUnknownKeys(body, TOP_LEVEL_KEYS, "");

  const tlsPolicy = body.tlsPolicy ?? "verify";
  if (tlsPolicy !== "verify" && tlsPolicy !== "relaxed-local") throw invalidRequest("'tlsPolicy' must be \"verify\" or \"relaxed-local\".");
  if (body.destructivePermitted !== undefined && typeof body.destructivePermitted !== "boolean") {
    throw invalidRequest("'destructivePermitted' must be true or false.");
  }

  return {
    name: text(body.name, "name", MAX_NAME),
    environmentId: text(body.environmentId, "environmentId", 200),
    allowedHosts: list(body.allowedHosts, "allowedHosts", MAX_HOSTS, (host, i) => text(host, `allowedHosts[${i}]`, 253)),
    allowedPorts: list(body.allowedPorts, "allowedPorts", MAX_PORTS, (port, i) => integer(port, `allowedPorts[${i}]`, 1, 65535)),
    allowedAddressRanges: list(body.allowedAddressRanges ?? [], "allowedAddressRanges", MAX_RANGES, (range, i) => text(range, `allowedAddressRanges[${i}]`, 100)),
    tlsPolicy: tlsPolicy as TlsPolicy,
    identities: list(body.identities ?? [], "identities", MAX_IDENTITIES, parseIdentity),
    testData: list(body.testData ?? [], "testData", MAX_TEST_DATA, parseTestData),
    timeoutMs: optionalLimit(body, "timeoutMs"),
    maxRequests: optionalLimit(body, "maxRequests"),
    maxConcurrency: optionalLimit(body, "maxConcurrency"),
    permittedCategories: list(body.permittedCategories ?? [], "permittedCategories", 20, (category, i) => text(category, `permittedCategories[${i}]`, 100)),
    destructivePermitted: body.destructivePermitted === true,
    cleanup: parseCleanup(body.cleanup),
  };
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

const HOST_SHAPE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$|^[0-9a-f:.]+$/;

function isHostName(raw: string): boolean {
  if (/[\s/*@?#\\]/.test(raw)) return false;
  const host = normalizeHost(raw);
  return host !== "" && HOST_SHAPE.test(host);
}

/** Every violation of the profile rules, or an empty list. Never mutates the input and never includes a test-data value in a message. */
export function validateProfile(input: SecurityProfileInput, context: ProfileValidationContext): ProfileViolation[] {
  const violations: ProfileViolation[] = [];
  const add = (field: string, code: ProfileViolationCode, message: string) => violations.push({ field, code, message });
  const { environment, ceilings, apiModel } = context;

  if (isProductionTier(environment.tier)) {
    add("environmentId", "production_tier_refused", `'${environment.name}' is a production environment. Security Lab does not run against production.`);
  }

  input.allowedHosts.forEach((host, index) => {
    if (!isHostName(host)) add(`allowedHosts[${index}]`, "allowed_host_invalid", `'${host}' is not a host name or IP address. Use a bare host, with no scheme, port, path or wildcard.`);
  });

  if (input.allowedAddressRanges.length > 0 && !allowsRestrictedAddresses(environment.tier)) {
    add("allowedAddressRanges", "address_ranges_local_only", "Allowed address ranges are accepted only for a local target. Other tiers can never reach loopback, private or link-local addresses.");
  }
  input.allowedAddressRanges.forEach((range, index) => {
    if (!isAddressOrRange(range)) add(`allowedAddressRanges[${index}]`, "invalid_address_range", `'${range}' is not an IP address or CIDR range such as 127.0.0.1 or 10.0.0.0/8.`);
  });

  if (input.tlsPolicy === "relaxed-local" && !allowsRelaxedTls(environment.tier)) {
    add("tlsPolicy", "relaxed_tls_local_only", "Relaxed certificate verification is accepted only for a local target.");
  }

  const base = evaluateDestination(
    { tier: environment.tier, allowedHosts: input.allowedHosts, allowedPorts: input.allowedPorts, allowedAddressRanges: input.allowedAddressRanges },
    environment.baseUrl,
  );
  if (!base.allowed) {
    add("environmentId", "base_url_blocked", `The target's base URL is not allowed by this profile (${base.reason}): ${describeBlockReason(base.reason)}`);
  }

  const limit = (field: "maxRequests" | "maxConcurrency" | "timeoutMs", value: number, ceiling: number) => {
    if (value > ceiling) add(field, "limit_above_ceiling", `'${field}' is ${value}, above the ceiling of ${ceiling}. Lower it; it is never clamped silently.`);
  };
  limit("maxRequests", input.maxRequests, ceilings.maxRequests);
  limit("maxConcurrency", input.maxConcurrency, ceilings.maxConcurrency);
  limit("timeoutMs", input.timeoutMs, ceilings.timeoutMs);
  if (input.timeoutMs < MIN_TIMEOUT_MS) add("timeoutMs", "limit_too_low", `'timeoutMs' must be at least ${MIN_TIMEOUT_MS} milliseconds.`);

  const executable = new Set<string>(executableCategoryIds());
  input.permittedCategories.forEach((category, index) => {
    if (!isCategoryId(category)) add(`permittedCategories[${index}]`, "unknown_category", `'${category}' is not a Security Lab category.`);
    else if (!executable.has(category)) add(`permittedCategories[${index}]`, "category_not_executable", `'${category}' cannot be executed, so it cannot be permitted.`);
  });

  const names = new Set<string>();
  input.identities.forEach((identity, index) => {
    const key = identity.name.toLowerCase();
    if (names.has(key)) add(`identities[${index}].name`, "identity_name_duplicate", `Another identity is already named '${identity.name}'. Names are compared ignoring case.`);
    names.add(key);
    if (!apiModel) return;
    const known = apiModel.securitySchemes;
    const check = (field: string, schemes: readonly string[]) =>
      schemes.forEach((scheme, i) => {
        if (!Object.hasOwn(known, scheme)) add(`identities[${index}].${field}[${i}]`, "identity_scheme_unknown", `'${scheme}' is not a security scheme of the loaded specification.`);
      });
    check("credentialSchemes", identity.credentialSchemes);
    check("expiredCredentialSchemes", identity.expiredCredentialSchemes ?? []);
  });

  const operations = apiModel ? new Set(apiModel.operations.map(operationKeyOf)) : undefined;
  input.testData.forEach((entry, index) => {
    if (!names.has(entry.ownerIdentity.toLowerCase())) {
      add(`testData[${index}].ownerIdentity`, "test_data_identity_unknown", `Test data names '${entry.ownerIdentity}', which is not an identity of this profile.`);
    }
    if (entry.operationKey !== undefined && operations && !operations.has(entry.operationKey)) {
      add(`testData[${index}].operationKey`, "test_data_operation_unknown", `'${entry.operationKey}' is not an operation of the loaded specification.`);
    }
    if (isCredentialValue(entry.value) || isCredentialFieldName(entry.parameter)) {
      add(`testData[${index}].value`, "test_data_credential_shaped", `Test data '${entry.parameter}' looks like a credential. Test data is shown back in plain text; ${CREDENTIAL_HINT}`);
    }
  });

  return violations;
}

/** The typed error a route returns for an invalid profile. */
export class ProfileInvalidError extends SecurityLabError {
  constructor(public readonly violations: ProfileViolation[]) {
    super("profile_invalid", "The profile is not valid. Fix each listed problem and save again.", { violations });
  }
}

/** Throws `ProfileInvalidError` when the profile breaks any rule. */
export function assertProfileValid(input: SecurityProfileInput, context: ProfileValidationContext): void {
  const violations = validateProfile(input, context);
  if (violations.length > 0) throw new ProfileInvalidError(violations);
}
