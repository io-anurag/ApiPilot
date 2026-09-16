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

/** Declares a placeholder variable for a path parameter the approved scenario left unresolved. */
export function pathParameterVariable(name: string): ArtifactVariable {
  return {
    name,
    purpose: `Value for the "${name}" path parameter, which the approved scenario did not supply.`,
    secret: false,
    value: "",
  };
}