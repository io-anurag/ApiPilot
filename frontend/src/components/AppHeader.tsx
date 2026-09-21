import type { HealthCheckResult } from "../services/healthClient";
import { useTheme } from "../hooks/useTheme";
import { Skeleton } from "./Skeleton";
import { ThemeToggle } from "./ThemeToggle";
import { VersionBadge } from "./VersionBadge";

/**
 * The application shell's single header (spec 027 FR-001), extracted from App.tsx so every page
 * renders the same header instead of each maintaining its own copy. Pure extraction: same DOM,
 * same `data-testid="connection-status"` contract, no behavior change (FR-012).
 */
export function AppHeader({ health }: Readonly<{ health: HealthCheckResult | null }>) {
  const { theme, setTheme } = useTheme();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-chrome text-slate-950 shadow-sm dark:text-white">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-surface">
          <img
            src="/logo-icon.png"
            alt=""
            aria-hidden="true"
            className="h-8 w-8 object-contain"
          />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-base font-semibold text-slate-950 dark:text-white">
              ApiPilot
            </h1>
            <VersionBadge />
          </div>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            API test engineering workspace
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle theme={theme} onChange={setTheme} />
          {health === null && (
            <p
              data-testid="connection-status"
              className="flex items-center gap-2 border border-border bg-surface px-2.5 py-1.5 text-xs text-muted"
            >
              <Skeleton className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-500" />
              <span>Connecting…</span>
            </p>
          )}
          {health?.ok === true && (
            <p
              data-testid="connection-status"
              className="flex items-center gap-2 border border-success-500/20 bg-success-500/10 px-2.5 py-1.5 text-xs font-medium text-success-700 dark:text-success-100"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-success-500"
              />
              <span>Connected</span>
            </p>
          )}
          {health?.ok === false && (
            <p
              data-testid="connection-status"
              role="alert"
              title={health.error}
              className="flex items-center gap-2 border border-danger-500/25 bg-danger-500/10 px-2.5 py-1.5 text-xs font-medium text-danger-700 dark:text-danger-100"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-500"
              />
              <span>Disconnected</span>
            </p>
          )}
        </div>
      </div>
    </header>
  );
}
