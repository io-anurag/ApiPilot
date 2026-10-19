import { useId, useState } from "react";
import { SEVERITIES, type ScenarioDetail, type ScenarioEditReply, type ScenarioViolationView, type Severity } from "@apipilot/shared-domain";
import { editScenario } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import {
  changesFromDraft,
  draftFromContent,
  isMaterialEdit,
  parseViolations,
  type EditDraft,
  type JsonDraftField,
} from "./scenarioViewModel";
import { severityVariant } from "./securityViewModel";

interface EditFailure {
  readonly code: string;
  readonly message: string;
  readonly violations: ScenarioViolationView[];
}

const JSON_LABEL: Readonly<Record<JsonDraftField, string>> = {
  baseRequest: "Request (base request, JSON)",
  expected: "Expected behavior (JSON)",
  conditions: "Evaluation conditions (JSON list)",
};

/**
 * Edits a scenario's request, expected behavior and conditions, with the wording around them (specs/057 FR-030). Before
 * saving, it says whether the edit is material, and what that does to an approval: a material edit changes the test
 * itself, so the approval is withdrawn and the new version needs its own; any other edit keeps it. The rule is the
 * backend's, mirrored in the view model and pinned by a test. A rejected edit shows every violation by its pointer.
 * Only the fields that changed are sent, against the version the form was opened on.
 */
export function ScenarioEditor({
  detail,
  onSaved,
  onCancel,
  onReload,
}: Readonly<{ detail: ScenarioDetail; onSaved: (reply: ScenarioEditReply) => void; onCancel: () => void; onReload: () => void }>) {
  const { scenario, content } = detail;
  const [draft, setDraft] = useState<EditDraft>(() => draftFromContent(content));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<EditFailure | null>(null);
  const base = useId();

  const { changes, errors } = changesFromDraft(content, draft);
  const changed = Object.keys(changes);
  const material = isMaterialEdit(content, changes);
  const hasErrors = Object.keys(errors).length > 0;
  const needsSpecification = material && scenario.flags.specificationNotLoaded;
  const approved = scenario.reviewState === "approved";
  const nextVersion = scenario.currentVersion + 1;

  let blockedReason: string | undefined;
  if (changed.length === 0) blockedReason = "Change at least one field to save.";
  else if (hasErrors) blockedReason = "Fix the fields marked invalid before saving.";
  else if (needsSpecification) blockedReason = "A material edit needs a loaded specification, and none is loaded. Upload one to continue, or change only non-material fields.";

  function set<K extends keyof EditDraft>(field: K, value: EditDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setSaving(true);
    setFailure(null);
    const note = draft.note.trim();
    const result = await editScenario(scenario.id, { expectedVersion: scenario.currentVersion, changes, ...(note ? { note } : {}) });
    setSaving(false);
    if (!result.ok) {
      setFailure({ code: result.error, message: result.message, violations: result.error === "scenario_invalid" ? parseViolations(result.details) : [] });
      return;
    }
    onSaved(result.data);
  }

  function textField(field: "title" | "objective" | "rationale" | "impact", label: string, rows?: number) {
    const id = `${base}-${field}`;
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium text-text-primary">
          {label}
        </label>
        {rows ? (
          <textarea id={id} rows={rows} value={draft[field]} onChange={(event) => set(field, event.target.value)} className={`${FIELD_STYLES} w-full`} />
        ) : (
          <input id={id} type="text" value={draft[field]} onChange={(event) => set(field, event.target.value)} className={`${FIELD_STYLES} w-full`} />
        )}
      </div>
    );
  }

  function jsonField(field: JsonDraftField, rows: number) {
    const id = `${base}-${field}`;
    const error = errors[field];
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium text-text-primary">
          {JSON_LABEL[field]}
        </label>
        <textarea
          id={id}
          rows={rows}
          value={draft[field]}
          onChange={(event) => set(field, event.target.value)}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${FIELD_STYLES} w-full font-mono text-xs`}
        />
        {error && (
          <p id={`${id}-error`} className="text-xs font-medium text-danger-700 dark:text-danger-100">
            {JSON_LABEL[field]}: {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      aria-label="Edit scenario"
      data-testid="scenario-editor"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blockedReason && !saving) void save();
      }}
    >
      <p className="text-sm text-text-secondary">
        You are editing version {scenario.currentVersion}. Saving creates version {nextVersion}; the generated original and every earlier version are kept.
      </p>

      {textField("title", "Title")}
      {textField("objective", "Objective", 2)}
      {textField("rationale", "Rationale", 2)}
      {textField("impact", "Impact if it fails", 2)}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${base}-severity`} className="text-sm font-medium text-text-primary">
          Suggested severity
        </label>
        <select
          id={`${base}-severity`}
          value={draft.suggestedSeverity}
          onChange={(event) => set("suggestedSeverity", event.target.value as Severity)}
          className={`${FIELD_STYLES} w-48`}
        >
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {severityVariant(severity).label}
            </option>
          ))}
        </select>
      </div>
      {jsonField("baseRequest", 8)}
      {jsonField("expected", 8)}
      {jsonField("conditions", 6)}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${base}-note`} className="text-sm font-medium text-text-primary">
          Note for the history (optional)
        </label>
        <input id={`${base}-note`} type="text" maxLength={500} value={draft.note} onChange={(event) => set("note", event.target.value)} className={`${FIELD_STYLES} w-full`} />
      </div>

      <div role="status" className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm text-text-primary" data-testid="edit-effect">
        {changed.length === 0 ? (
          <p>No changes yet.</p>
        ) : material ? (
          <>
            <p className="font-medium">This is a material edit: it changes the test itself.</p>
            <p className="text-text-secondary">
              {approved
                ? `The approval of version ${scenario.currentVersion} will be withdrawn and the scenario goes back to review. Version ${nextVersion} needs its own approval.`
                : `An approval does not carry over to a material edit. Version ${nextVersion} needs its own approval.`}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">This edit is not material: it does not change the test.</p>
            <p className="text-text-secondary">
              {approved ? `The approval of version ${scenario.currentVersion} carries over to version ${nextVersion}.` : "No approval is affected."}
            </p>
          </>
        )}
        {changed.length > 0 && <p className="text-xs text-text-secondary">Changed: {changed.join(", ")}.</p>}
      </div>

      {failure && (
        <ErrorState
          testId="scenario-edit-error"
          message={failure.code === "scenario_invalid" ? "The edit is not valid. Nothing was changed." : "The edit was not saved"}
          detail={failure.code === "scenario_invalid" ? undefined : failure.message}
        >
          {failure.violations.length > 0 && (
            <ul className="list-disc pl-5" aria-label="Violations">
              {failure.violations.map((violation) => (
                <li key={`${violation.pointer}-${violation.code}`}>
                  <span className="font-mono text-xs">{violation.pointer}</span>: {violation.message}
                </li>
              ))}
            </ul>
          )}
          {failure.code === "stale_version" && (
            <button type="button" onClick={onReload} className={BUTTON_STYLES.secondary}>
              Reload the current version
            </button>
          )}
        </ErrorState>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving || blockedReason !== undefined} aria-describedby={blockedReason ? `${base}-blocked` : undefined} className={BUTTON_STYLES.primary}>
          {saving ? "Saving..." : `Save as version ${nextVersion}`}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={BUTTON_STYLES.secondary}>
          Cancel
        </button>
        {blockedReason && (
          <span id={`${base}-blocked`} className="text-xs text-text-secondary">
            {blockedReason}
          </span>
        )}
      </div>
    </form>
  );
}
