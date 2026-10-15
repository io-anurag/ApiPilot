import type { ReactNode } from "react";

export interface ScriptTabItem<T extends string> {
  id: T;
  label: string;
  /** One line under the label; always text, so the state is never colour alone. */
  hint: string;
  icon: ReactNode;
  /** The view's work is complete (the hint says so in words); shown green with a check, as a done step. */
  done?: boolean;
}

function Glyph({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5" aria-hidden="true">
      {children}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3 w-3">
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 010 1.415l-7.5 7.5a1 1 0 01-1.415 0l-3.5-3.5a1 1 0 111.415-1.415L8.5 12.086l6.79-6.79a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export const SCRIPT_TAB_ICONS = {
  script: (
    <Glyph>
      <path strokeLinecap="round" strokeLinejoin="round" d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
    </Glyph>
  ),
  setup: (
    <Glyph>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h9m4 0h3M4 17h3m4 0h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Glyph>
  ),
  runs: (
    <Glyph>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m0 14h16M8 15l3-4 3 2 4-6" />
    </Glyph>
  ),
} as const;

/**
 * The views of one script, as a boxed navigation laid out like `ImportRunStepper` and the Performance
 * path's stepper (specs/051-user-script-page-redesign FR-002): theme-aware tokens with no `dark:`
 * overrides, a hint under each label and `aria-current="page"` on the open view. The accessible name
 * is the label alone (the hint describes it), so the views keep the names they always had.
 */
export function ScriptTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  label,
}: Readonly<{ tabs: ReadonlyArray<ScriptTabItem<T>>; activeTab: T; onChange: (tab: T) => void; label: string }>) {
  return (
    <nav aria-label={label} data-testid="script-tabs">
      <ol className="grid gap-1.5 sm:grid-cols-3">
        {tabs.map((tab) => {
          const isCurrent = tab.id === activeTab;
          const hintId = `script-tab-${tab.id}-hint`;
          let tone = "border-border bg-surface text-text-secondary hover:border-brand-500 hover:bg-surface-hover";
          let disc = "bg-surface-strong text-text-secondary";
          if (isCurrent) {
            tone = "border-brand-600/30 bg-brand-600/10 text-text-primary ring-2 ring-inset ring-brand-500";
            disc = "bg-brand-600 text-white";
          } else if (tab.done) {
            tone = "border-success-600/30 bg-success-600/10 text-text-primary hover:border-success-600";
            disc = "bg-success-600 text-white";
          }
          return (
            <li key={tab.id} className="min-w-0">
              <button
                type="button"
                aria-label={tab.label}
                aria-describedby={hintId}
                aria-current={isCurrent ? "page" : undefined}
                onClick={() => onChange(tab.id)}
                className={`flex w-full min-w-0 items-center gap-2.5 rounded-md border px-3 py-2 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tone}`}
              >
                <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${disc}`}>
                  {tab.done ? <CheckIcon /> : tab.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{tab.label}</span>
                  <span id={hintId} className="block truncate text-muted">
                    {tab.hint}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
