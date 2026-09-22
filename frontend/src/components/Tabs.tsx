export interface TabItem<T extends string> {
  id: T;
  label: string;
}

/**
 * Single source of truth for the tabbed-panel selector pattern (spec 027 FR-006), extracted from
 * `App.tsx`'s top-level view switcher so any future tabbed panel reuses the same markup instead
 * of hand-rolling its own `aria-current`/focus-ring styling again.
 */
export function Tabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  label,
}: Readonly<{
  tabs: ReadonlyArray<TabItem<T>>;
  activeTab: T;
  onChange: (tabId: T) => void;
  label: string;
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
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            activeTab === tab.id
              ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300"
              : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
