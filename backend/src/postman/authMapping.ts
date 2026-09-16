import type {
  ApiOperation,
  ArtifactVariable,
  GenerationLimitation,
  PostmanAuth,
  SecuritySchemeDefinition,
} from "@apipilot/shared-domain";
import { credentialVariable } from "./artifactVariables";

/**
 * Maps declared security schemes to collection auth (FR-009).
 *
 * Only schemes the export can configure from what the specification declares are mapped. An
 * OAuth2 scheme is mappable only when it declares a `clientCredentials` flow (AP-024, FR-001):
 * its own `tokenUrl` and scopes are then a real, declared source this export can build a
 * token-fetch request from (`oauth2TokenFetch.ts`). `authorizationCode`/`implicit`/`password`-only
 * OAuth2 requires an interactive user redirect or a discouraged grant this export cannot script,
 * so configuring one would present a guess as a contract (constitution I). Unmappable schemes
 * become recorded limitations instead.
 */

export interface AuthMapping {
  auth?: PostmanAuth;
  variables: ArtifactVariable[];
  limitations: GenerationLimitation[];
}

function attribute(key: string, value: string) {
  return { key, value, type: "string" as const };
}

/**
 * Distinct-credential scheme planning (specs/021-multi-credential-token-provisioning
 * FR-001–FR-003, FR-005).
 */

/** A trailing case-insensitive `Auth`/`Scheme` suffix, stripped when deriving a non-primary
 *  scheme's variable name (FR-003, Clarifications 2026-09-15). */
const SCHEME_KEY_SUFFIX_PATTERN = /(Auth|Scheme)$/i;

/** The scheme key with its trailing `Auth`/`Scheme` suffix removed, or the full key when no
 *  such suffix is present (or removing it would leave nothing). Reused by
 *  `credentialProducers.ts`'s producer-discovery heuristic so the string a QA engineer sees in
 *  the variable name is exactly the string that heuristic searches for. */
export function schemeStem(schemeKey: string): string {
  const stripped = schemeKey.replace(SCHEME_KEY_SUFFIX_PATTERN, "");
  return stripped.length > 0 ? stripped : schemeKey;
}

/**
 * The four scheme shapes this export can configure (mirrors `mapScheme`'s conditions below). An
 * `oauth2` scheme with no declared `clientCredentials` flow (e.g. `authorizationCode`/`implicit`/
 * `password`-only) is not classified here — it falls through to the existing, unchanged
 * `unsupported-auth-scheme` limitation (FR-001, User Story 3).
 */
function classifySchemeType(scheme: SecuritySchemeDefinition): SchemeType | undefined {
  if (scheme.type === "http" && scheme.scheme?.toLowerCase() === "bearer") return "bearer";
  if (scheme.type === "http" && scheme.scheme?.toLowerCase() === "basic") return "basic";
  if (scheme.type === "apiKey" && scheme.name) return "apiKey";
  if (scheme.type === "oauth2" && scheme.flows?.clientCredentials !== undefined) return "oauth2";
  return undefined;
}

export type SchemeType = "bearer" | "basic" | "apiKey" | "oauth2";

/** One security scheme key's resolved place in this export (FR-001–FR-003, FR-005). */
export type SchemeVariablePlanEntry =
  | { type: "bearer"; isPrimary: boolean; stem: string; variableNames: { token: string } }
  | { type: "apiKey"; isPrimary: boolean; stem: string; variableNames: { apiKey: string } }
  | {
      type: "basic";
      isPrimary: boolean;
      stem: string;
      variableNames: { username: string; password: string };
    }
  | {
      type: "oauth2";
      isPrimary: boolean;
      stem: string;
      variableNames: { clientId: string; clientSecret: string; accessToken: string };
    };

function buildPlanEntry(type: SchemeType, isPrimary: boolean, stem: string): SchemeVariablePlanEntry {
  if (type === "bearer") {
    return { type, isPrimary, stem, variableNames: { token: isPrimary ? "token" : `${stem}Token` } };
  }
  if (type === "apiKey") {
    return { type, isPrimary, stem, variableNames: { apiKey: isPrimary ? "apiKey" : `${stem}ApiKey` } };
  }
  if (type === "oauth2") {
    return {
      type,
      isPrimary,
      stem,
      variableNames: isPrimary
        ? { clientId: "clientId", clientSecret: "clientSecret", accessToken: "accessToken" }
        : {
            clientId: `${stem}ClientId`,
            clientSecret: `${stem}ClientSecret`,
            accessToken: `${stem}AccessToken`,
          },
    };
  }
  return {
    type,
    isPrimary,
    stem,
    variableNames: isPrimary
      ? { username: "username", password: "password" }
      : { username: `${stem}Username`, password: `${stem}Password` },
  };
}

/**
 * Classifies and names every declared security scheme key for one export (FR-001–FR-003,
 * FR-005). Pure function of `securitySchemes` alone: groups keys by `(type, scheme-subtype)` in
 * document declaration order, the first key of each group keeps the legacy default variable
 * name(s) (`isPrimary: true`), and every other same-type key's name is derived from its own key
 * (`schemeStem` + a type-specific suffix). A scheme whose type this export cannot configure
 * (e.g. oauth2, openIdConnect) is omitted — `mapOperationAuth` reports that exactly as today's
 * `unsupported-auth-scheme` limitation already does.
 */
export function planSchemeVariables(
  securitySchemes: Record<string, SecuritySchemeDefinition>,
): Map<string, SchemeVariablePlanEntry> {
  const plan = new Map<string, SchemeVariablePlanEntry>();
  const seenTypes = new Set<SchemeType>();
  for (const [key, scheme] of Object.entries(securitySchemes)) {
    const type = classifySchemeType(scheme);
    if (!type) continue;
    const isPrimary = !seenTypes.has(type);
    seenTypes.add(type);
    const stem = schemeStem(key);
    plan.set(key, buildPlanEntry(type, isPrimary, stem));
  }
  return plan;
}

/**
 * Builds the `PostmanAuth`/`ArtifactVariable`s for one scheme, referencing the plan's resolved
 * variable name(s) (specs/021-multi-credential-token-provisioning FR-003, FR-004) instead of a
 * hard-coded literal. `entry.type` is guaranteed consistent with `scheme`'s own shape — both come
 * from the same `planSchemeVariables`/`classifySchemeType` classification.
 */
function buildAuthMapping(scheme: SecuritySchemeDefinition, entry: SchemeVariablePlanEntry): AuthMapping {
  if (entry.type === "bearer") {
    const { token } = entry.variableNames;
    return {
      auth: { type: "bearer", bearer: [attribute("token", `{{${token}}}`)] },
      variables: [credentialVariable("token", token)],
      limitations: [],
    };
  }
  if (entry.type === "basic") {
    const { username, password } = entry.variableNames;
    return {
      auth: {
        type: "basic",
        basic: [attribute("username", `{{${username}}}`), attribute("password", `{{${password}}}`)],
      },
      variables: [credentialVariable("username", username), credentialVariable("password", password)],
      limitations: [],
    };
  }
  if (entry.type === "oauth2") {
    const { clientId, clientSecret, accessToken } = entry.variableNames;
    return {
      auth: {
        type: "oauth2",
        oauth2: [
          attribute("accessToken", `{{${accessToken}}}`),
          attribute("addTokenTo", "header"),
          attribute("tokenType", "bearer"),
        ],
      },
      variables: [
        credentialVariable("clientId", clientId),
        credentialVariable("clientSecret", clientSecret),
        credentialVariable("accessToken", accessToken),
      ],
      limitations: [],
    };
  }
  const { apiKey } = entry.variableNames;
  return {
    auth: {
      type: "apikey",
      apikey: [
        attribute("key", scheme.name!),
        attribute("value", `{{${apiKey}}}`),
        attribute("in", scheme.in === "query" ? "query" : "header"),
      ],
    },
    variables: [credentialVariable("apiKey", apiKey)],
    limitations: [],
  };
}

/**
 * The auth configuration for one operation. When an operation declares several alternative
 * requirement sets, the first declared set is used and the choice is recorded rather than
 * hidden (spec edge case; research.md).
 */
export function mapOperationAuth(
  operation: ApiOperation,
  securitySchemes: Record<string, SecuritySchemeDefinition>,
  plan: Map<string, SchemeVariablePlanEntry>,
): AuthMapping {
  const location = `${operation.method.toUpperCase()} ${operation.path}`;
  const limitations: GenerationLimitation[] = [];

  if (operation.security.length === 0) return { variables: [], limitations };

  const [requirement, ...alternatives] = operation.security;
  if (alternatives.length > 0) {
    limitations.push({
      kind: "alternative-auth-requirement-selected",
      location,
      message: `The operation declares ${operation.security.length} alternative authentication requirements; the first declared one (${requirement.schemes.map((entry) => entry.name).join(", ")}) was applied.`,
    });
  }

  if (requirement.schemes.length === 0) return { variables: [], limitations };

  const [primary, ...additional] = requirement.schemes;
  if (additional.length > 0) {
    limitations.push({
      kind: "unsupported-auth-scheme",
      location,
      message: `The operation requires ${requirement.schemes.length} schemes together; only "${primary.name}" is configured, because the collection format carries one auth configuration per request.`,
    });
  }

  const scheme = securitySchemes[primary.name];
  if (!scheme) {
    limitations.push({
      kind: "unsupported-auth-scheme",
      location,
      message: `The operation references the security scheme "${primary.name}", which the specification does not define, so no authentication is configured.`,
    });
    return { variables: [], limitations };
  }

  const entry = plan.get(primary.name);
  if (!entry) {
    limitations.push({
      kind: "unsupported-auth-scheme",
      location,
      message: `The security scheme "${primary.name}" is of type "${scheme.type}", which this export cannot configure. The request is still generated, and no substitute credential mechanism is invented.`,
    });
    return { variables: [], limitations };
  }

  const mapped = buildAuthMapping(scheme, entry);
  return { ...mapped, limitations: [...limitations, ...mapped.limitations] };
}
