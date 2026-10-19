import type { ArtifactVariable, PostmanAuth, PostmanRequestItem, PostmanUrl, SecurityMutation } from "@apipilot/shared-domain";
import { INVALID_CREDENTIAL_VALUE, MALFORMED_CREDENTIAL_VALUE } from "../securityLab/execution/probes";
import { compareCodeUnits } from "./ordering";

/**
 * The credential half of a security scenario, applied to an item the generator already built (specs/057
 * contracts/postman-security-amendment.md "Item construction"). The value-changing mutations (a violated constraint, an
 * added property, a probe, another identity's resource id, a method) are applied to the request **before** the item is
 * built, by the same `applyRequestMutations` a run uses. What is left is how a credential is expressed in a
 * collection, which is always a variable reference and never a value:
 *
 *   auth.omit           removes the auth block and every credential header or query value
 *   auth.invalid-token  points each credential at `{{invalid_credential}}`, a fixed harmless example value
 *   auth.malformed      points each credential at `{{malformed_credential}}`, a fixed harmless example value
 *   auth.expired        points each credential at `{{<role>_<name>_expired}}`, secret and empty
 *   identity.swap       points each credential at `{{<role>_<name>}}` of the identity swapped to, secret and empty
 *
 * Pure: it returns a new item and the variables it introduced, and changes nothing it was given.
 */

export const INVALID_CREDENTIAL_VARIABLE = "invalid_credential";
export const MALFORMED_CREDENTIAL_VARIABLE = "malformed_credential";

const ONLY_REFERENCE = /^\{\{([^}]+)\}\}$/;

/** A role label made safe for a variable name: lowercase letters, digits and single underscores. */
export function identityLabel(role: string): string {
  const parts = role.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part !== "");
  return parts.length === 0 ? "identity" : parts.join("_");
}

/** The variable that holds `name`'s value for the identity with `role`. */
export function identityVariableName(role: string, name: string): string {
  return `${identityLabel(role)}_${name}`;
}

/** The variable that holds the id of a resource owned by the identity with `role`. */
export function ownedResourceVariableName(role: string, parameter: string): string {
  return `${identityLabel(role)}_${parameter.replaceAll(/\W+/g, "_")}`;
}

export interface OverlayResult {
  readonly item: PostmanRequestItem;
  readonly variables: ArtifactVariable[];
}

type Mapper = (name: string) => string | undefined;

function referenceName(value: string): string | undefined {
  return ONLY_REFERENCE.exec(value.trim())?.[1];
}

function rebuildRaw(url: PostmanUrl, query: PostmanUrl["query"]): string {
  const base = url.raw.split("?")[0];
  return query.length === 0 ? base : `${base}?${query.map((parameter) => `${parameter.key}=${parameter.value}`).join("&")}`;
}

function mapAuth(auth: PostmanAuth | undefined, map: Mapper): PostmanAuth | undefined {
  if (!auth) return undefined;
  const mapAttributes = <T extends { key: string; value: string; type: "string" }>(attributes: T[]): T[] =>
    attributes.map((attribute) => {
      const name = referenceName(attribute.value);
      const mapped = name === undefined ? undefined : map(name);
      return mapped === undefined ? attribute : { ...attribute, value: `{{${mapped}}}` };
    });
  switch (auth.type) {
    case "bearer":
      return { type: "bearer", bearer: mapAttributes(auth.bearer) };
    case "basic":
      return { type: "basic", basic: mapAttributes(auth.basic) };
    case "apikey":
      return { type: "apikey", apikey: mapAttributes(auth.apikey) };
    case "oauth2":
      return { type: "oauth2", oauth2: mapAttributes(auth.oauth2) };
  }
}

/** Re-points every credential reference of an item with `map`. */
function remap(item: PostmanRequestItem, credentials: ReadonlySet<string>, map: Mapper): PostmanRequestItem {
  const point = (value: string): string => {
    const name = referenceName(value);
    if (name === undefined || !credentials.has(name)) return value;
    const mapped = map(name);
    return mapped === undefined ? value : `{{${mapped}}}`;
  };
  const query = item.request.url.query.map((parameter) => ({ ...parameter, value: point(parameter.value) }));
  const auth = mapAuth(item.request.auth, (name) => (credentials.has(name) ? map(name) : undefined));
  return {
    ...item,
    request: {
      ...item.request,
      header: item.request.header.map((header) => ({ ...header, value: point(header.value) })),
      url: { ...item.request.url, query, raw: rebuildRaw(item.request.url, query) },
      ...(auth ? { auth } : {}),
    },
  };
}

/** Removes every credential from an item: the auth block, and any header or query value that is a credential reference. */
function omitCredentials(item: PostmanRequestItem, credentials: ReadonlySet<string>): PostmanRequestItem {
  const isCredential = (value: string) => {
    const name = referenceName(value);
    return name !== undefined && credentials.has(name);
  };
  const query = item.request.url.query.filter((parameter) => !isCredential(parameter.value));
  const request = { ...item.request };
  delete request.auth;
  return {
    ...item,
    request: {
      ...request,
      header: item.request.header.filter((header) => !isCredential(header.value)),
      url: { ...item.request.url, query, raw: rebuildRaw(item.request.url, query) },
    },
  };
}

const exampleVariable = (name: string, value: string, purpose: string): ArtifactVariable => ({ name, purpose, secret: false, value });
const secretVariable = (name: string, purpose: string): ArtifactVariable => ({ name, purpose, secret: true, value: "" });

/**
 * Applies a scenario's credential mutations to a built item. `credentials` names the variables that are credentials
 * in this item (from its auth block and the credential headers it carries), so no other variable is ever re-pointed.
 */
export function applyAuthOverlay(item: PostmanRequestItem, mutations: readonly SecurityMutation[], credentials: ReadonlySet<string>): OverlayResult {
  let current = item;
  const variables: ArtifactVariable[] = [];
  const credentialNames = [...credentials].sort(compareCodeUnits);

  for (const mutation of mutations) {
    switch (mutation.kind) {
      case "auth.omit":
        current = omitCredentials(current, credentials);
        break;
      case "auth.invalid-token":
        current = remap(current, credentials, () => INVALID_CREDENTIAL_VARIABLE);
        variables.push(
          exampleVariable(INVALID_CREDENTIAL_VARIABLE, INVALID_CREDENTIAL_VALUE, "A fixed, harmless stand-in that Security Lab sends as an invalid credential. It is not a secret and opens nothing."),
        );
        break;
      case "auth.malformed":
        current = remap(current, credentials, () => MALFORMED_CREDENTIAL_VARIABLE);
        variables.push(
          exampleVariable(MALFORMED_CREDENTIAL_VARIABLE, MALFORMED_CREDENTIAL_VALUE, "A fixed, harmless value that breaks the credential's expected form. It is not a secret and opens nothing."),
        );
        break;
      case "auth.expired":
        current = remap(current, credentials, (name) => `${identityVariableName(mutation.identity, name)}_expired`);
        for (const name of credentialNames) {
          variables.push(secretVariable(`${identityVariableName(mutation.identity, name)}_expired`, `A credential for the "${mutation.identity}" identity that you know has expired. Supply it yourself; ApiPilot never makes one up.`));
        }
        break;
      case "identity.swap":
        current = remap(current, credentials, (name) => identityVariableName(mutation.to, name));
        for (const name of credentialNames) {
          variables.push(secretVariable(identityVariableName(mutation.to, name), `The credential of the "${mutation.to}" identity, used by the scenarios that send as that identity. Supply it yourself.`));
        }
        break;
      default:
        break; // value-changing mutations were applied before the item was built
    }
  }
  return { item: current, variables };
}
