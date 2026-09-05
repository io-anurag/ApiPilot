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
export type ArtifactCredentialName = CredentialKind | "username";

const CREDENTIAL_PURPOSE: Record<ArtifactCredentialName, string> = {
  token: "Bearer token the requests reference in place of a literal credential value.",
  apiKey: "API key the requests reference in place of a literal credential value.",
  password: "Password the requests reference in place of a literal credential value.",
  username: "Username for the declared basic authentication scheme.",
};

/** Declares the credential variable of the given kind: secret, with no value until the environment supplies one. */
export function credentialVariable(name: ArtifactCredentialName): ArtifactVariable {
  return { name, purpose: CREDENTIAL_PURPOSE[name], secret: true, value: "" };
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