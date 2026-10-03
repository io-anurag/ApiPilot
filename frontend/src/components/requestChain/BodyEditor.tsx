import { useId } from "react";
import { CHAIN_PLAN_LIMITS, type StepBody } from "@apipilot/shared-domain";
import { KeyValueRows } from "./KeyValueRows";
import { ReferenceField, type ReferenceSuggestion } from "./ReferenceField";

const CONTENT_TYPES = ["application/json", "text/plain", "application/xml", "text/csv"];

/**
 * A step's body: none, raw text with a content type, or form URL-encoded fields (FR-003, research
 * R4). References in a JSON body are sent JSON-escaped; the content type is the `Content-Type` header
 * unless the step's headers name one.
 */
export function BodyEditor({
  body,
  onChange,
  onCommit,
  suggestions,
}: Readonly<{ body: StepBody; onChange: (body: StepBody) => void; onCommit: () => void; suggestions: readonly ReferenceSuggestion[] }>) {
  const id = useId();
  const choose = (kind: StepBody["kind"]) => {
    if (kind === body.kind) return;
    onChange(kind === "none" ? { kind: "none" } : kind === "raw" ? { kind: "raw", contentType: "application/json", text: "" } : { kind: "form", fields: [] });
    onCommit();
  };
  const size = body.kind === "raw" ? new TextEncoder().encode(body.text).length : 0;
  return (
    <div className="space-y-3">
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Body</legend>
        {(["none", "raw", "form"] as const).map((kind) => (
          <label key={kind} className="inline-flex items-center gap-1.5">
            <input type="radio" name={`${id}-kind`} checked={body.kind === kind} onChange={() => choose(kind)} />
            {kind === "none" ? "None" : kind === "raw" ? "Raw" : "Form URL-encoded"}
          </label>
        ))}
      </fieldset>
      {body.kind === "raw" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-type`} className="text-xs font-medium text-muted">
              Content type
            </label>
            <input
              id={`${id}-type`}
              list={`${id}-types`}
              value={body.contentType}
              onChange={(event) => onChange({ ...body, contentType: event.target.value })}
              onBlur={onCommit}
              className="min-w-48 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            />
            <datalist id={`${id}-types`}>
              {CONTENT_TYPES.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </div>
          <ReferenceField
            label="Body"
            multiline
            monospace
            rows={10}
            value={body.text}
            suggestions={suggestions}
            onChange={(text) => onChange({ ...body, text })}
            onCommit={onCommit}
            invalid={size > CHAIN_PLAN_LIMITS.bodyBytes ? `A body is at most ${CHAIN_PLAN_LIMITS.bodyBytes / 1024} KiB.` : null}
          />
          <p className="text-xs text-muted">
            {Math.ceil(size / 1024)} KiB of {CHAIN_PLAN_LIMITS.bodyBytes / 1024} KiB
          </p>
        </div>
      )}
      {body.kind === "form" && (
        <KeyValueRows label="Form fields" rows={body.fields} suggestions={suggestions} addLabel="+ Add field" onChange={(fields) => onChange({ kind: "form", fields })} onCommit={onCommit} />
      )}
    </div>
  );
}
