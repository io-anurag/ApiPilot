import { forwardRef, useState, type Ref } from "react";
import type { HealthCheckResult } from "../../services/healthClient";
import type { Theme } from "../../hooks/useTheme";
import type { HeaderTitle } from "../../navigation/destinations";
import { HelpDialog } from "../HelpDialog";
import { Skeleton } from "../Skeleton";
import { ThemeToggle } from "../ThemeToggle";

const ICON_BUTTON =
  "flex h-9 items-center justify-center gap-2 rounded-full border border-border-control bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:ring-offset-chrome";

function ConnectionStatus({ health }: Readonly<{ health: HealthCheckResult | null }>) {
  if (health === null) {
    return (
      <p
        data-testid="connection-status"
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted"
      >
        <Skeleton className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-500" />
        <span>Connecting…</span>
      </p>
    );
  }
  if (health.ok) {
    return (
      <p
        data-testid="connection-status"
        className="flex items-center gap-2 rounded-full border border-success-500/25 bg-success-500/10 px-3 py-1.5 text-xs font-medium text-success-700 dark:text-success-100"
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-success-500 ring-2 ring-success-500/20" />
        <span>Connected</span>
      </p>
    );
  }
  return (
    <p
      data-testid="connection-status"
      role="alert"
      title={health.error}
      className="flex items-center gap-2 rounded-full border border-danger-500/25 bg-danger-500/10 px-3 py-1.5 text-xs font-medium text-danger-700 dark:text-danger-100"
    >
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-danger-500 ring-2 ring-danger-500/20" />
      <span>Disconnected</span>
    </p>
  );
}

/**
 * The page header (AP-054 FR-004): the screen's title with its parent as a breadcrumb, the
 * command-palette control with its shortcut, the connection status, the theme control and the
 * help control; below `lg` also the button that opens the navigation drawer. The
 * `data-testid="connection-status"` contract and its three states are unchanged.
 */
export const PageHeader = forwardRef(function PageHeader(
  {
    heading,
    health,
    theme,
    onThemeChange,
    onOpenCommandPalette,
    shortcutHint,
    drawerOpen,
    drawerId,
    onToggleDrawer,
  }: Readonly<{
    heading: HeaderTitle;
    health: HealthCheckResult | null;
    theme: Theme;
    onThemeChange: (theme: Theme) => void;
    onOpenCommandPalette: () => void;
    /** "Ctrl K" or "⌘ K", resolved once by App for the platform. */
    shortcutHint: string;
    drawerOpen: boolean;
    drawerId: string;
    onToggleDrawer: () => void;
  }>,
  menuButtonRef: Ref<HTMLButtonElement>,
) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-chrome text-text-primary">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <button
          ref={menuButtonRef}
          type="button"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls={drawerId}
          data-testid="menu-button"
          onClick={(event) => {
            event.currentTarget.focus();
            onToggleDrawer();
          }}
          className={`${ICON_BUTTON} w-9 shrink-0 lg:hidden`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-xs text-muted">{heading.parent}</p>
          <h1 className="truncate font-display text-lg font-bold tracking-tight text-text-primary">{heading.title}</h1>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end sm:gap-3">
          <button
            type="button"
            aria-label="Open command palette"
            title={`Open command palette (${shortcutHint})`}
            onClick={onOpenCommandPalette}
            className={`${ICON_BUTTON} w-9 sm:w-auto sm:px-3`}
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
            className={`${ICON_BUTTON} w-9`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01" />
            </svg>
          </button>
          <ConnectionStatus health={health} />
        </div>
      </div>
      {helpOpen && <HelpDialog shortcutHint={shortcutHint} onClose={() => setHelpOpen(false)} />}
    </header>
  );
});
