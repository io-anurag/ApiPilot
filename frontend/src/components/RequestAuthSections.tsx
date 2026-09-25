import type { RequestAuthView, RequestVariableReference } from "@apipilot/shared-domain";
import { StatusBadge } from "./StatusBadge";
import { VariableHighlightedText } from "./VariableHighlightedText";

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
