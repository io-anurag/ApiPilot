import { useState } from "react";
import type { HealthCheckResult } from "../services/healthClient";
import type { Theme } from "../hooks/useTheme";
import { HelpDialog } from "./HelpDialog";
import { Skeleton } from "./Skeleton";
import { ThemeToggle } from "./ThemeToggle";
import { VersionBadge } from "./VersionBadge";

const ICON_BUTTON =
  "flex h-8 items-center justify-center gap-2 rounded-full border border-border bg-surface text-muted hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:ring-offset-chrome dark:hover:text-white";

/**
 * The application shell's single header (spec 027 FR-001), extracted from App.tsx so every page
 * renders the same header instead of each maintaining its own copy. The
 * `data-testid="connection-status"` contract is unchanged.
 *
 * AP-038 (Design A): the theme is owned by App (research.md D5) so the command palette shares it;
 * the header adds a help button (its dialog lists the shortcuts and workflows) and a command
 * palette button showing the platform's shortcut. The connection status stays a plain status —
 * no dropdown affordance, since nothing sits behind it (FR-007).
 */
export function AppHeader({
  health,
  theme,
  onThemeChange,
  onOpenCommandPalette,
  shortcutHint,
}: Readonly<{
  health: HealthCheckResult | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onOpenCommandPalette: () => void;
  /** "Ctrl K" or "⌘ K", resolved once by App for the platform. */
  shortcutHint: string;
}>) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-chrome text-slate-950 shadow-sm dark:text-white">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
          <img
            src="/logo-icon.png"
            alt=""
            aria-hidden="true"
            className="h-8 w-8 object-contain"
          />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate font-display text-lg font-bold tracking-tight text-slate-950 dark:text-white">
              ApiPilot
            </h1>
            {/* Narrow screens keep the controls on the right reachable before the version. */}
            <span className="hidden sm:inline-flex">
              <VersionBadge />
            </span>
          </div>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            API test engineering workspace
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            aria-label="Open command palette"
            title={`Open command palette (${shortcutHint})`}
            onClick={onOpenCommandPalette}
            className={`${ICON_BUTTON} w-8 sm:w-auto sm:px-3`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4 shrink-0" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <kbd className="hidden font-mono text-[11px] sm:inline">{shortcutHint}</kbd>
          </button>
          <ThemeToggle theme={theme} onChange={onThemeChange} />
          <button
            type="button"
            aria-label="Keyboard shortcuts and help"
            title="Keyboard shortcuts and help"
            onClick={() => setHelpOpen(true)}
            className={`${ICON_BUTTON} w-8`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01" />
            </svg>
          </button>
          {health === null && (
            <p
              data-testid="connection-status"
              className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted"
            >
              <Skeleton className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-500" />
              <span>Connecting…</span>
            </p>
          )}
          {health?.ok === true && (
            <p
              data-testid="connection-status"
              className="flex items-center gap-2 rounded-full border border-success-500/25 bg-success-500/10 px-3 py-1.5 text-xs font-medium text-success-700 dark:text-success-100"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-success-500 ring-2 ring-success-500/20"
              />
              <span>Connected</span>
            </p>
          )}
          {health?.ok === false && (
            <p
              data-testid="connection-status"
              role="alert"
              title={health.error}
              className="flex items-center gap-2 rounded-full border border-danger-500/25 bg-danger-500/10 px-3 py-1.5 text-xs font-medium text-danger-700 dark:text-danger-100"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-danger-500 ring-2 ring-danger-500/20"
              />
              <span>Disconnected</span>
            </p>
          )}
        </div>
      </div>
      {helpOpen && <HelpDialog shortcutHint={shortcutHint} onClose={() => setHelpOpen(false)} />}
    </header>
  );
}
