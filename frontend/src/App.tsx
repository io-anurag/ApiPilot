import { useEffect, useState } from "react";
import { fetchHealth, type HealthCheckResult } from "./services/healthClient";
import { VersionBadge } from "./components/VersionBadge";
import { TestGenerationWorkflowPage } from "./pages/TestGenerationWorkflowPage";
import { ExternalCollectionsPage } from "./pages/ExternalCollectionsPage";

type ActiveTab = "guided-workflow" | "import-collection";

/** Mutually exclusive, top-level views (research.md D9, FR-011) — no react-router: two views do
 * not warrant a routing dependency, mirroring AP-009's own original decision. */
const TABS: Array<{ id: ActiveTab; label: string }> = [
  { id: "guided-workflow", label: "Guided Workflow" },
  { id: "import-collection", label: "Import & Run Collection" },
];

export function App() {
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("guided-workflow");

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
              src="/logo-icon.png"
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
        <nav className="mb-6 flex gap-1 border-b border-border" aria-label="Top-level views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                activeTab === tab.id
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {/* Both views stay mounted so switching tabs never discards either one's in-progress
         * state (e.g. a partially-filled form) — only visibility toggles. */}
        <div hidden={activeTab !== "guided-workflow"}>
          <TestGenerationWorkflowPage />
        </div>
        <div hidden={activeTab !== "import-collection"}>
          <ExternalCollectionsPage />
        </div>
      </div>
    </main>
  );
}
