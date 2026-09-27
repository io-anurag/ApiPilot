import type { Item } from "postman-collection";
import type { RequestAuthEdit, SecretAuthFieldEdit } from "@apipilot/shared-domain";
import { EDITABLE_REQUEST_AUTH_TYPES } from "@apipilot/shared-domain";
import { InvalidAuthEditError } from "./errors";
import { ownAuth, RequestAuthCtor } from "./collectionStructure";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new InvalidAuthEditError(`auth.${key} must be a string.`);
  return value;
}

function secretField(input: Record<string, unknown>, key: string): SecretAuthFieldEdit {
  const value = input[key];
  if (isRecord(value) && value.kind === "keep") return { kind: "keep" };
  if (isRecord(value) && value.kind === "set" && typeof value.value === "string") return { kind: "set", value: value.value };
  throw new InvalidAuthEditError(`auth.${key} must be { "kind": "keep" } or { "kind": "set", "value": string }.`);
}

/**
 * Validates a request edit's optional `auth` (specs/028 FR-002c). Returns `undefined` when it is
 * omitted, which leaves the request's own auth untouched.
 *
 * @throws InvalidAuthEditError when it is malformed or names a type ApiPilot does not edit.
 */
export function parseRequestAuthEdit(value: unknown): RequestAuthEdit | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !(EDITABLE_REQUEST_AUTH_TYPES as readonly unknown[]).includes(value.type)) {
    throw new InvalidAuthEditError(`auth.type must be one of: ${EDITABLE_REQUEST_AUTH_TYPES.join(", ")}.`);
  }
  switch (value.type) {
    case "bearer":
      return { type: "bearer", token: secretField(value, "token") };
    case "basic":
      return { type: "basic", username: stringField(value, "username"), password: secretField(value, "password") };
    case "apikey": {
      const location = value.in;
      if (location !== "header" && location !== "query") throw new InvalidAuthEditError('auth.in must be "header" or "query".');
      return { type: "apikey", key: stringField(value, "key"), value: secretField(value, "value"), in: location };
    }
    case "noauth":
      return { type: "noauth" };
    default:
      return { type: "inherit" };
  }
}

/**
 * The value to store for a secret field: the typed one, or the one already stored in the item's own
 * auth of the same type. Refuses to keep a value that is not there rather than storing an empty
 * secret silently.
 */
function secretValue(item: Item, type: string, key: string, edit: SecretAuthFieldEdit): string {
  if (edit.kind === "set") return edit.value;
  const own = ownAuth(item);
  const stored = own?.type === type ? own.parameters()?.get(key) : undefined;
  if (typeof stored !== "string") {
    throw new InvalidAuthEditError(`This request has no stored ${key} to keep; enter a value.`);
  }
  return stored;
}

function parameter(key: string, value: string) {
  return { key, value, type: "string" };
}

/**
 * Writes `edit` onto the request's own auth, in place (FR-002c). `inherit` removes it, so the
 * folder's or the collection's auth applies again, as in Postman. The caller marks the item edited.
 *
 * @throws InvalidAuthEditError when a `keep` names a secret the request's own auth does not have.
 */
export function applyRequestAuthEdit(item: Item, edit: RequestAuthEdit): void {
  switch (edit.type) {
    case "inherit":
      // `Request.auth` is optional in postman-collection's model; unset, the request inherits.
      delete (item.request as { auth?: unknown }).auth;
      return;
    case "noauth":
      item.request.auth = new RequestAuthCtor({ type: "noauth" });
      return;
    case "bearer":
      item.request.auth = new RequestAuthCtor({
        type: "bearer",
        bearer: [parameter("token", secretValue(item, "bearer", "token", edit.token))],
      });
      return;
    case "basic":
      item.request.auth = new RequestAuthCtor({
        type: "basic",
        basic: [parameter("username", edit.username), parameter("password", secretValue(item, "basic", "password", edit.password))],
      });
      return;
    case "apikey":
      item.request.auth = new RequestAuthCtor({
        type: "apikey",
        apikey: [
          parameter("key", edit.key),
          parameter("value", secretValue(item, "apikey", "value", edit.value)),
          parameter("in", edit.in),
        ],
      });
  }
}
