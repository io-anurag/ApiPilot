import { useId, useState } from "react";
import { CHAIN_PLAN_LIMITS, parseCapturePath, type CheckExpected, type StepCheck } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { ReferenceField, type ReferenceSuggestion } from "./ReferenceField";

type CheckKind = StepCheck["kind"];

const KIND_LABELS: Record<CheckKind, string> = {
  "field-exists": "JSON field exists",
  "field-equals": "JSON field equals",
  "body-contains": "Body contains text",
  "time-at-most": "Response time at most",
};

const FIELD_CLASS = "w-full min-w-0 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

function problemOf(check: StepCheck): string | null {
  if (check.kind === "field-exists" || check.kind === "field-equals") {
    const parsed = parseCapturePath(check.path);
    if (!parsed.ok) return parsed.reason;
  }
  if (check.kind === "body-contains" && check.text === "") return "Enter the text to look for.";
  if (check.kind === "time-at-most" && (!Number.isInteger(check.maxMs) || check.maxMs < 1 || check.maxMs > CHAIN_PLAN_LIMITS.maxCheckMs)) {
    return `A whole number of milliseconds from 1 to ${CHAIN_PLAN_LIMITS.maxCheckMs}.`;
  }
  return null;
}

function expectedOf(type: CheckExpected["type"], text: string): CheckExpected {
  if (type === "number") return { type, value: Number(text) };
  if (type === "boolean") return { type, value: text === "true" };
  return { type, value: text };
}

/**
 * A step's checks (FR-016): data, never expressions. A failed check is counted for the check and
 * the step, and never stops the step's extractors or the chain (FR-017).
 */
export function CheckRows({
  checks,
  suggestions,
  onChange,
  onCommit,
  onAdd,
}: Readonly<{
  checks: readonly StepCheck[];
  suggestions: readonly ReferenceSuggestion[];
  onChange: (checks: StepCheck[]) => void;
  onCommit: () => void;
  onAdd: (kind: CheckKind) => void;
}>) {
  const id = useId();
  const [kind, setKind] = useState<CheckKind>("field-equals");
  const update = (checkId: string, next: StepCheck) => onChange(checks.map((check) => (check.id === checkId ? next : check)));
  return (
    <div className="space-y-3">
      {checks.length === 0 && <p className="text-sm text-muted">No checks. A step passes when its status is expected; add checks to verify what came back.</p>}
      <ul className="space-y-2">
        {checks.map((check, index) => {
          const problem = problemOf(check);
          return (
            <li key={check.id} className="space-y-2 rounded-md border border-border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{`${index + 1}. ${KIND_LABELS[check.kind]}`}</span>
                <button
                  type="button"
                  className={BUTTON_STYLES.ghost}
                  aria-label={`Remove check ${index + 1}`}
                  onClick={() => {
                    onChange(checks.filter((candidate) => candidate.id !== check.id));
                    onCommit();
                  }}
                >
                  Remove
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
                {(check.kind === "field-exists" || check.kind === "field-equals") && (
                  <div>
                    <label htmlFor={`${check.id}-path`} className="text-xs font-medium text-muted">Field path</label>
                    <input id={`${check.id}-path`} className={FIELD_CLASS} value={check.path} aria-invalid={problem ? true : undefined} onChange={(event) => update(check.id, { ...check, path: event.target.value })} onBlur={onCommit} />
                  </div>
                )}
                {check.kind === "field-equals" && (
                  <>
                    <div>
                      <label htmlFor={`${check.id}-type`} className="text-xs font-medium text-muted">Type</label>
                      <select
                        id={`${check.id}-type`}
                        className={FIELD_CLASS}
                        value={check.expected.type}
                        onChange={(event) => {
                          update(check.id, { ...check, expected: expectedOf(event.target.value as CheckExpected["type"], String(check.expected.value)) });
                          onCommit();
                        }}
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="boolean">true or false</option>
                      </select>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted">Equals</span>
                      {check.expected.type === "text" ? (
                        <ReferenceField label={`Check ${index + 1} expected value`} value={check.expected.value} monospace suggestions={suggestions} onChange={(value) => update(check.id, { ...check, expected: { type: "text", value } })} onCommit={onCommit} />
                      ) : check.expected.type === "number" ? (
                        <input aria-label={`Check ${index + 1} expected value`} type="number" className={FIELD_CLASS} value={String(check.expected.value)} onChange={(event) => update(check.id, { ...check, expected: expectedOf("number", event.target.value) })} onBlur={onCommit} />
                      ) : (
                        <select
                          aria-label={`Check ${index + 1} expected value`}
                          className={FIELD_CLASS}
                          value={String(check.expected.value)}
                          onChange={(event) => {
                            update(check.id, { ...check, expected: expectedOf("boolean", event.target.value) });
                            onCommit();
                          }}
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      )}
                    </div>
                  </>
                )}
                {check.kind === "body-contains" && (
                  <div className="sm:col-span-3">
                    <label htmlFor={`${check.id}-text`} className="text-xs font-medium text-muted">Text</label>
                    <input id={`${check.id}-text`} className={FIELD_CLASS} value={check.text} aria-invalid={problem ? true : undefined} onChange={(event) => update(check.id, { ...check, text: event.target.value })} onBlur={onCommit} />
                  </div>
                )}
                {check.kind === "time-at-most" && (
                  <div>
                    <label htmlFor={`${check.id}-ms`} className="text-xs font-medium text-muted">Milliseconds</label>
                    <input id={`${check.id}-ms`} type="number" min={1} className={FIELD_CLASS} value={check.maxMs} aria-invalid={problem ? true : undefined} onChange={(event) => update(check.id, { ...check, maxMs: Math.round(Number(event.target.value)) })} onBlur={onCommit} />
                  </div>
                )}
              </div>
              {problem && <p role="alert" className="text-xs text-danger-700 dark:text-danger-200">{problem}</p>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-kind`} className="sr-only">Kind of check</label>
        <select id={`${id}-kind`} className="rounded-md border border-border bg-surface px-2 py-1 text-sm" value={kind} onChange={(event) => setKind(event.target.value as CheckKind)}>
          {(Object.keys(KIND_LABELS) as CheckKind[]).map((option) => (
            <option key={option} value={option}>
              {KIND_LABELS[option]}
            </option>
          ))}
        </select>
        <button type="button" className={BUTTON_STYLES.ghost} disabled={checks.length >= CHAIN_PLAN_LIMITS.checksPerStep} onClick={() => onAdd(kind)}>
          + Add check
        </button>
      </div>
    </div>
  );
}
