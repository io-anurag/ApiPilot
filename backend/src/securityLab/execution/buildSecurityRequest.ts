import type {
  ApiModel,
  ApiOperation,
  EffectiveSecurity,
  GeneratedRequest,
  SecurityProfile,
  SecurityScenarioContent,
  SecuritySchemeDefinition,
} from "@apipilot/shared-domain";
import { primaryRequestBodyContentType, cloneRequest } from "../../testDesign/requestHelpers";
import { operationKeyOf, resolveEffectiveSecurity } from "../analysis/effectiveSecurity";
import { PLACEHOLDER_DUMMY_VALUE, isPlaceholder } from "../scenarios/credentialPlaceholders";
import { ROLE_ANY } from "../scenarios/prerequisites";
import { credentialRequirementOf, isExpressibleSchemeIn } from "../scenarios/rules/support";
import { applyRequestMutations } from "../scenarios/requestMutations";
import { INVALID_CREDENTIAL_VALUE, MALFORMED_CREDENTIAL_VALUE } from "./probes";
import type { OutboundRequest } from "./types";

/**
 * Builds the one request a scenario sends (specs/057 contracts/execution-safety-rules.md section 1).
 *
 * The request comes from three things and nothing else: the approved scenario version (its base request and its
 * typed mutations), the profile snapshot (base URL, identities, test data) and the credential store. No scenario
 * field, model output or imported content names a URL, a host, a port or a header; a header that would change
 * where the request goes is dropped. Each mutation kind has one builder here, and a kind with none is refused, so
 * adding a kind to the closed vocabulary without a builder fails loudly instead of sending a half-built request.
 *
 * Pure: it reads a credential through the injected lookup and returns the values it used so that evidence
 * redaction can mask them by literal match.
 */

export type CredentialLookup = (identityName: string, scheme: string, kind: "active" | "expired") => string | undefined;

export interface BuildInput {
  readonly content: SecurityScenarioContent;
  readonly apiModel: ApiModel;
  readonly profile: SecurityProfile;
  /** The target's base URL: no trailing slash, no credentials (validated when the target is saved). */
  readonly baseUrl: string;
  readonly credential: CredentialLookup;
}

export type BuildFailureCode =
  | "operation_missing"
  | "identity_unavailable"
  | "test_data_missing"
  | "target_not_found"
  | "mutation_unsupported"
  | "url_not_buildable";

export type BuildResult =
  | {
      readonly ok: true;
      readonly request: OutboundRequest;
      /** How many times the request is sent (`request.repeat`), otherwise 1. */
      readonly repeat: number;
      /** Every credential value used, in every encoded form, for literal masking. Never stored or returned. */
      readonly secrets: readonly string[];
      readonly identity?: string;
      readonly scheme?: string;
    }
  | { readonly ok: false; readonly code: BuildFailureCode; readonly message: string };

const fail = (code: BuildFailureCode, message: string): BuildResult => ({ ok: false, code, message });

/** Headers a scenario can never set: they decide the destination or the framing of the request. */
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "proxy-authorization",
  "proxy-connection",
]);
const PROBE_METHODS: ReadonlySet<string> = new Set(["HEAD", "OPTIONS", "TRACE"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

interface Parts {
  pathParameters: Record<string, unknown>;
  queryParameters: Record<string, unknown>;
  headers: Record<string, unknown>;
  body: unknown;
  method: string;
}

/** Credential positions hold a placeholder in a retained scenario. In a header or query they are dropped (the scheme supplies the real one); elsewhere a plain stand-in is sent. */
function resolvePlaceholders(request: GeneratedRequest): Parts {
  const clone = cloneRequest(request);
  const strip = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).filter(([, value]) => !(typeof value === "string" && isPlaceholder(value))));
  const standIn = (value: unknown): unknown => {
    if (typeof value === "string") return isPlaceholder(value) ? PLACEHOLDER_DUMMY_VALUE : value;
    if (Array.isArray(value)) return value.map(standIn);
    if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, standIn(child)]));
    return value;
  };
  return {
    pathParameters: standIn(clone.pathParameters) as Record<string, unknown>,
    queryParameters: strip(clone.queryParameters),
    headers: strip(clone.headers),
    body: standIn(clone.body),
    method: "",
  };
}

type CredentialForm = "valid" | "invalid" | "malformed";

/** Where and how a scheme carries a credential. `text` is the whole header value for header schemes. */
function credentialPosition(definition: SecuritySchemeDefinition, form: CredentialForm, value: string): { header?: [string, string]; query?: [string, string]; cookie?: [string, string]; secrets: string[] } {
  const raw = form === "valid" ? value : form === "invalid" ? INVALID_CREDENTIAL_VALUE : MALFORMED_CREDENTIAL_VALUE;
  const secrets = form === "valid" ? [value] : [];
  switch (definition.type) {
    case "http": {
      if ((definition.scheme ?? "").toLowerCase() === "basic") {
        const encoded = form === "valid" ? base64(value) : form === "invalid" ? base64(`${INVALID_CREDENTIAL_VALUE}:${INVALID_CREDENTIAL_VALUE}`) : MALFORMED_CREDENTIAL_VALUE;
        return { header: ["authorization", `Basic ${encoded}`], secrets: form === "valid" ? [value, encoded] : [] };
      }
      return { header: ["authorization", `Bearer ${raw}`], secrets };
    }
    case "oauth2":
    case "openIdConnect":
      return { header: ["authorization", `Bearer ${raw}`], secrets };
    case "apiKey": {
      const name = definition.name ?? "";
      if (definition.in === "query") return { query: [name, raw], secrets };
      if (definition.in === "cookie") return { cookie: [name, raw], secrets };
      return { header: [name.toLowerCase(), raw], secrets };
    }
    default:
      return { secrets: [] };
  }
}

function sameRole(identityRole: string, wanted: string): boolean {
  return wanted === ROLE_ANY || identityRole.toLowerCase() === wanted.toLowerCase();
}

function pickIdentity(profile: SecurityProfile, role: string, scheme: string, kind: "active" | "expired", lookup: CredentialLookup): { name: string; value: string } | undefined {
  for (const identity of profile.identities) {
    if (!sameRole(identity.role, role)) continue;
    const declared = kind === "active" ? identity.credentialSchemes : (identity.expiredCredentialSchemes ?? []);
    if (!declared.includes(scheme)) continue;
    const value = lookup(identity.name, scheme, kind);
    if (value !== undefined && value !== "") return { name: identity.name, value };
  }
  return undefined;
}

function pathWithParameters(operation: ApiOperation, pathParameters: Record<string, unknown>): string | undefined {
  let missing = false;
  const path = operation.path.replaceAll(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = pathParameters[name];
    if (value === undefined || value === null) {
      missing = true;
      return "";
    }
    return encodeURIComponent(String(value));
  });
  return missing ? undefined : path;
}

function queryString(values: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const item of value) params.append(name, String(item));
    else params.append(name, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

function serializeBody(operation: ApiOperation, body: unknown, headers: Record<string, string>): string | undefined {
  if (body === undefined) return undefined;
  const contentType = primaryRequestBodyContentType(operation) ?? "application/json";
  if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) headers["content-type"] = contentType;
  if (contentType.includes("x-www-form-urlencoded") && typeof body === "object" && body !== null) return queryString(body as Record<string, unknown>).slice(1);
  return typeof body === "string" && !contentType.includes("json") ? body : JSON.stringify(body);
}

function findOperation(apiModel: ApiModel, operationKey: string): ApiOperation | undefined {
  return apiModel.operations.find((operation) => operationKeyOf(operation) === operationKey);
}

/** The operation's effective requirement, resolved from the model exactly as generation resolved it. */
function effectiveFor(apiModel: ApiModel, operationKey: string): EffectiveSecurity | undefined {
  return resolveEffectiveSecurity(apiModel).find((entry) => entry.operationKey === operationKey);
}

export function buildSecurityRequest(input: BuildInput): BuildResult {
  const { content, apiModel, profile, baseUrl } = input;
  const operation = findOperation(apiModel, content.operationKey);
  if (!operation) return fail("operation_missing", `The operation ${content.operationKey} is no longer in the specification.`);

  const parts = resolvePlaceholders(content.baseRequest);
  parts.method = content.operationMethod.toUpperCase();
  const secrets: string[] = [];

  // 1. Mutations that change the request itself, shared with the Postman export (one definition of what each does).
  const owners = (role: string) => profile.identities.filter((identity) => sameRole(identity.role, role)).map((identity) => identity.name);
  const mutated = applyRequestMutations(parts, operation, content.mutations, {
    pathIdValue: (mutation) =>
      profile.testData.find(
        (data) => data.parameter === mutation.parameter && owners(mutation.ownerIdentity).includes(data.ownerIdentity) && (data.operationKey === undefined || data.operationKey === content.operationKey),
      )?.value,
  });
  if (!mutated.ok) return fail(mutated.code, mutated.message);
  const repeat = mutated.repeat;

  // 2. The credential: scheme from the operation's effective requirement, identity from the mutations or the role the scenario needs.
  const requirement = credentialRequirementOf(effectiveFor(apiModel, content.operationKey));
  const schemeName = requirement.requiresCredentials ? requirement.schemes.find((name) => isExpressibleSchemeIn(apiModel, name)) : undefined;
  const definition = schemeName ? apiModel.securitySchemes[schemeName] : undefined;

  const headers: Record<string, string> = {};
  const query: Record<string, unknown> = { ...parts.queryParameters };
  let usedIdentity: string | undefined;

  if (schemeName && definition) {
    const swap = [...content.mutations].reverse().find((mutation) => mutation.kind === "identity.swap");
    const expired = content.mutations.find((mutation) => mutation.kind === "auth.expired");
    const form: CredentialForm | "omit" | undefined = content.mutations.some((mutation) => mutation.kind === "auth.omit")
      ? "omit"
      : content.mutations.some((mutation) => mutation.kind === "auth.malformed")
        ? "malformed"
        : content.mutations.some((mutation) => mutation.kind === "auth.invalid-token")
          ? "invalid"
          : undefined;

    let position: ReturnType<typeof credentialPosition> | undefined;
    if (form === "invalid" || form === "malformed") {
      position = credentialPosition(definition, form, "");
    } else if (form !== "omit") {
      const kind = expired ? "expired" : "active";
      const role = expired ? expired.identity : swap ? swap.to : (content.requiredIdentities[0]?.role ?? ROLE_ANY);
      const picked = pickIdentity(profile, role, schemeName, kind, input.credential);
      if (!picked) {
        return fail("identity_unavailable", `No identity ${role === ROLE_ANY ? "" : `with the role "${role}" `}has a ${kind === "expired" ? "known-expired" : "valid"} credential set for the "${schemeName}" scheme.`);
      }
      usedIdentity = picked.name;
      position = credentialPosition(definition, "valid", picked.value);
      secrets.push(...position.secrets);
    }
    if (position?.header) headers[position.header[0]] = position.header[1];
    if (position?.query) query[position.query[0]] = position.query[1];
    if (position?.cookie) headers.cookie = [headers.cookie, `${position.cookie[0]}=${position.cookie[1]}`].filter(Boolean).join("; ");
  }

  // 3. Declared headers last, so a declared header can never replace the credential or the framing.
  for (const [name, value] of Object.entries(parts.headers)) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.has(lower) || value === undefined || value === null) continue;
    if (lower in headers) continue;
    headers[lower] = String(value);
  }
  headers["user-agent"] = "ApiPilot-SecurityLab";
  headers["accept-encoding"] = "identity";

  // 4. URL: the profile's base URL, the operation's path with its parameters, and the query.
  const path = pathWithParameters(operation, parts.pathParameters);
  if (path === undefined) return fail("url_not_buildable", "A path parameter has no value, so the URL cannot be built.");
  // A probe method (HEAD, OPTIONS, TRACE) carries no body.
  const body = PROBE_METHODS.has(parts.method) ? undefined : serializeBody(operation, parts.body, headers);
  const url = `${baseUrl.replace(/\/$/, "")}${path}${queryString(query)}`;

  return { ok: true, request: { method: parts.method, url, headers, ...(body === undefined ? {} : { body }) }, repeat, secrets, identity: usedIdentity, scheme: schemeName };
}
