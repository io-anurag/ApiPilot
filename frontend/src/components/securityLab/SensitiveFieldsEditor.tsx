import { useEffect, useId, useState } from "react";
import { saveSettings } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";

/** One name per line, or separated by commas. Blank entries are dropped; the server validates and de-duplicates. */
export function parseFieldNames(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * The sensitive field names the user configures (specs/057 FR-009). They are recorded as user-provided and
 * used for matching only, never as specification fact. The editor holds names, never values.
 */
export function SensitiveFieldsEditor({
  fields,
  onSaved,
}: Readonly<{ fields: readonly string[]; onSaved: (fields: string[]) => void }>) {
  const textId = useId();
  const [text, setText] = useState(fields.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A newer list from the server (another tab, a reload) replaces what is shown, unless the user has unsaved edits.
  useEffect(() => {
    setText(fields.join("\n"));
  }, [fields]);

  const dirty = parseFieldNames(text).join("\n") !== fields.join("\n");

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await saveSettings(parseFieldNames(text));
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(true);
    onSaved(result.data.sensitiveFields);
  }

  return (
    <form
      data-testid="sensitive-fields-editor"
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={textId} className="block text-sm font-medium text-text-primary">
        Sensitive field names
      </label>
      <p id={`${textId}-help`} className="text-xs text-text-secondary">
        Names of properties that should be treated as sensitive, one per line. They are recorded as configured by you, not as part of the
        specification. Enter names only, never values.
      </p>
      <textarea
        id={textId}
        aria-describedby={`${textId}-help`}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setSaved(false);
        }}
        rows={4}
        spellCheck={false}
        autoComplete="off"
        className={`${FIELD_STYLES} w-full font-mono text-sm`}
      />
      {error && <ErrorState message="The sensitive field list was not saved" detail={error} testId="sensitive-fields-error" />}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving || !dirty} className={BUTTON_STYLES.secondary}>
          {saving ? "Saving..." : "Save field names"}
        </button>
        {saved && !dirty && (
          <span role="status" className="text-sm text-text-secondary">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
