import type { ReactNode } from "react";

export type PillTone = "accent" | "mint" | "line" | "ok" | "warn" | "bad";

const TONE_CLASSES: Record<PillTone, string> = {
  accent: "bg-accent text-on-accent",
  mint: "bg-mint text-text-secondary",
  line: "border border-border-strong bg-surface-subtle text-text-secondary",
  ok: "bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-100",
  warn: "bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100",
  bad: "bg-danger-100 text-danger-700 dark:bg-danger-500/15 dark:text-danger-100",
};

/**
 * The pill chip of the pattern set (AP-054 FR-014). The label is always text, and `ok`, `warn`
 * and `bad` take an optional icon too, so a state is never carried by colour alone (FR-010).
 */
export function Pill({
  tone = "accent",
  icon,
  children,
}: Readonly<{ tone?: PillTone; icon?: ReactNode; children: ReactNode }>) {
  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
