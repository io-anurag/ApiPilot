export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** Optional colour square before the label (AP-038 FR-013), e.g. a workflow's colour.
   * Decorative only: it never changes the tab's accessible name. */
  markerClassName?: string;
}

/**
 * Single source of truth for the tabbed-panel selector pattern (spec 027 FR-006), extracted from
 * `App.tsx`'s top-level view switcher so any future tabbed panel reuses the same markup instead
 * of hand-rolling its own `aria-current`/focus-ring styling again.
 */
const ACTIVE_CLASSES = {
  section: "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300",
  neutral: "border-text-primary text-text-primary",
} as const;

export function Tabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  label,
  accent = "section",
}: Readonly<{
  tabs: ReadonlyArray<TabItem<T>>;
  activeTab: T;
  onChange: (tabId: T) => void;
  label: string;
  /** `section` (default) tints the active tab with the current section accent. `neutral` is for
   * tabs that switch between workflows rather than sections (AP-041): the workflow marker carries
   * identity and the active tab is shown in the neutral text colour. */
  accent?: "section" | "neutral";
}>) {
  return (
    <nav
      // `overflow-y-hidden` is load-bearing, not decorative: per the CSS overflow spec, a
      // non-`visible` `overflow-x` with an unset `overflow-y` computes `overflow-y` to `auto` too
      // (not `visible`), because the two axes can't mix `visible` with a non-`visible` value.
      // Without this, the browser treats this row as vertically scrollable as well, and a single
      // pixel of vertical overflow from the focus ring / active-tab border — enough to happen on
      // an ordinary render, not just under stress — was enough to draw a vertical scrollbar whose
      // track is nearly the same size as its thumb, rendering as what looks like two touching
      // up/down arrows with no visible groove between them.
      className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border"
      aria-label={label}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          aria-current={activeTab === tab.id ? "page" : undefined}
          className={`-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            activeTab === tab.id
              ? ACTIVE_CLASSES[accent]
              : "border-transparent text-text-secondary hover:text-text-primary"
          }`}
        >
          {tab.markerClassName && (
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-sm ${tab.markerClassName}`} />
          )}
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
