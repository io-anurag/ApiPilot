import { useEffect, useState } from "react";
import { fetchHealth, type HealthCheckResult } from "./services/healthClient";
import { AppHeader } from "./components/AppHeader";
import { Tabs } from "./components/Tabs";
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
    <main className="technical-grid min-h-screen bg-background text-slate-900 dark:text-slate-100">
      <AppHeader health={health} />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} label="Top-level views" />
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
