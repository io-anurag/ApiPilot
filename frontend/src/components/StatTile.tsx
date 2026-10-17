import type { ReactNode } from "react";
import type { StatusTone } from "./StatusBadge";

const VALUE_TONE: Record<StatusTone, string> = {
  neutral: "text-text-primary",
  info: "text-info-700 dark:text-info-100",
  success: "text-success-700 dark:text-success-100",
  warning: "text-warning-700 dark:text-warning-100",
  danger: "text-danger-700 dark:text-danger-100",
};

/**
 * One labelled figure with an optional sub-line: the stat tile of the pattern set (AP-045,
 * AP-054 FR-014). Renders as a `<dt>`/`<dd>` pair inside a wrapper `<div>`, so tiles belong in a
 * `<dl>`. The tone only tints the value; the value and the sub-line are always text, so colour is
 * never the only signal. `highlight` is the mint variant, used once per group for the figure that
 * matters most. `flat` is borderless, for tiles joined edge to edge inside a card.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  flat = false,
  highlight = false,
  icon,
}: Readonly<{
  label: string;
  value: string;
  sub?: string;
  tone?: StatusTone;
  /** Borderless, for tiles joined edge to edge inside a card. */
  flat?: boolean;
  /** The mint highlight variant. */
  highlight?: boolean;
  /** Decorative icon in a tile at the top right; never the only carrier of meaning. */
  icon?: ReactNode;
}>) {
  let frame = "min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-sm";
  if (flat) frame = "min-w-0 border-b border-r border-border bg-surface px-4 py-3";
  else if (highlight) frame = "min-w-0 rounded-2xl border border-transparent bg-mint p-4";
  return (
    <div data-testid="stat-tile" data-tone={tone} data-highlight={highlight || undefined} className={frame}>
      <div className="flex items-start justify-between gap-2">
        <dt className={`text-xs font-semibold ${highlight ? "text-text-secondary" : "text-muted"}`}>{label}</dt>
        {icon && (
          <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${highlight ? "bg-surface" : "bg-mint"} text-text-primary`}>
            {icon}
          </span>
        )}
      </div>
      <dd className={`mt-1.5 break-words font-mono text-xl font-semibold ${VALUE_TONE[tone]}`}>{value}</dd>
      {sub && <dd className={`text-xs ${highlight ? "text-text-secondary" : "text-muted"}`}>{sub}</dd>}
    </div>
  );
}
