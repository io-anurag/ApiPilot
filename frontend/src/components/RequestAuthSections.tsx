import type { RequestAuthView, RequestVariableReference } from "@apipilot/shared-domain";
import { StatusBadge } from "./StatusBadge";
import { VariableHighlightedText } from "./VariableHighlightedText";
import { keepsHiddenValue, type AuthDraft, type EditableAuthType } from "../utils/authDraft";

/** Postman's own names for its auth types; an unknown type is shown as stored. */
const AUTH_TYPE_LABELS: Record<string, string> = {
  noauth: "No Auth",
  bearer: "Bearer Token",
  basic: "Basic Auth",
  apikey: "API Key",
  digest: "Digest Auth",
  oauth1: "OAuth 1.0",
  oauth2: "OAuth 2.0",
  hawk: "Hawk Authentication",
  awsv4: "AWS Signature",
  ntlm: "NTLM Authentication",
  edgegrid: "Akamai EdgeGrid",
  jwt: "JWT Bearer",
  asap: "ASAP (Atlassian)",
};

function authTypeLabel(type: string): string {
  return AUTH_TYPE_LABELS[type] ?? type;
}

function authSourceText(source: RequestAuthView["source"]): string {
  if (source.kind === "request") return "Set on this request.";
  if (source.kind === "collection") return "Inherited from the collection.";
  return `Inherited from folder “${source.folderName}”.`;
}

const USED_IN_LABELS: Record<RequestVariableReference["usedIn"][number], string> = {
  url: "URL",
  headers: "Headers",
  body: "Body",
  auth: "Auth",
};

const SOURCE_LABELS: Record<NonNullable<RequestVariableReference["source"]>, string> = {
  environment: "Environment value",
  "collection-default": "Collection default",
};

const TABLE_HEADER = "px-2 py-1.5 text-left text-xs font-semibold uppercase text-muted";
const TABLE_CELL = "px-2 py-1.5 align-top";

/**
 * The request's effective auth, read-only (FR-002a): its type, where it is defined, and its fields
 * as stored with `{{variable}}` references marked. A secret literal never reaches the browser; its
 * field is shown as hidden instead.
 */
export function RequestAuthSection({ auth }: Readonly<{ auth: RequestAuthView | undefined }>) {
  if (!auth) {
    return <p className="text-sm text-muted">No auth applies: neither this request, its folders nor the collection set one.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-semibold text-slate-900 dark:text-slate-100">{authTypeLabel(auth.type)}</span>{" "}
        <span className="text-muted">{authSourceText(auth.source)}</span>
      </p>
      {auth.fields.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th scope="col" className={TABLE_HEADER}>
                  Field
                </th>
                <th scope="col" className={TABLE_HEADER}>
                  Value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {auth.fields.map((field) => (
                <tr key={field.key}>
                  <td className={`${TABLE_CELL} font-mono text-xs`}>{field.key}</td>
                  <td className={`${TABLE_CELL} font-mono text-xs wrap-anywhere`}>
                    {field.hiddenLiteral ? (
                      <span className="font-sans italic text-muted">Hidden literal value</span>
                    ) : field.value.length > 0 ? (
                      <VariableHighlightedText text={field.value} />
                    ) : (
                      <span className="font-sans text-muted">Empty</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Read-only. A secret typed directly into the collection is never shown here.</p>
    </div>
  );
}

const AUTH_TYPE_OPTIONS: Array<{ value: EditableAuthType; label: string }> = [
  { value: "inherit", label: "Inherit auth from parent" },
  { value: "noauth", label: "No Auth" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "apikey", label: "API Key" },
];

const FIELD_INPUT =
  "w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50";

function AuthField({
  id,
  label,
  fieldKey,
  draft,
  locked,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  fieldKey: string;
  draft: AuthDraft;
  locked: boolean;
  onChange: (draft: AuthDraft) => void;
}>) {
  const hidden = draft.type === draft.storedType && draft.hiddenKeys.includes(fieldKey);
  const helpId = `${id}-help`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={draft.fields[fieldKey] ?? ""}
        disabled={locked}
        placeholder={hidden ? "Hidden value set" : "{{variable}} or value"}
        aria-describedby={hidden ? helpId : undefined}
        onChange={(event) => onChange({ ...draft, fields: { ...draft.fields, [fieldKey]: event.target.value } })}
        className={FIELD_INPUT}
      />
      {hidden && (
        <p id={helpId} className="text-xs text-muted">
          {keepsHiddenValue(draft, fieldKey)
            ? "A hidden value is stored. Leave this blank to keep it, or type a new value to replace it."
            : "Saving replaces the hidden value with what you typed."}
        </p>
      )}
    </div>
  );
}

/**
 * The request's own auth, editable (FR-002c): inherit, No Auth, Bearer Token, Basic Auth or API
 * Key. Inherited auth, and an own auth of a type ApiPilot does not edit, are shown read-only
 * (FR-002a). A hidden secret literal is kept while its field is left blank and is never shown.
 * The change is saved with the request's other fields.
 */
export function RequestAuthEditor({
  auth,
  draft,
  locked,
  onChange,
}: Readonly<{
  /** The request's effective auth as loaded. */
  auth: RequestAuthView | undefined;
  draft: AuthDraft;
  locked: boolean;
  onChange: (draft: AuthDraft) => void;
}>) {
  const unsupportedLabel = draft.storedType ? authTypeLabel(draft.storedType) : "";
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="request-auth-type" className="text-xs font-medium text-muted">
          Auth type
        </label>
        <select
          id="request-auth-type"
          value={draft.type}
          disabled={locked}
          onChange={(event) => {
            const type = event.target.value === "unsupported" ? "unsupported" : AUTH_TYPE_OPTIONS.find((option) => option.value === event.target.value)?.value;
            if (type) onChange({ ...draft, type });
          }}
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-64"
        >
          {draft.storedType && !AUTH_TYPE_OPTIONS.some((option) => option.value === draft.storedType) && (
            <option value="unsupported">{unsupportedLabel} (read-only)</option>
          )}
          {AUTH_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {draft.type === "inherit" &&
        (auth?.source.kind === "request" ? (
          <p className="text-sm text-muted">Uses its folder&apos;s or the collection&apos;s auth. After saving, this tab shows which one applies.</p>
        ) : (
          <RequestAuthSection auth={auth} />
        ))}

      {draft.type === "noauth" && (
        <p className="text-sm text-muted">This request sends no auth, even when its folder or the collection sets one.</p>
      )}

      {draft.type === "unsupported" && (
        <>
          <RequestAuthSection auth={auth} />
          <p className="text-xs text-muted">
            ApiPilot can&apos;t edit {unsupportedLabel}. Saving the request leaves it as it is; choose another type to replace it.
          </p>
        </>
      )}

      {draft.type === "bearer" && (
        <AuthField id="request-auth-token" label="Token" fieldKey="token" draft={draft} locked={locked} onChange={onChange} />
      )}

      {draft.type === "basic" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <AuthField id="request-auth-username" label="Username" fieldKey="username" draft={draft} locked={locked} onChange={onChange} />
          <AuthField id="request-auth-password" label="Password" fieldKey="password" draft={draft} locked={locked} onChange={onChange} />
        </div>
      )}

      {draft.type === "apikey" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <AuthField id="request-auth-key" label="Key" fieldKey="key" draft={draft} locked={locked} onChange={onChange} />
          <AuthField id="request-auth-value" label="Value" fieldKey="value" draft={draft} locked={locked} onChange={onChange} />
          <div className="space-y-1">
            <label htmlFor="request-auth-in" className="text-xs font-medium text-muted">
              Add to
            </label>
            <select
              id="request-auth-in"
              value={draft.apiKeyIn}
              disabled={locked}
              onChange={(event) => onChange({ ...draft, apiKeyIn: event.target.value === "query" ? "query" : "header" })}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="header">Header</option>
              <option value="query">Query params</option>
            </select>
          </div>
        </div>
      )}

      {(draft.type === "bearer" || draft.type === "basic" || draft.type === "apikey") && (
        <p className="text-xs text-muted">
          Saved with the request, on this request only. Use a <code>{"{{variable}}"}</code> to keep a secret out of the collection.
        </p>
      )}
    </div>
  );
}

/**
 * Every variable the request uses, where, and whether it is set (FR-002b). Status is text, not
 * color alone; values themselves stay in the variable panel (FR-003).
 */
export function RequestVariablesSection({ references }: Readonly<{ references: RequestVariableReference[] }>) {
  if (references.length === 0) {
    return <p className="text-sm text-muted">This request uses no variables.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <th scope="col" className={TABLE_HEADER}>
                Variable
              </th>
              <th scope="col" className={TABLE_HEADER}>
                Used in
              </th>
              <th scope="col" className={TABLE_HEADER}>
                Status
              </th>
              <th scope="col" className={TABLE_HEADER}>
                Value from
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {references.map((reference) => (
              <tr key={reference.name}>
                <td className={`${TABLE_CELL} font-mono text-xs`}>
                  <VariableHighlightedText text={`{{${reference.name}}}`} />
                </td>
                <td className={`${TABLE_CELL} text-xs`}>{reference.usedIn.map((location) => USED_IN_LABELS[location]).join(", ")}</td>
                <td className={TABLE_CELL}>
                  <StatusBadge label={reference.resolved ? "Set" : "Missing"} tone={reference.resolved ? "success" : "warning"} />
                </td>
                <td className={`${TABLE_CELL} text-xs text-muted`}>{reference.source ? SOURCE_LABELS[reference.source] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Values are shown and edited in the Variables panel.</p>
    </div>
  );
}
