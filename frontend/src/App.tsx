import { useEffect, useRef, useState } from "react";
import type { ExportResult } from "@apipilot/shared-domain";
import { fetchHealth, type HealthCheckResult } from "./services/healthClient";
import { AppHeader } from "./components/AppHeader";
import { Tabs } from "./components/Tabs";
import { EntryChooser, type EntryChoice } from "./components/EntryChooser";
import { TestGenerationWorkflowPage } from "./pages/TestGenerationWorkflowPage";
import { ExternalCollectionsPage } from "./pages/ExternalCollectionsPage";
import { toImportPreload, type ImportPreload } from "./services/importPreload";

type ActiveTab = EntryChoice;

/** Mutually exclusive, top-level views (research.md D9, FR-011) — no react-router: two views do
 * not warrant a routing dependency, mirroring AP-009's own original decision. */
const TABS: Array<{ id: ActiveTab; label: string }> = [
  { id: "guided-workflow", label: "Guided Workflow" },
  { id: "import-collection", label: "Import & Run Collection" },
];

export function App() {
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  // No choice made yet: only the entry chooser is shown, no tab menu (requirement: menu bar
  // visible only once a path is picked, see EntryChooser).
  const [started, setStarted] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("guided-workflow");
  // The guided workflow hides the tab menu while in progress so the user completes it before
  // switching away; "Import & Run Collection" never needs that since it is a self-contained,
  // one-shot action rather than a multi-stage flow.
  const [tabsVisible, setTabsVisible] = useState(false);
  const [importPreload, setImportPreload] = useState<ImportPreload | null>(null);
  const importPreloadTokenRef = useRef(0);

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

  function handleSelect(choice: EntryChoice) {
    setStarted(true);
    setActiveTab(choice);
    setTabsVisible(choice === "import-collection");
  }

  /** The guided workflow's "Exit workflow" control (requirement: an escape hatch while the tab
   * menu is hidden) — returns to the chooser without discarding the in-progress workflow, which
   * remains resumable via `fetchCurrentWorkflow` if the user picks "Guided Workflow" again. */
  function handleExitGuided() {
    setStarted(false);
    setActiveTab("guided-workflow");
    setTabsVisible(false);
  }

  /** Fired once the guided workflow's Postman collection has been generated: the old, duplicate
   * in-workflow "Execution" screen is replaced by handing off straight to "Import & Run
   * Collection", pre-filled with the generated artifact (requirements 3 & 4). */
  function handleHandoffToExecution(
    postmanArtifact: ExportResult,
    specTitle: string | undefined,
  ) {
    importPreloadTokenRef.current += 1;
    setImportPreload(
      toImportPreload(postmanArtifact, specTitle, importPreloadTokenRef.current),
    );
    setActiveTab("import-collection");
    setTabsVisible(true);
  }

  return (
    <main className="technical-grid min-h-screen bg-background text-slate-900 dark:text-slate-100">
      <AppHeader health={health} />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {!started && <EntryChooser onSelect={handleSelect} />}
        {started && (
          <>
            {tabsVisible && (
              <Tabs
                tabs={TABS}
                activeTab={activeTab}
                onChange={setActiveTab}
                label="Top-level views"
              />
            )}
            {/* Both views stay mounted so switching tabs never discards either one's in-progress
             * state (e.g. a partially-filled form) — only visibility toggles. */}
            <div hidden={activeTab !== "guided-workflow"}>
              <TestGenerationWorkflowPage
                onExit={handleExitGuided}
                onHandoffToExecution={handleHandoffToExecution}
              />
            </div>
            <div hidden={activeTab !== "import-collection"}>
              <ExternalCollectionsPage preload={importPreload} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
