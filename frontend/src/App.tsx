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
      <header className="flex items-center gap-3 border-b border-border bg-surface px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">ApiPilot</h1>
        <VersionBadge />
        {health === null && (
          <p data-testid="connection-status" className="ml-auto text-sm text-muted">
            Checking backend…
          </p>
        )}
        {health?.ok === true && (
          <p data-testid="connection-status" className="ml-auto text-sm text-success-700">
            Backend connected ({health.data.status})
          </p>
        )}
        {health?.ok === false && (
          <p data-testid="connection-status" role="alert" className="ml-auto text-sm font-medium text-danger-700">
            Backend unreachable: {health.error}
          </p>
        )}
      </header>
      <div className="mx-auto max-w-5xl px-6 py-6">
        <TestGenerationWorkflowPage />
      </div>
    </main>
  );
}
