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
    <main className="min-h-screen bg-background text-slate-900">
      <header className="sticky top-0 z-10 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <img src="/logo.png" alt="" aria-hidden="true" className="h-12 w-12 shrink-0 object-contain" />
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">ApiPilot</h1>
              <VersionBadge />
            </div>
            <p className="text-xs text-muted">API test engineering, from spec to suite</p>
          </div>
          {health === null && (
            <p data-testid="connection-status" className="ml-auto flex items-center gap-2 text-sm text-muted">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warning-500" />
              <span>Connecting…</span>
            </p>
          )}
          {health?.ok === true && (
            <p
              data-testid="connection-status"
              className="ml-auto flex items-center gap-2 text-sm text-success-700"
            >
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-success-500" />
              <span>Connected</span>
            </p>
          )}
          {health?.ok === false && (
            <p
              data-testid="connection-status"
              role="alert"
              title={health.error}
              className="ml-auto flex items-center gap-2 text-sm font-medium text-danger-700"
            >
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-danger-500" />
              <span>Disconnected</span>
            </p>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">
        <TestGenerationWorkflowPage />
      </div>
    </main>
  );
}
