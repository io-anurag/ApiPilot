import type { StatusTone } from "./StatusBadge";

const VALUE_TONE: Record<StatusTone, string> = {
  neutral: "text-text-primary",
  info: "text-info-700 dark:text-info-100",
  success: "text-success-700 dark:text-success-100",
  warning: "text-warning-700 dark:text-warning-100",
  danger: "text-danger-700 dark:text-danger-100",
};

/**
 * One labelled figure with an optional sub-line (AP-045). Renders as a `<dt>`/`<dd>` pair inside a
 * wrapper `<div>`, so tiles belong in a `<dl>`. The tone only tints the value; the value and the
 * sub-line are always text, so colour is never the only signal.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  flat = false,
}: Readonly<{ label: string; value: string; sub?: string; tone?: StatusTone; /** Borderless, for tiles joined edge to edge inside a card. */ flat?: boolean }>) {
  return (
    <div data-testid="stat-tile" data-tone={tone} className={flat ? "min-w-0 border-b border-r border-border bg-surface px-4 py-3" : "min-w-0 rounded-lg border border-border bg-chrome p-3"}>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className={`break-words font-mono text-xl font-semibold ${VALUE_TONE[tone]}`}>{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}
