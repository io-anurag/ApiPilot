import type { ReactNode } from "react";
import { StepTrail } from "../patterns/StepTrail";

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
 * The views of one script, rendered by the shared `StepTrail` (AP-054; specs/051-user-script-page-redesign
 * FR-002): a hint under each label and `aria-current="page"` on the open view. The accessible name is
 * the label alone (the hint describes it), so the views keep the names they always had.
 */
export function ScriptTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  label,
}: Readonly<{ tabs: ReadonlyArray<ScriptTabItem<T>>; activeTab: T; onChange: (tab: T) => void; label: string }>) {
  return (
    <StepTrail
      ariaLabel={label}
      testId="script-tabs"
      columns={3}
      currentId={activeTab}
      currentToken="page"
      labelOnlyName
      items={tabs.map((tab) => ({ id: tab.id, label: tab.label, hint: tab.hint, icon: tab.icon, done: tab.done ?? false }))}
      onSelect={(id) => onChange(id as T)}
    />
  );
}
