import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { useCoverage } from "../hooks/useCoverage";
import { useAiStatus } from "../hooks/useAiStatus";
import { useRecentRuns } from "../hooks/useRecentRuns";
import type { Route } from "../navigation/routes";
import type { EntryChoice } from "../components/workflowCatalog";
import { LaunchTiles } from "../components/home/LaunchTiles";
import { AiStatusTile, CoverageByArea, MethodBreakdown, NextSteps, RecentRunsCard, SummaryTiles } from "../components/home/HomeWidgets";
import { nextSteps, summaryFigures, type RecentRun } from "../components/home/homeViewModel";

/** The unfiltered query: Home always describes the whole specification, like the Coverage screen's own totals. */
const WHOLE_SPECIFICATION = {} as const;

/**
 * Home (AP-054 FR-018 to FR-021): the launch tiles, then only figures backed by data the application
 * already holds, each a text reason when it has none. It reads only while it is the visible
 * destination (the page stays mounted when hidden), once per visit, and never polls; every widget
 * renders as its own data arrives, so a slow source never blocks the rest. The connection and the
 * rest of the shell are unaffected when a read fails.
 */
export function HomePage({
  active,
  workflow,
  performanceDraft,
  onSelect,
  onOpen,
  onOpenRun,
}: Readonly<{
  /** Whether Home is the destination on screen. */
  active: boolean;
  workflow: TestGenerationWorkflow | null;
  performanceDraft: boolean;
  onSelect: (choice: EntryChoice) => void;
  onOpen: (route: Route) => void;
  onOpenRun: (run: RecentRun) => void;
}>) {
  const coverage = useCoverage(WHOLE_SPECIFICATION, active);
  const ai = useAiStatus(active);
  const recentRuns = useRecentRuns(active);
  const source = { snapshot: coverage.snapshot, problem: coverage.problem };
  const reason = summaryFigures(source).find((figure) => figure.state === "unavailable");

  return (
    <div className="space-y-6" data-testid="home-page">
      <LaunchTiles onSelect={onSelect} performanceDraft={performanceDraft} />
      <SummaryTiles figures={summaryFigures(source)} />
      <div className="grid gap-5 lg:grid-cols-2">
        <CoverageByArea snapshot={coverage.snapshot} reason={reason?.state === "unavailable" ? reason.reason : ""} />
        <MethodBreakdown snapshot={coverage.snapshot} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <NextSteps steps={nextSteps({ workflow, snapshot: coverage.snapshot, performanceDraft })} onOpen={onOpen} />
        <RecentRunsCard state={recentRuns} onOpen={onOpenRun} />
      </div>
      <AiStatusTile state={ai} />
    </div>
  );
}
