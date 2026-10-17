import type { HTMLAttributes, ReactNode } from "react";

/**
 * The widget card of the pattern set (AP-054 FR-014): a white surface with a soft decorative edge,
 * used for every group of content on every screen. `flat` drops the shadow and tints the surface,
 * for a card nested inside another. The edge is decorative (`border`), not a control outline.
 */
export function Card({
  variant = "default",
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: Readonly<
  {
    variant?: "default" | "flat";
    as?: "div" | "section" | "article";
    children: ReactNode;
  } & Omit<HTMLAttributes<HTMLElement>, "children">
>) {
  const surface = variant === "flat" ? "bg-surface-subtle" : "bg-surface shadow-sm";
  return (
    <Tag {...rest} className={`min-w-0 rounded-2xl border border-border p-4 sm:p-5 ${surface} ${className}`.trim()}>
      {children}
    </Tag>
  );
}

/** A card's title row: the heading, an optional sub-line and actions that wrap on a narrow card. */
export function CardHeader({
  title,
  titleId,
  level = 2,
  subtitle,
  actions,
}: Readonly<{
  title: string;
  titleId?: string;
  level?: 2 | 3;
  subtitle?: string;
  actions?: ReactNode;
}>) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <Heading id={titleId} className="text-base font-semibold text-text-primary">
          {title}
        </Heading>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
