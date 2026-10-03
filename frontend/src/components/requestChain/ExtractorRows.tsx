import { CHAIN_PLAN_LIMITS, isValidHeaderName, parseCapturePath, REFERENCE_NAME, type Extractor } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";

const FIELD_CLASS =
  "w-full min-w-0 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

function problemOf(extractor: Extractor): string | null {
  if (!REFERENCE_NAME.test(extractor.name)) return "A name holds letters, digits and underscores only.";
  if (extractor.source.kind === "body") {
    const parsed = parseCapturePath(extractor.source.path);
    return parsed.ok ? null : parsed.reason;
  }
  return isValidHeaderName(extractor.source.name) ? null : "Not a valid header name.";
}

/**
 * A step's extractors (FR-009): each a name, taken from a JSON body field by the closed field-path
 * grammar or from a response header by name. Problems are shown in text beside the row; the server
 * lists them as blockers too.
 */
export function ExtractorRows({
  extractors,
  onChange,
  onCommit,
  onAdd,
}: Readonly<{ extractors: readonly Extractor[]; onChange: (extractors: Extractor[]) => void; onCommit: () => void; onAdd: () => void }>) {
  const update = (id: string, edit: (extractor: Extractor) => Extractor) => onChange(extractors.map((extractor) => (extractor.id === id ? edit(extractor) : extractor)));
  return (
    <div className="space-y-2">
      {extractors.length === 0 && <p className="text-sm text-muted">No extractors. Add one to pass a value from this response to later steps.</p>}
      <ul className="space-y-2">
        {extractors.map((extractor, index) => {
          const problem = problemOf(extractor);
          return (
            <li key={extractor.id} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,2fr)_auto] sm:items-start">
              <div>
                <label htmlFor={`${extractor.id}-name`} className="text-xs font-medium text-muted">{`Extractor ${index + 1} name`}</label>
                <input id={`${extractor.id}-name`} className={FIELD_CLASS} value={extractor.name} onChange={(event) => update(extractor.id, (current) => ({ ...current, name: event.target.value }))} onBlur={onCommit} />
              </div>
              <div>
                <label htmlFor={`${extractor.id}-from`} className="text-xs font-medium text-muted">From</label>
                <select
                  id={`${extractor.id}-from`}
                  className={FIELD_CLASS}
                  value={extractor.source.kind}
                  onChange={(event) => {
                    update(extractor.id, (current) => ({ ...current, source: event.target.value === "header" ? { kind: "header", name: "" } : { kind: "body", path: "" } }));
                    onCommit();
                  }}
                >
                  <option value="body">JSON body field</option>
                  <option value="header">Response header</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${extractor.id}-where`} className="text-xs font-medium text-muted">
                  {extractor.source.kind === "body" ? "Field path, such as data.items[0].id" : "Header name"}
                </label>
                <input
                  id={`${extractor.id}-where`}
                  className={FIELD_CLASS}
                  value={extractor.source.kind === "body" ? extractor.source.path : extractor.source.name}
                  aria-invalid={problem ? true : undefined}
                  onChange={(event) =>
                    update(extractor.id, (current) => ({ ...current, source: current.source.kind === "body" ? { kind: "body", path: event.target.value } : { kind: "header", name: event.target.value } }))
                  }
                  onBlur={onCommit}
                />
                {problem && <p role="alert" className="mt-1 text-xs text-danger-700 dark:text-danger-200">{problem}</p>}
              </div>
              <button
                type="button"
                className={`${BUTTON_STYLES.ghost} sm:mt-5`}
                aria-label={`Remove extractor ${index + 1}`}
                onClick={() => {
                  onChange(extractors.filter((candidate) => candidate.id !== extractor.id));
                  onCommit();
                }}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className={BUTTON_STYLES.ghost} disabled={extractors.length >= CHAIN_PLAN_LIMITS.extractorsPerStep} onClick={onAdd}>
        + Add extractor
      </button>
    </div>
  );
}
