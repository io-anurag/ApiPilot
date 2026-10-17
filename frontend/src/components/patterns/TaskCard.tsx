import type { MouseEvent, ReactNode } from "react";

const BASE =
  "relative flex w-full flex-col gap-0.5 rounded-xl px-3.5 py-3 pr-9 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface";

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-80">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

/**
 * The task card of the pattern set (AP-054 FR-014): a short action or item, mint by default and
 * lime when highlighted. With `href` it is a link, with `onClick` a button, with neither plain
 * content. The title and detail are always text; the tint is emphasis only.
 */
export function TaskCard({
  title,
  detail,
  highlighted = false,
  href,
  onClick,
  testId,
}: Readonly<{
  title: ReactNode;
  detail?: ReactNode;
  highlighted?: boolean;
  href?: string;
  /** Receives the click so a link can handle it in the app and leave a modified click to the browser. */
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  testId?: string;
}>) {
  const tone = highlighted
    ? "bg-accent text-on-accent ring-1 ring-inset ring-brand-500"
    : "bg-mint text-text-primary";
  const interactive = href !== undefined || onClick !== undefined ? "hover:brightness-95 motion-safe:transition" : "";
  const className = `${BASE} ${tone} ${interactive}`;
  const content = (
    <>
      <span className="text-sm font-medium">{title}</span>
      {detail && <span className={`text-xs ${highlighted ? "text-on-accent" : "text-text-secondary"}`}>{detail}</span>}
      {(href !== undefined || onClick !== undefined) && <Arrow />}
    </>
  );
  if (href !== undefined) {
    return (
      <a href={href} data-testid={testId} onClick={onClick} className={className}>
        {content}
      </a>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" data-testid={testId} onClick={onClick} className={className}>
        {content}
      </button>
    );
  }
  return (
    <div data-testid={testId} className={className}>
      {content}
    </div>
  );
}
