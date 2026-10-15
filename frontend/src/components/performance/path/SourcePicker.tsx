import type { ReactNode } from "react";
import { SOURCE_LABELS, type SourceKind } from "./pathState";

const DESCRIPTIONS: Record<SourceKind, string> = {
  specification: "One step for each operation you choose, from its generated positive scenario.",
  workflow: "One chain for each approved workflow of the guided workflow.",
  collection: "The requests you select from an imported Postman collection, in run order.",
  empty: "Write every step yourself, as in Postman.",
};

/** What the source needs before the path can continue from it. */
const NEEDS: Record<SourceKind, string> = {
  specification: "Needs a YAML file",
  workflow: "Needs approved workflows",
  collection: "Needs a collection",
  empty: "Needs nothing",
};

const ORDER: readonly SourceKind[] = ["specification", "workflow", "collection", "empty"];

const ICON_PATHS: Record<SourceKind, ReactNode> = {
  specification: (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M10 13l-2 2 2 2M14 13l2 2-2 2" />
    </>
  ),
  workflow: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 6H12a3 3 0 013 3v.5M8.5 18H12a3 3 0 003-3v-.5" />
    </>
  ),
  collection: <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  empty: <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />,
};

function SourceIcon({ source }: Readonly<{ source: SourceKind }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-[18px] w-[18px]" aria-hidden="true">
      {ICON_PATHS[source]}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
      <path d="m2.5 6.2 2.2 2.2 4.8-4.8" />
    </svg>
  );
}

/**
 * The four places a performance test can start (specs/047-unified-performance-tab FR-002, FR-006; look:
 * specs/050-performance-source-step-redesign FR-001, FR-002). Used on the entry screen, where picking opens
 * the path, and on the Source step, where `selected` is the current choice and `locked` keeps it fixed once
 * a plan exists (047 FR-014). Each card stays a button: the entry screen is an action, not a selection, so
 * the check mark appears only once there is a current choice, and `aria-pressed` carries it for assistive
 * technology.
 */
export function SourcePicker({
  onPick,
  selected = null,
  locked = false,
  disabled = false,
}: Readonly<{ onPick: (source: SourceKind) => void; selected?: SourceKind | null; locked?: boolean; disabled?: boolean }>) {
  return (
    <div role="group" aria-label="Source" data-testid="source-picker" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {ORDER.map((source) => {
        const isSelected = selected === source;
        return (
          <button
            key={source}
            type="button"
            aria-pressed={selected === null ? undefined : isSelected}
            disabled={disabled || (locked && !isSelected)}
            onClick={() => onPick(source)}
            className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-stretch gap-3 rounded-lg border p-3.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60 ${
              isSelected ? "border-brand-600 bg-brand-600/10 ring-1 ring-brand-600 dark:border-brand-500 dark:ring-brand-500" : "border-border bg-surface hover:border-brand-500 hover:bg-surface-hover"
            }`}
          >
            <span
              className={`flex h-10 w-10 items-center justify-center self-start rounded-lg border ${
                isSelected ? "border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500/20 dark:text-brand-300" : "border-border bg-surface-strong text-text-secondary"
              }`}
            >
              <SourceIcon source={source} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="block text-sm font-semibold text-text-primary">{SOURCE_LABELS[source]}</span>
              <span className="mt-0.5 block text-sm text-muted">{DESCRIPTIONS[source]}</span>
              <span className="mt-auto block pt-2.5 font-mono text-xs text-text-secondary">{NEEDS[source]}</span>
            </span>
            {selected !== null && (
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-[18px] w-[18px] items-center justify-center self-start rounded-full border ${isSelected ? "border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500 dark:text-code-surface" : "border-border-strong bg-surface"}`}
              >
                {isSelected && <CheckIcon />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
