import type {
  ApiOperation,
  PostmanAuthAttribute,
  PostmanFolder,
  PostmanRequestItem,
  PostmanUrl,
  SecuritySchemeDefinition,
} from "@apipilot/shared-domain";
import type { SchemeVariablePlanEntry } from "./authMapping";
import { BASE_URL_VARIABLE } from "./artifactVariables";
import { itemIdForOAuth2TokenFetch } from "./identifiers";
import { compareCodeUnits } from "./ordering";

/**
 * Synthesizes one token-fetch request per classified OAuth2 `clientCredentials` scheme that at
 * least one approved scenario requires (AP-024, FR-004), wrapped in one dedicated folder
 * positioned to always run first (research.md D5) — never mixed into the alphabetically sorted
 * tag-folder list `generateCollection.ts` otherwise builds.
 *
 * There is no candidate-discovery/ambiguity-resolution step here (unlike
 * `credentialProducers.ts`'s bearer/apiKey producer discovery): the scheme's own declared
 * `tokenUrl` is the sole, authoritative source, so this module never guesses at a producer.
 */

const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;

/**
 * The dedicated folder's name, shared with `validateCollection.ts` so its folder-order check can
 * recognize and exempt this one always-first folder rather than requiring it to happen to sort
 * alphabetically before every other folder name (research.md D5).
 */
export const OAUTH2_SETUP_FOLDER_NAME = "OAuth2 Token Setup";

function attribute(key: string, value: string): PostmanAuthAttribute {
  return { key, value, type: "string" };
}

/**
 * Resolves the scheme's declared `tokenUrl` into a `PostmanUrl`: verbatim when already absolute
 * (Edge Cases), otherwise resolved against `{{baseUrl}}` — the same base every other request in
 * the export already uses, never a fabricated or hard-coded host.
 */
function buildTokenUrl(tokenUrl: string): PostmanUrl {
  if (ABSOLUTE_URL_PATTERN.test(tokenUrl)) {
    return { raw: tokenUrl, host: [tokenUrl], path: [], query: [], variable: [] };
  }
  const segments = tokenUrl.split("/").filter((segment) => segment.length > 0);
  return {
    raw: `{{${BASE_URL_VARIABLE}}}/${segments.join("/")}`,
    host: [`{{${BASE_URL_VARIABLE}}}`],
    path: segments,
    query: [],
    variable: [],
  };
}

/** The `grant_type=client_credentials[&scope=...]` form-encoded body (FR-004c, FR-005). Every
 *  scope is included verbatim, space-delimited per RFC 6749, then form-encoded — never a
 *  fabricated scope added, and never a declared scope silently dropped. */
function buildGrantBody(scopes: string[]): string {
  const grant = "grant_type=client_credentials";
  if (scopes.length === 0) return grant;
  return `${grant}&scope=${scopes.map((scope) => encodeURIComponent(scope)).join("+")}`;
}

/** The test-script event that captures the response's `access_token` field into the scheme's
 *  access-token variable (FR-004a) — unconditionally attempted, never throwing on a non-2xx or
 *  malformed response (FR-004b): such a response simply yields no usable value, and the failure
 *  then surfaces on whichever dependent, scenario-backed request actually needs the token. */
function buildTokenCaptureEvent(accessTokenVariable: string) {
  return {
    listen: "test" as const,
    script: {
      type: "text/javascript" as const,
      exec: [
        "let body;",
        "try { body = pm.response.json(); } catch (e) { body = undefined; }",
        `if (body && typeof body.access_token === "string") { pm.environment.set(${JSON.stringify(accessTokenVariable)}, body.access_token); }`,
      ],
    },
  };
}

/** True when `operation`'s first declared security requirement's first scheme is `schemeKey` —
 *  mirrors `mapOperationAuth`'s own precedence rule for which scheme an operation actually uses. */
function requiresSchemeAsPrimary(operation: ApiOperation, schemeKey: string): boolean {
  return operation.security[0]?.schemes[0]?.name === schemeKey;
}

function buildTokenFetchItem(
  schemeKey: string,
  scheme: SecuritySchemeDefinition,
  entry: Extract<SchemeVariablePlanEntry, { type: "oauth2" }>,
): PostmanRequestItem {
  const { clientId, clientSecret, accessToken } = entry.variableNames;
  const tokenUrl = scheme.flows!.clientCredentials!.tokenUrl;
  const scopes = scheme.flows!.clientCredentials!.scopes;
  return {
    id: itemIdForOAuth2TokenFetch(schemeKey),
    name: `Obtain access token — ${schemeKey}`,
    request: {
      method: "POST",
      url: buildTokenUrl(tokenUrl),
      header: [{ key: "Content-Type", value: "application/x-www-form-urlencoded" }],
      body: { mode: "raw", raw: buildGrantBody(scopes), options: { raw: { language: "text" } } },
      auth: {
        type: "basic",
        basic: [attribute("username", `{{${clientId}}}`), attribute("password", `{{${clientSecret}}}`)],
      },
    },
    event: [buildTokenCaptureEvent(accessToken)],
    // No `provenance`/`scenarioId`: this is the signal `runExecution.ts` uses to recognize a
    // synthesized, non-scenario item (research.md D6) — it is never a `TestScenario` (constitution
    // VIII, an artifact-layer construct only).
  };
}

/**
 * Builds one `PostmanRequestItem` per classified OAuth2 `clientCredentials` scheme that at least
 * one of `requiredOperations` requires as its primary scheme, wrapped in one shared, dedicated
 * folder. Returns an empty array when no required operation needs a classified oauth2 scheme
 * (spec Acceptance Scenario: "no unused artifact").
 */
export function buildOAuth2SetupFolders(
  requiredOperations: ApiOperation[],
  securitySchemes: Record<string, SecuritySchemeDefinition>,
  plan: Map<string, SchemeVariablePlanEntry>,
): PostmanFolder[] {
  const entries: { schemeKey: string; item: PostmanRequestItem }[] = [];

  for (const [schemeKey, entry] of plan) {
    if (entry.type !== "oauth2") continue;
    const scheme = securitySchemes[schemeKey];
    if (!scheme?.flows?.clientCredentials) continue;
    const isRequired = requiredOperations.some((operation) =>
      requiresSchemeAsPrimary(operation, schemeKey),
    );
    if (!isRequired) continue;
    entries.push({ schemeKey, item: buildTokenFetchItem(schemeKey, scheme, entry) });
  }

  if (entries.length === 0) return [];

  entries.sort((a, b) => compareCodeUnits(a.schemeKey, b.schemeKey));
  return [{ name: OAUTH2_SETUP_FOLDER_NAME, item: entries.map((entry) => entry.item) }];
}
