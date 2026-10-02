import { useEffect, useId, useState } from "react";
import { laterStepParameterMatches } from "@apipilot/shared-domain";
import type { DocumentedResponseField, PerformanceClient } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";

/**
 * AP-035 FR-007 to FR-009: adds a capture to a step, from a response body field or a response
 * header. The fields the specification documents are offered, marked when one matches a later
 * step's parameter; any other path can be typed, and the server checks it (research R6). Nothing
 * here runs or previews the capture: it holds no value.
 */
export function CaptureEditor({
  operationKey,
  laterParameterNames,
  busy,
  loadFields,
  onAdd,
  noFieldsText = "The specification documents no body field for this operation's success responses. A path you type is accepted with a warning.",
}: Readonly<{
  operationKey: string;
  laterParameterNames: readonly string[];
  busy: boolean;
  loadFields: PerformanceClient["fetchResponseFields"];
  /** AP-036: what is said when no field is documented; a collection plan has no specification. */
  noFieldsText?: string;
  onAdd: (capture: { name: string; source: { kind: "body"; path: string } | { kind: "header"; name: string } }) => void;
}>) {
  const id = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"body" | "header">("body");
  const [path, setPath] = useState("");
  const [fields, setFields] = useState<DocumentedResponseField[] | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadFields(operationKey).then((result) => {
      if (cancelled) return;
      setFields(result.ok ? result.fields : []);
      setTruncated(result.ok && result.truncated);
    });
    return () => {
      cancelled = true;
    };
  }, [loadFields, operationKey]);

  const canAdd = name.trim() !== "" && path.trim() !== "" && !busy;
  return (
    <form
      aria-label={`Add a capture to ${operationKey}`}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canAdd) return;
        onAdd({ name: name.trim(), source: kind === "body" ? { kind: "body", path: path.trim() } : { kind: "header", name: path.trim() } });
        setName("");
        setPath("");
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Capture name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={64}
          className="w-40 rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm text-slate-900 dark:text-slate-100"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        From
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as "body" | "header")}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
        >
          <option value="body">Response body field</option>
          <option value="header">Response header</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        {kind === "body" ? "Field path" : "Header name"}
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          list={kind === "body" ? `${id}-fields` : undefined}
          placeholder={kind === "body" ? "for example data.id" : "for example Location"}
          className="w-56 rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm text-slate-900 dark:text-slate-100"
        />
      </label>
      {kind === "body" && (
        <datalist id={`${id}-fields`}>
          {(fields ?? []).map((field) => (
            <option key={field.path} value={field.path}>
              {`${field.path}${field.type ? ` (${field.type})` : ""}${laterStepParameterMatches(field.path, laterParameterNames) ? " · matches a later step's parameter" : ""}`}
            </option>
          ))}
        </datalist>
      )}
      <button type="submit" className={BUTTON_STYLES.secondary} disabled={!canAdd}>
        Add capture
      </button>
      {kind === "body" && fields !== null && (
        <p className="basis-full text-xs text-muted">
          {fields.length === 0
            ? noFieldsText
            : `Documented fields: ${fields
                .map((field) => `${field.path}${laterStepParameterMatches(field.path, laterParameterNames) ? " (matches a later step's parameter)" : ""}`)
                .join(", ")}${truncated ? ", and more not listed" : ""}.`}
        </p>
      )}
    </form>
  );
}
