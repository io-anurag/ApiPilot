import { SOURCE_LABELS, type SourceKind } from "./pathState";

const DESCRIPTIONS: Record<SourceKind, string> = {
  specification: "One step for each operation you choose, from its generated positive scenario.",
  workflow: "One chain for each approved workflow of the guided workflow.",
  collection: "The requests you select from an imported Postman collection, in run order.",
  empty: "Write every step yourself, as in Postman.",
};

const ORDER: readonly SourceKind[] = ["specification", "workflow", "collection", "empty"];

/**
 * The four places a performance test can start (specs/047-unified-performance-tab FR-002, FR-006). Used
 * on the entry screen, where picking opens the path, and on the Source step, where `selected` is the
 * current choice and `locked` keeps it fixed once a plan exists (FR-014).
 */
export function SourcePicker({
  onPick,
  selected = null,
  locked = false,
  disabled = false,
}: Readonly<{ onPick: (source: SourceKind) => void; selected?: SourceKind | null; locked?: boolean; disabled?: boolean }>) {
  return (
    <div role="group" aria-label="Source" data-testid="source-picker" className="grid gap-2 sm:grid-cols-2">
      {ORDER.map((source) => {
        const isSelected = selected === source;
        return (
          <button
            key={source}
            type="button"
            aria-pressed={selected === null ? undefined : isSelected}
            disabled={disabled || (locked && !isSelected)}
            onClick={() => onPick(source)}
            className={`rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60 ${
              isSelected ? "border-brand-600 bg-brand-600/10 ring-1 ring-brand-600" : "border-border bg-surface hover:border-brand-500 hover:bg-surface-hover"
            }`}
          >
            <span className="block text-sm font-semibold text-text-primary">{SOURCE_LABELS[source]}</span>
            <span className="mt-0.5 block text-xs text-muted">{DESCRIPTIONS[source]}</span>
          </button>
        );
      })}
    </div>
  );
}
