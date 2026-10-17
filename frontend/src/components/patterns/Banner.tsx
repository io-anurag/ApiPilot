import type { ReactNode } from "react";

export type BannerTone = "warning" | "neutral" | "error";

const TONE_CLASSES: Record<BannerTone, string> = {
  warning: "border-warning-600/30 bg-warning-100 dark:bg-warning-500/10",
  neutral: "border-border bg-mint",
  error: "border-danger-600/30 bg-danger-100 dark:bg-danger-500/10",
};

const ICON_CLASSES: Record<BannerTone, string> = {
  warning: "text-warning-700 dark:text-warning-100",
  neutral: "text-text-secondary",
  error: "text-danger-700 dark:text-danger-100",
};

function ToneIcon({ tone }: Readonly<{ tone: BannerTone }>) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, className: `mt-0.5 h-4 w-4 shrink-0 ${ICON_CLASSES[tone]}` } as const;
  if (tone === "neutral") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5m0-8h.01" />
      </svg>
    );
  }
  if (tone === "error") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6m0-6-6 6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3 2 20h20L12 3Zm0 7v5m0 3h.01" />
    </svg>
  );
}

/**
 * The banner of the pattern set (AP-054 FR-014): a bordered, tinted message with an icon, a bold
 * title and optional body. The tone is also carried by the icon shape and the title text, so it
 * is never colour alone. Pass `role` ("status" or "alert") when it must be announced.
 */
export function Banner({
  tone = "warning",
  title,
  role,
  testId,
  children,
}: Readonly<{
  tone?: BannerTone;
  title: string;
  role?: "status" | "alert";
  testId?: string;
  children?: ReactNode;
}>) {
  return (
    <div role={role} data-testid={testId} data-tone={tone} className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-text-primary ${TONE_CLASSES[tone]}`}>
      <ToneIcon tone={tone} />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-text-secondary">{children}</div>}
      </div>
    </div>
  );
}
