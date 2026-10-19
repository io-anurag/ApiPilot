import { useState } from "react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { useCoverage } from "../hooks/useCoverage";
import { useAiStatus } from "../hooks/useAiStatus";
import { useRecentRuns } from "../hooks/useRecentRuns";
import type { Route } from "../navigation/routes";
import type { EntryChoice } from "../components/workflowCatalog";
import { HelpDialog } from "../components/HelpDialog";
import { HomeHero } from "../components/home/HomeHero";
import { ArtifactStep, LaunchStep, ResultsLinks } from "../components/home/LaunchTiles";
import { AiProviderCard, InsightsStep, NextStepsCard, RecentRunsCard } from "../components/home/HomeWidgets";
import { nextSteps, summaryFigures, type RecentRun } from "../components/home/homeViewModel";

/** The unfiltered query: Home always describes the whole specification, like the Coverage screen's own totals. */
const WHOLE_SPECIFICATION = {} as const;

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/**
 * Home (AP-054 FR-018 to FR-021, amended by AP-058 and redesigned by AP-059). One layout in every state: a welcome hero,
 * three numbered steps (start with the artifact you have, launch a test session, explore results and insights), the next
 * steps and recent runs, and the AI provider. Only figures backed by data the application already holds appear, each a
 * text reason when it has none. It reads only while it is the visible destination (the page stays mounted when hidden),
 * once per visit, and never polls; every part renders as its own data arrives, so a slow source never blocks the rest.
 */
export function HomePage({
  active,
  workflow,
  workflowReady,
  performanceDraft,
  shortcutHint,
  onSelect,
  onOpen,
  onOpenRun,
}: Readonly<{
  /** Whether Home is the destination on screen. */
  active: boolean;
  workflow: TestGenerationWorkflow | null;
  /** False until the session's workflow has been read once. Next steps wait for it, so they never change after first paint. */
  workflowReady: boolean;
  performanceDraft: boolean;
  /** The command-palette shortcut as the platform writes it, for the Help dialog "Learn more" opens. */
  shortcutHint: string;
  onSelect: (choice: EntryChoice) => void;
  onOpen: (route: Route) => void;
  onOpenRun: (run: RecentRun) => void;
}>) {
  const [helpOpen, setHelpOpen] = useState(false);
  const coverage = useCoverage(WHOLE_SPECIFICATION, active);
  const ai = useAiStatus(active);
  const recentRuns = useRecentRuns(active);
  const { snapshot } = coverage;
  const steps = nextSteps({ workflow, snapshot, performanceDraft });

  // A specification is loaded when the session holds a workflow or coverage could be calculated for one.
  const hasSpecification = workflow !== null || snapshot !== null;
  const name = workflow?.apiModel?.info?.title ?? workflow?.specificationFilename ?? "Your specification";
  const counts = snapshot === null ? "" : `${plural(snapshot.operations.length, "operation", "operations")} · ${plural(snapshot.context.scenarioCounts.total, "scenario", "scenarios")}`;
  const detail = [workflow?.specificationFilename !== name ? workflow?.specificationFilename : undefined, counts].filter(Boolean).join(" · ");

  return (
    <div className="space-y-8" data-testid="home-page">
      <HomeHero onGetStarted={() => onSelect("guided-workflow")} onLearnMore={() => setHelpOpen(true)} />
      <ArtifactStep onSelect={onSelect} />
      <LaunchStep onSelect={onSelect} performanceDraft={performanceDraft} />
      <InsightsStep
        specification={hasSpecification ? { title: name, detail } : null}
        figures={summaryFigures({ snapshot, problem: coverage.problem })}
        coverageLoaded={snapshot !== null}
        coverageFailed={coverage.problem?.kind === "error"}
        links={<ResultsLinks onOpen={onOpen} />}
      />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <NextStepsCard steps={steps} ready={workflowReady} onOpen={onOpen} />
        </div>
        <div className="lg:col-span-3">
          <RecentRunsCard state={recentRuns} onOpen={onOpenRun} />
        </div>
      </div>
      <AiProviderCard state={ai} />
      {helpOpen && <HelpDialog shortcutHint={shortcutHint} onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
