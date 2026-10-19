import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ExportResult, WorkflowStageId } from "@apipilot/shared-domain";
import { fetchHealth, type HealthCheckResult } from "./services/healthClient";
import { AppShell } from "./components/shell/AppShell";
import type { EntryChoice } from "./components/workflowCatalog";
import type { RecentRun } from "./components/home/homeViewModel";
import { HomePage } from "./pages/HomePage";
import { isResultsView } from "./components/workflowCatalog";
import { CommandPalette } from "./components/CommandPalette";
import {
  buildCommands,
  isEditableTarget,
  isMacPlatform,
  isPaletteShortcut,
  shortcutLabel,
  type Command,
} from "./components/paletteCommands";
import { Skeleton } from "./components/Skeleton";
import { toImportPreload, type ImportPreload } from "./services/importPreload";
import type { OpenPerformancePlanRequest } from "./pages/PerformancePage";
import { ActiveViewContext } from "./components/requestChain/activeView";
import { useCoverageEntry } from "./hooks/useCoverageEntry";
import { useTheme } from "./hooks/useTheme";
import { useWorkflowSnapshot } from "./hooks/useWorkflowSnapshot";
import { destinationOfView, viewOfDestination } from "./navigation/destinations";
import type { DestinationId, Route } from "./navigation/routes";
import { useRoute } from "./navigation/useRoute";

// Each top-level view is its own chunk, fetched the first time it is mounted: bundled together they
// exceeded Vite's 500 kB chunk warning, and a session usually visits only one or two of them. The
// pages use named exports, so each import is adapted to the `default` shape `lazy` expects.
const TestGenerationWorkflowPage = lazy(() =>
  import("./pages/TestGenerationWorkflowPage").then((m) => ({ default: m.TestGenerationWorkflowPage })),
);
const ExternalCollectionsPage = lazy(() =>
  import("./pages/ExternalCollectionsPage").then((m) => ({ default: m.ExternalCollectionsPage })),
);
const PerformancePage = lazy(() =>
  import("./pages/PerformancePage").then((m) => ({ default: m.PerformancePage })),
);
const UserScriptPage = lazy(() =>
  import("./pages/UserScriptPage").then((m) => ({ default: m.UserScriptPage })),
);
const CoveragePage = lazy(() => import("./pages/CoveragePage").then((m) => ({ default: m.CoveragePage })));
const SecurityLabPage = lazy(() => import("./pages/SecurityLabPage").then((m) => ({ default: m.SecurityLabPage })));
const PerformancePlanScaleMockPage = lazy(() =>
  import("./pages/PerformancePlanScaleMockPage").then((m) => ({ default: m.PerformancePlanScaleMockPage })),
);
const PatternLibraryPage = lazy(() =>
  import("./pages/PatternLibraryPage").then((m) => ({ default: m.PatternLibraryPage })),
);

/** One boundary per view, so the first load of one view never suspends (and hides) another that
 * is already mounted. A chunk that fails to load throws to `AppErrorBoundary` (main.tsx). */
function LazyView({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading view">
          <Skeleton className="h-40 w-full rounded bg-surface-strong" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * The application. Each destination has a hash address (navigation/routes.ts; no router library,
 * mirroring AP-009's original decision) and is shown inside one shell (AP-054): a persistent
 * sidebar and a page header. A page, once reached, stays mounted and is merely hidden while another
 * destination is shown, which is what keeps drafts, selections, editor changes and run progress
 * across navigation (FR-005).
 */
export function App() {
  // `?mock=` opens a design preview instead of the pages: the Performance plan at scale, and (AP-054
  // FR-014) the pattern library. Neither reads or writes anything.
  const mockPreview = new URLSearchParams(window.location.search).get("mock");
  const showPerformancePlanScaleMock = mockPreview === "performance-plan-scale";
  const showPatternLibrary = mockPreview === "pattern-library";
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const { theme, setTheme } = useTheme();
  // AP-038 US3: the command palette. Its commands are derived from state on every opening and
  // never stored; every action goes through the same handlers the sidebar and the theme control
  // use (research.md D8), so the palette cannot reach a state they cannot.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const shortcutHint = shortcutLabel(isMacPlatform(typeof navigator === "undefined" ? undefined : navigator));

  const snapshot = useWorkflowSnapshot();
  const { route, notice, navigate, replaceRoute } = useRoute({ workflow: snapshot.workflow, ready: snapshot.ready });
  const view = route.view;
  // The stage the Guided Workflow page reports it is showing, for the address and the sidebar.
  const [viewedStage, setViewedStage] = useState<WorkflowStageId | null>(null);

  // Pages reached at least once, kept mounted from then on (only `hidden` toggles). Updated while
  // rendering, so the page appears in the same commit as the destination change.
  const [mounted, setMounted] = useState<ReadonlySet<DestinationId>>(() => new Set([view]));
  // An address that names a Guided Workflow stage cannot be judged until the workflow has been read.
  const awaitingWorkflow = view === "guided" && route.stage !== undefined && !snapshot.ready;
  if (!awaitingWorkflow && !mounted.has(view)) setMounted(new Set(mounted).add(view));

  // AP-046: Import & Run Collection shows what is known about coverage; it is read only while it
  // is on screen, and again whenever the user comes back to it. (Home reads its own figures.)
  const coverageEntry = useCoverageEntry(view === "import");
  // Coverage's "Open results" asks Import & Run to open the results of that run.
  const [importRunRequest, setImportRunRequest] = useState<{ runId: string; token: number }>();
  // An address `#/guided/<stage>` (or Coverage's "Open scenarios") asks the guided workflow to show
  // that stage. Derived while rendering so a page mounting on such an address receives it at mount,
  // which also replaces the automatic hand-off to Import & Run that resuming at `execution` would do.
  const [guidedStageRequest, setGuidedStageRequest] = useState<{ stageId: WorkflowStageId; token: number }>();
  const [lastRoutedStage, setLastRoutedStage] = useState<WorkflowStageId | undefined>();
  const routedStage = view === "guided" && snapshot.ready ? route.stage : undefined;
  if (routedStage !== lastRoutedStage) {
    setLastRoutedStage(routedStage);
    if (routedStage !== undefined) {
      setGuidedStageRequest((previous) => ({ stageId: routedStage, token: (previous?.token ?? 0) + 1 }));
    }
  }
  // Home's Recent runs asks Run k6 Script to open one run's report on its owning script.
  const [k6RunRequest, setK6RunRequest] = useState<{ scriptId: string; runId: string; token: number }>();
  // Whether Performance holds an unfinished test with no plan yet, so the start screen can say so (AP-047 FR-019).
  const [performanceDraft, setPerformanceDraft] = useState(false);
  // AP-037: a seeding entry point opens a plan by id; since AP-047 it opens in Performance, on the Plan step.
  const [openChainPlanRequest, setOpenChainPlanRequest] = useState<OpenPerformancePlanRequest | null>(null);
  const openChainPlanNonce = useRef(0);
  // AP-036: mounted when a collection's run panel hands its selection over, then kept like the others.
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

  /** Ctrl+K / Cmd+K opens the palette — never from a text field or over another dialog, where the
   * keystroke is left untouched (FR-018). While the palette is open the shortcut only suppresses
   * the browser's own Ctrl+K action (FR-017). Every app dialog renders through `Dialog`, so an
   * `aria-modal` element in the document means one is open. */
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isPaletteShortcut(event)) return;
      if (paletteOpen) {
        event.preventDefault();
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setPaletteOpen(true);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [paletteOpen]);

  // The Guided Workflow page reports the stage it is showing. Keep the address on it, without a
  // history entry, so a refresh or a bookmark returns to the same stage.
  const viewRef = useRef(view);
  viewRef.current = view;
  const handleViewedStageChange = useCallback(
    (stageId: WorkflowStageId | null) => {
      setViewedStage(stageId);
      if (stageId !== null && viewRef.current === "guided") replaceRoute({ view: "guided", stage: stageId });
    },
    [replaceRoute],
  );

  /** AP-037 FR-020: an entry point seeded a request-chain plan; show it in Performance, on its Plan step. */
  function handleOpenChainPlan(planId: string) {
    openChainPlanNonce.current += 1;
    setOpenChainPlanRequest({ planId, nonce: openChainPlanNonce.current });
    navigate({ view: "performance" });
  }

  /** AP-046: open Coverage from a contextual link (scenario review, run results) or the palette. */
  function handleOpenCoverage() {
    navigate({ view: "coverage" });
  }

  /** Coverage's own links back into the workflows. */
  function handleOpenWorkflowFromCoverage(target: "guided-workflow" | "import-collection", options?: { runId?: string }) {
    if (target === "guided-workflow") {
      navigate({ view: "guided", stage: "scenarioReview" });
    } else {
      const runId = options?.runId;
      if (runId) setImportRunRequest((prev) => ({ runId, token: (prev?.token ?? 0) + 1 }));
      navigate({ view: "import" });
    }
  }

  function handleSelect(choice: EntryChoice) {
    navigate({ view: destinationOfView(choice) });
  }

  /** Home's Recent runs: open one run's results on its own screen. The request is held in memory
   * with a token (the pattern the other seeding requests use); the address carries no id. */
  function handleOpenRun(run: RecentRun) {
    const { workflow, ownerId, runId } = run.target;
    if (workflow === "import") {
      setImportRunRequest((prev) => ({ runId, token: (prev?.token ?? 0) + 1 }));
      navigate({ view: "import" });
    } else if (workflow === "performance") {
      openChainPlanNonce.current += 1;
      setOpenChainPlanRequest({ planId: ownerId, nonce: openChainPlanNonce.current, runId });
      navigate({ view: "performance" });
    } else {
      setK6RunRequest((prev) => ({ scriptId: ownerId, runId, token: (prev?.token ?? 0) + 1 }));
      navigate({ view: "k6" });
    }
  }

  function runCommand(command: Command) {
    setPaletteOpen(false);
    if (command.kind === "workflow") {
      if (isResultsView(command.id)) navigate({ view: command.id });
      else handleSelect(command.id);
    } else if (command.kind === "go-home") {
      navigate({ view: "home" });
    } else {
      setTheme(command.target);
    }
  }

  /** Fired once the guided workflow's Postman collection has been generated: the old, duplicate
   * in-workflow "Execution" screen is replaced by handing off straight to "Import & Run
   * Collection", pre-filled with the generated artifact (requirements 3 & 4). */
  function handleHandoffToExecution(
    postmanArtifact: ExportResult,
    specTitle: string | undefined,
    workflowId: string,
  ) {
    importPreloadTokenRef.current += 1;
    setImportPreload(
      toImportPreload(postmanArtifact, specTitle, importPreloadTokenRef.current, workflowId),
    );
    navigate({ view: "import" });
  }

  const goTo = useCallback((next: Route) => navigate(next), [navigate]);

  return (
    <>
      <AppShell
        route={route}
        workflow={snapshot.workflow}
        viewedStage={viewedStage}
        notice={notice}
        health={health}
        theme={theme}
        onThemeChange={setTheme}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        shortcutHint={shortcutHint}
        onNavigate={goTo}
      >
        {showPerformancePlanScaleMock && (
          <LazyView>
            <PerformancePlanScaleMockPage />
          </LazyView>
        )}
        {showPatternLibrary && (
          <LazyView>
            <PatternLibraryPage />
          </LazyView>
        )}
        {!showPerformancePlanScaleMock && !showPatternLibrary && (
          <ActiveViewContext.Provider value={viewOfDestination(view)}>
            {mounted.has("home") && (
              <div hidden={view !== "home"}>
                <HomePage
                  active={view === "home"}
                  workflow={snapshot.workflow}
                  workflowReady={snapshot.ready}
                  performanceDraft={performanceDraft}
                  shortcutHint={shortcutHint}
                  onSelect={handleSelect}
                  onOpen={goTo}
                  onOpenRun={handleOpenRun}
                />
              </div>
            )}
            {awaitingWorkflow && (
              <div role="status" aria-label="Loading view">
                <Skeleton className="h-40 w-full rounded bg-surface-strong" />
              </div>
            )}
            {/* Deliberately kept mounted once reached (only `hidden` toggles): its own resume-on-mount
             * effect re-fetches the current workflow and, if that workflow already reached the
             * `execution` stage, automatically hands off to "Import & Run Collection" — guarded by a
             * `useRef` so it fires at most once per *mounted instance*. Unmounting it whenever another
             * destination is shown would reset that guard on every remount, so simply returning to the
             * Guided Workflow would immediately re-trigger the handoff and bounce the user straight
             * back to "Import & Run Collection". */}
            {mounted.has("guided") && (
              <div hidden={view !== "guided"}>
                <LazyView>
                  <TestGenerationWorkflowPage
                    onHandoffToExecution={handleHandoffToExecution}
                    onOpenChainPlan={handleOpenChainPlan}
                    onOpenCoverage={handleOpenCoverage}
                    onOpenImportRun={() => navigate({ view: "import" })}
                    onWorkflowChange={snapshot.update}
                    onViewedStageChange={handleViewedStageChange}
                    stageRequest={guidedStageRequest}
                    isVisible={view === "guided"}
                  />
                </LazyView>
              </div>
            )}
            {mounted.has("import") && (
              <div hidden={view !== "import"}>
                <LazyView>
                  <ExternalCollectionsPage
                    preload={importPreload}
                    onOpenChainPlan={handleOpenChainPlan}
                    coverage={coverageEntry}
                    onOpenCoverage={handleOpenCoverage}
                    openRunRequest={importRunRequest}
                  />
                </LazyView>
              </div>
            )}
            {mounted.has("performance") && (
              <div hidden={view !== "performance"}>
                <LazyView>
                  <PerformancePage openRequest={openChainPlanRequest} onDraftChange={setPerformanceDraft} />
                </LazyView>
              </div>
            )}
            {mounted.has("coverage") && (
              <div hidden={view !== "coverage"}>
                <LazyView>
                  <CoveragePage onOpenWorkflow={handleOpenWorkflowFromCoverage} />
                </LazyView>
              </div>
            )}
            {mounted.has("security") && (
              <div hidden={view !== "security"}>
                <LazyView>
                  <SecurityLabPage
                    specificationLoaded={snapshot.ready ? snapshot.workflow?.apiModel !== undefined : null}
                    area={view === "security" ? route.area : undefined}
                    onAreaChange={(area) => navigate({ view: "security", area })}
                  />
                </LazyView>
              </div>
            )}
            {mounted.has("k6") && (
              <div hidden={view !== "k6"}>
                <LazyView>
                  <UserScriptPage openRunRequest={k6RunRequest} />
                </LazyView>
              </div>
            )}
          </ActiveViewContext.Provider>
        )}
      </AppShell>
      {paletteOpen && (
        <CommandPalette
          commands={buildCommands({ homeShown: view === "home", theme })}
          onRun={runCommand}
          onClose={() => setPaletteOpen(false)}
          shortcutHint={shortcutHint}
        />
      )}
    </>
  );
}
