import { useEffect, useId, useRef, useState } from "react";
import type { BodyEditInput, StepBodyEditModel } from "@apipilot/shared-domain";
import type { PerformanceErrorResult } from "../../services/performanceTestingClient";
import { ConfirmDialog } from "../ConfirmDialog";
import { BUTTON_STYLES } from "../controlStyles";
import { ReferenceNote } from "./PreviewReferenceNote";

/** FR-012: literal values reach the script, so secrets must be references (research R8). */
export const LITERAL_VALUES_NOTE = "Values you type are written into the script. Reference secrets from the environment as {{name}}.";

/**
 * AP-033 (specs/033-edit-step-request-body research R1, R13): edits one step's base body, the body
 * before ApiPilot's substitutions. The server checks and stores it (`PUT /plan {bodyEdits}`) and a
 * refusal comes back here, next to the text it is about. Schema mismatches are listed in words and
 * never block saving (FR-005).
 */
export function StepBodyEditor({
  stepId,
  operationKey,
  model,
  stepLabel,
  busy,
  onSave,
  onReset,
}: Readonly<{
  stepId: string;
  operationKey: string;
  model: StepBodyEditModel;
  stepLabel: (stepId: string) => string;
  busy: boolean;
  /** Resolves to `null` when saved, or to the server's refusal. */
  onSave: (input: BodyEditInput) => Promise<PerformanceErrorResult | null>;
  /** FR-017: back to the generated body, after confirmation. */
  onReset?: () => Promise<PerformanceErrorResult | null>;
}>) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<PerformanceErrorResult | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const baseId = useId();
  const textareaId = `${baseId}-body-${stepId}`;
  const errorId = `${baseId}-error`;

  useEffect(() => {
    if (error) textarea.current?.focus();
  }, [error]);

  function open() {
    setDraft(model.text);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setDraft(model.text);
    setError(null);
    setEditing(false);
  }

  async function save() {
    setSaving(true);
    const refusal = await onSave({ kind: model.kind, text: draft });
    setSaving(false);
    setError(refusal);
    if (!refusal) setEditing(false);
  }

  return (
    <div className="space-y-2">
      {model.replacements.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted">Replaced at run time</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {model.replacements.map((replacement) => (
              <li key={replacement.fieldPath}>
                <span className="font-mono">{replacement.fieldPath}</span>: <ReferenceNote reference={replacement.reference} stepLabel={stepLabel} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {model.mismatches.length > 0 && (
        <div className="rounded-md border border-warning-500 bg-warning-50 px-3 py-2 dark:bg-warning-500/10">
          <p className="text-xs font-semibold text-warning-700 dark:text-warning-100">Differs from the specification</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-warning-700 dark:text-warning-100">
            {model.mismatches.map((mismatch) => (
              <li key={`${mismatch.fieldPath}-${mismatch.rule}`}>{mismatch.message}</li>
            ))}
          </ul>
        </div>
      )}
      {!editing && (
        <div className="flex flex-wrap gap-4">
          <button type="button" className={BUTTON_STYLES.ghost} onClick={open}>
            {model.text === "" ? "Add a body" : "Edit body"}
          </button>
          {model.edited && onReset && (
            <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => setConfirmingReset(true)}>
              Reset to generated body
            </button>
          )}
        </div>
      )}
      {confirmingReset && onReset && (
        <ConfirmDialog
          message={`The body of ${operationKey} goes back to the body generated from the specification.`}
          affectedCount={1}
          confirmLabel="Reset body"
          onConfirm={() => {
            setConfirmingReset(false);
            void onReset().then(setError);
          }}
          onCancel={() => setConfirmingReset(false)}
        />
      )}
      {error && !editing && (
        <p role="alert" className="text-xs font-medium text-danger-700 dark:text-danger-100">
          {error.message}
        </p>
      )}
      {editing && (
        <div className="space-y-2">
          <label htmlFor={textareaId} className="block text-xs font-medium text-muted">
            Body of {operationKey}
          </label>
          <textarea
            ref={textarea}
            id={textareaId}
            rows={12}
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            className="w-full overflow-x-auto rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs whitespace-pre text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-100"
          />
          {error && (
            <p id={errorId} role="alert" className="text-xs font-medium text-danger-700 dark:text-danger-100">
              {error.message}
            </p>
          )}
          <p className="text-xs text-muted">{LITERAL_VALUES_NOTE}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON_STYLES.primary} disabled={busy || saving} onClick={() => void save()}>
              Save body
            </button>
            <button type="button" className={BUTTON_STYLES.secondary} disabled={saving} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
