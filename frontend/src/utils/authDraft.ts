import type { RequestAuthEdit, RequestAuthView, SecretAuthFieldEdit } from "@apipilot/shared-domain";
import { EDITABLE_REQUEST_AUTH_TYPES } from "@apipilot/shared-domain";

export type EditableAuthType = (typeof EDITABLE_REQUEST_AUTH_TYPES)[number];

/**
 * The Auth tab's edit buffer for a request's own auth (specs/028 FR-002c). `fields` holds every
 * editable field by its Postman key (`token`, `username`, `password`, `key`, `value`), so switching
 * type and back keeps what was typed.
 */
export interface AuthDraft {
  /** `unsupported`: the request's own auth is a type ApiPilot does not edit; it stays as stored. */
  type: EditableAuthType | "unsupported";
  fields: Readonly<Record<string, string>>;
  apiKeyIn: "header" | "query";
  /** The request's own stored type, and its secret fields that hold a hidden literal: those keep
   * the stored value while left blank. */
  storedType?: string;
  hiddenKeys: readonly string[];
}

function isEditableType(type: string): type is EditableAuthType {
  return (EDITABLE_REQUEST_AUTH_TYPES as readonly string[]).includes(type);
}

/** The draft for a request as loaded: its own auth, or `inherit` when its auth comes from a folder or the collection. */
export function initialAuthDraft(auth: RequestAuthView | undefined): AuthDraft {
  if (auth?.source.kind !== "request") return { type: "inherit", fields: {}, apiKeyIn: "header", hiddenKeys: [] };
  const fields = Object.fromEntries(auth.fields.filter((field) => field.key !== "in").map((field) => [field.key, field.value]));
  const location = auth.fields.find((field) => field.key === "in")?.value;
  return {
    type: isEditableType(auth.type) ? auth.type : "unsupported",
    fields,
    apiKeyIn: location === "query" ? "query" : "header",
    storedType: auth.type,
    hiddenKeys: auth.fields.filter((field) => field.hiddenLiteral).map((field) => field.key),
  };
}

/** Whether a secret field left blank keeps a hidden literal stored for this type. */
export function keepsHiddenValue(draft: AuthDraft, key: string): boolean {
  return draft.type === draft.storedType && draft.hiddenKeys.includes(key) && (draft.fields[key] ?? "") === "";
}

function secret(draft: AuthDraft, key: string): SecretAuthFieldEdit {
  return keepsHiddenValue(draft, key) ? { kind: "keep" } : { kind: "set", value: draft.fields[key] ?? "" };
}

/** The edit to send, or `undefined` for an unsupported type, which is left as stored. */
export function toRequestAuthEdit(draft: AuthDraft): RequestAuthEdit | undefined {
  const text = (key: string) => draft.fields[key] ?? "";
  switch (draft.type) {
    case "unsupported":
      return undefined;
    case "bearer":
      return { type: "bearer", token: secret(draft, "token") };
    case "basic":
      return { type: "basic", username: text("username"), password: secret(draft, "password") };
    case "apikey":
      return { type: "apikey", key: text("key"), value: secret(draft, "value"), in: draft.apiKeyIn };
    default:
      return { type: draft.type };
  }
}
