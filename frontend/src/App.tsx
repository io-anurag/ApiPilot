import { useEffect, useRef, useState } from "react";
import type { ExportResult } from "@apipilot/shared-domain";
import { fetchHealth, type HealthCheckResult } from "./services/healthClient";
import { AppHeader } from "./components/AppHeader";
import { Tabs } from "./components/Tabs";
import { EntryChooser, type EntryChoice } from "./components/EntryChooser";
import { TestGenerationWorkflowPage } from "./pages/TestGenerationWorkflowPage";
import { ExternalCollectionsPage } from "./pages/ExternalCollectionsPage";
import { QuickPerformancePage } from "./pages/QuickPerformancePage";
import { PerformancePlanScaleMockPage } from "./pages/PerformancePlanScaleMockPage";
import { toImportPreload, type ImportPreload } from "./services/importPreload";

type ActiveTab = EntryChoice;

/** Mutually exclusive, top-level views (research.md D9, FR-011) — no react-router: three views do
 * not warrant a routing dependency, mirroring AP-009's own original decision. AP-032 adds the
 * quick performance test as the third. */
const TABS: Array<{ id: ActiveTab; label: string }> = [
  { id: "guided-workflow", label: "Guided Workflow" },
  { id: "import-collection", label: "Import & Run Collection" },
  { id: "quick-performance", label: "Quick Performance Test" },
];

export function App() {
  const showPerformancePlanScaleMock =
    new URLSearchParams(window.location.search).get("mock") === "performance-plan-scale";
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  // No choice made yet: only the entry chooser is shown, no tab menu (requirement: menu bar
  // visible only once a path is picked, see EntryChooser).
  const [started, setStarted] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("guided-workflow");
  // The guided workflow hides the tab menu while in progress so the user completes it before
  // switching away; "Import & Run Collection" never needs that since it is a self-contained,
  // one-shot action rather than a multi-stage flow.
  const [tabsVisible, setTabsVisible] = useState(false);
  // Set once the user first reaches the guided workflow, then never reset — see its use below for
  // why this must survive "Back to start" even though `started` itself does not.
  const [guidedWorkflowMounted, setGuidedWorkflowMounted] = useState(false);
  // Same idea for "Import & Run Collection": once reached it stays mounted, so "Back to start"
  // keeps its in-memory state (selection, per-run order, an in-progress run's view).
  const [importCollectionMounted, setImportCollectionMounted] = useState(false);
  // AP-032: the quick performance test, like Import & Run, stays mounted once reached so "Back to
  // start" keeps its plan on screen (FR-025); its state also lives on the server for the session.
  const [quickPerformanceMounted, setQuickPerformanceMounted] = useState(false);
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

  function mount(view: ActiveTab) {
    if (view === "guided-workflow") setGuidedWorkflowMounted(true);
    else if (view === "import-collection") setImportCollectionMounted(true);
    else setQuickPerformanceMounted(true);
  }

  function handleSelect(choice: EntryChoice) {
    setStarted(true);
    setActiveTab(choice);
    // Both standalone paths are self-contained, so the tab menu stays visible on them.
    setTabsVisible(choice !== "guided-workflow");
    mount(choice);
  }

  /** The "Back to start" control on both views (requirement: an escape hatch while the guided
   * workflow hides the tab menu) — returns to the chooser without discarding anything. The guided
   * workflow remains resumable via `fetchCurrentWorkflow`, and both pages stay mounted, so picking
   * either path again picks up where the user left off. */
  function handleExitToStart() {
    setStarted(false);
    setActiveTab("guided-workflow");
    setTabsVisible(false);
  }

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab);
    mount(tab);
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
    setImportCollectionMounted(true);
  }

  return (
    <main className="technical-grid min-h-screen bg-background text-slate-900 dark:text-slate-100">
      <AppHeader health={health} />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {showPerformancePlanScaleMock ? (
          <PerformancePlanScaleMockPage />
        ) : (
          <>
            {!started && <EntryChooser onSelect={handleSelect} />}
            {started && tabsVisible && (
              <Tabs
                tabs={TABS}
                activeTab={activeTab}
                onChange={handleTabChange}
                label="Top-level views"
              />
            )}
            {/* Deliberately NOT gated on `started`: once the guided workflow has been reached, it
             * stays mounted for the rest of the session (only `hidden` toggles), even across "Back to
             * start". Its own resume-on-mount effect re-fetches the current workflow and, if that
             * workflow already reached the `execution` stage, automatically hands off to "Import & Run
             * Collection" — guarded by a `useRef` so it fires at most once per *mounted instance*.
             * Unmounting it on "Back to start" (by gating it on `started`) would reset that guard on
             * every remount, so simply reselecting "Guided Workflow" would immediately re-trigger the
             * handoff and bounce the user straight back to "Import & Run Collection" instead of
             * letting them view the guided workflow again. */}
            {guidedWorkflowMounted && (
              <div hidden={!started || activeTab !== "guided-workflow"}>
                <TestGenerationWorkflowPage
                  onExit={handleExitToStart}
                  onHandoffToExecution={handleHandoffToExecution}
                />
              </div>
            )}
            {importCollectionMounted && (
              <div hidden={!started || activeTab !== "import-collection"}>
                <ExternalCollectionsPage
                  preload={importPreload}
                  onExit={handleExitToStart}
                />
              </div>
            )}
            {quickPerformanceMounted && (
              <div hidden={!started || activeTab !== "quick-performance"}>
                <QuickPerformancePage onExit={handleExitToStart} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
