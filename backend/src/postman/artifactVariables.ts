import type { ArtifactVariable } from "@apipilot/shared-domain";
import type { CredentialKind } from "../testDesign/sensitiveValueDetection";

/**
 * Canonical declarations for the variables the artifacts reference.
 *
 * Auth mapping, credential substitution, and URL building all declare the same handful of
 * variables. Declaring them in one place is what keeps a variable from acquiring two different
 * descriptions depending on which module happened to declare it first, which would make the
 * accompanying document depend on generation order (FR-018).
 */

export const BASE_URL_VARIABLE = "baseUrl";

/** Variable names the export may declare for credentials (data-model.md: standard variables). */
export type ArtifactCredentialName = CredentialKind | "username" | "clientId" | "clientSecret" | "accessToken";

const CREDENTIAL_PURPOSE: Record<ArtifactCredentialName, string> = {
  token: "Bearer token the requests reference in place of a literal credential value.",
  apiKey: "API key the requests reference in place of a literal credential value.",
  password: "Password the requests reference in place of a literal credential value.",
  username: "Username for the declared basic authentication scheme.",
  clientId: "OAuth2 client ID used to obtain an access token for the declared clientCredentials scheme.",
  clientSecret: "OAuth2 client secret used to obtain an access token for the declared clientCredentials scheme.",
  accessToken: "OAuth2 access token, obtained automatically from the declared token endpoint before dependent requests run.",
};

/**
 * Declares a credential variable of the given kind: secret, with no value until the environment
 * supplies one. `variableName` overrides the emitted variable's name (e.g. a distinct security
 * scheme's derived name, specs/021-multi-credential-token-provisioning FR-003) while `kind`
 * continues to select the purpose text; it defaults to `kind` so every existing call site is
 * unaffected.
 */
export function credentialVariable(
  kind: ArtifactCredentialName,
  variableName: string = kind,
): ArtifactVariable {
  return { name: variableName, purpose: CREDENTIAL_PURPOSE[kind], secret: true, value: "" };
}

/** Declares the `baseUrl` variable, seeded with the supplied address (or empty if none was given). */
export function baseUrlVariable(value: string): ArtifactVariable {
  return {
    name: BASE_URL_VARIABLE,
    purpose: "Address the collection runs against; every request URL is built from it.",
    secret: false,
    value,
  };
}

const PATH_PARAMETER_SEGMENT = /^\{(.+)\}$/;

/**
 * Deterministic English singular for a collection path segment (`customers` → `customer`,
 * `categories` → `category`, `addresses` → `address`). Deliberately a small rule set rather
 * than a dictionary: the result only labels a variable, so an imperfect singular (`statuses` →
 * `statuse`) is harmless, while any dependency or locale sensitivity here would not be.
 */
function singularize(word: string): string {
  if (/ies$/i.test(word) && word.length > 3) return `${word.slice(0, -3)}y`;
  if (/(ss|x|z|ch|sh)es$/i.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/s$/i.test(word) && word.length > 1) return word.slice(0, -1);
  return word;
}

/** Letters and digits only, lower-cased — for comparing `userId`, `user_id`, and `user-id` as one stem. */
function comparableStem(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

/**
 * The collection variable standing in for path parameter `parameterName` of `operationPath`
 * when no approved value exists (specs/007 Clarifications 2026-09-23).
 *
 * A bare parameter name is not an identity: `/customers/{id}`, `/products/{id}` and
 * `/users/{id}` all declare `id`, and naming the variable after the parameter alone collapsed
 * three unrelated values into one `{{id}}`. The name is therefore prefixed with the singular of
 * the static segment immediately before the parameter — `customer_id`, `product_id`, `user_id` —
 * which the path itself declares, so nothing is inferred beyond the specification.
 *
 * Left unprefixed when the parameter already names its resource (`/users/{userId}` stays
 * `userId`, avoiding `user_userId`), or when no static segment precedes it (`/{id}`,
 * `/{tenant}/{id}`), since there is then no specification evidence to derive a prefix from.
 * Operations on the same resource (`GET`/`PUT`/`DELETE /users/{id}`) share one variable, so a
 * single supplied value serves all of them.
 */
export function pathParameterVariableName(operationPath: string, parameterName: string): string {
  const segments = operationPath.split("/").filter((segment) => segment.length > 0);
  const index = segments.findIndex(
    (segment) => PATH_PARAMETER_SEGMENT.exec(segment)?.[1] === parameterName,
  );
  const preceding = index > 0 ? segments[index - 1] : undefined;
  if (preceding === undefined || PATH_PARAMETER_SEGMENT.test(preceding)) return parameterName;
  const resource = singularize(preceding.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
  if (resource.length === 0) return parameterName;
  if (comparableStem(parameterName).startsWith(comparableStem(resource))) return parameterName;
  return `${resource}_${parameterName}`;
}

/**
 * Declares a placeholder variable for a path parameter the approved scenario left unresolved.
 * The purpose text depends on `variableName` alone, so every operation that shares the variable
 * declares it identically and the README never depends on which operation was emitted first.
 */
export function pathParameterVariable(variableName: string): ArtifactVariable {
  return {
    name: variableName,
    purpose: `Path parameter value for "${variableName}", which an approved scenario did not supply.`,
    secret: false,
    value: "",
  };
}