import type { NameValue } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { ReferenceField, type ReferenceSuggestion } from "./ReferenceField";

const NAME_CLASS =
  "w-full min-w-0 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-100";

/**
 * Ordered name and value rows: query parameters, headers or form fields (FR-003). Values accept
 * `{{name}}` references with suggestions; names are plain text, except where `nameReferences` allows
 * them (query parameters and form fields, FR-004). `refuseName` gives the reason a name cannot be
 * used, such as `Host` (Edge Cases), shown beside the row in text.
 */
export function KeyValueRows({
  label,
  rows,
  onChange,
  onCommit,
  suggestions,
  refuseName,
  addLabel,
}: Readonly<{
  label: string;
  rows: readonly NameValue[];
  onChange: (rows: NameValue[]) => void;
  onCommit: () => void;
  suggestions: readonly ReferenceSuggestion[];
  refuseName?: (name: string) => string | null;
  addLabel: string;
}>) {
  const update = (index: number, row: NameValue) => onChange(rows.map((current, at) => (at === index ? row : current)));
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= rows.length) return;
    const copy = [...rows];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy);
    onCommit();
  };
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <caption className="sr-only">{label}</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="w-2/5 pb-1 pr-2 text-left font-medium">Name</th>
                <th scope="col" className="pb-1 pr-2 text-left font-medium">Value</th>
                <th scope="col" className="pb-1 text-right font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const refusal = refuseName?.(row.name) ?? null;
                return (
                  <tr key={index} className="align-top">
                    <td className="py-1 pr-2">
                      <label className="sr-only" htmlFor={`${label}-name-${index}`}>{`${label} ${index + 1} name`}</label>
                      <input
                        id={`${label}-name-${index}`}
                        className={NAME_CLASS}
                        value={row.name}
                        spellCheck={false}
                        aria-invalid={refusal ? true : undefined}
                        onChange={(event) => update(index, { ...row, name: event.target.value })}
                        onBlur={onCommit}
                      />
                      {refusal && <p role="alert" className="mt-1 text-xs text-danger-700 dark:text-danger-200">{refusal}</p>}
                    </td>
                    <td className="py-1 pr-2">
                      <ReferenceField label={`${label} ${index + 1} value`} value={row.value} monospace suggestions={suggestions} onChange={(value) => update(index, { ...row, value })} onCommit={onCommit} />
                    </td>
                    <td className="whitespace-nowrap py-1 text-right">
                      <button type="button" className={BUTTON_STYLES.ghost} aria-label={`Move ${label.toLowerCase()} ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                        ↑
                      </button>{" "}
                      <button type="button" className={BUTTON_STYLES.ghost} aria-label={`Move ${label.toLowerCase()} ${index + 1} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                        ↓
                      </button>{" "}
                      <button
                        type="button"
                        className={BUTTON_STYLES.ghost}
                        aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
                        onClick={() => {
                          onChange(rows.filter((_row, at) => at !== index));
                          onCommit();
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className={BUTTON_STYLES.ghost} onClick={() => onChange([...rows, { name: "", value: "" }])}>
        {addLabel}
      </button>
    </div>
  );
}
