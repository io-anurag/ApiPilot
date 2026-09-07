import { useEffect, useState } from "react";
import { fetchHealth, type HealthCheckResult } from "./services/healthClient";
import { VersionBadge } from "./components/VersionBadge";
import { TestGenerationWorkflowPage } from "./pages/TestGenerationWorkflowPage";

export function App() {
  const [health, setHealth] = useState<HealthCheckResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchHealth().then((result) => {
      if (!cancelled) {
        setHealth(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="technical-grid min-h-screen bg-background text-slate-900">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950 text-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-white/15 bg-white/5">
            <img
              src="/logo.png"
              alt=""
              aria-hidden="true"
              className="h-8 w-8 object-contain"
            />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-2.5">
              <h1 className="text-base font-semibold text-white">ApiPilot</h1>
              <VersionBadge />
            </div>
            <p className="truncate text-xs text-slate-400">
              API test engineering workspace
            </p>
          </div>
          {health === null && (
            <p
              data-testid="connection-status"
              className="ml-auto flex items-center gap-2 border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-500"
              />
              <span>Connecting…</span>
            </p>
          )}
          {health?.ok === true && (
            <p
              data-testid="connection-status"
              className="ml-auto flex items-center gap-2 border border-success-500/20 bg-success-500/10 px-2.5 py-1.5 text-xs font-medium text-success-100"
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
              className="ml-auto flex items-center gap-2 border border-danger-500/25 bg-danger-500/10 px-2.5 py-1.5 text-xs font-medium text-danger-100"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-500"
              />
              <span>Disconnected</span>
            </p>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <TestGenerationWorkflowPage />
      </div>
    </main>
  );
}
