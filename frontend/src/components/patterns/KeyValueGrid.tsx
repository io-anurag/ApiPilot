import type { ReactNode } from "react";

export interface KeyValueItem {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
}

/**
 * The key-value block of the pattern set (AP-054 FR-014): small uppercase labels over a value, on
 * tinted tiles, as a description list so the pairs stay semantic. Columns collapse to one on a
 * narrow card.
 */
export function KeyValueGrid({ items, testId }: Readonly<{ items: readonly KeyValueItem[]; testId?: string }>) {
  return (
    <dl data-testid={testId} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-surface-subtle p-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{item.label}</dt>
          <dd className="break-words text-sm font-semibold text-text-primary">{item.value}</dd>
          {item.detail && <dd className="text-xs text-text-secondary">{item.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}
