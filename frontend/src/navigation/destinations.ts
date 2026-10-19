import type { TestGenerationWorkflow, WorkflowStageId } from "@apipilot/shared-domain";
import { RESULTS_VIEWS, WORKFLOWS, isResultsView, type EntryChoice, type TopLevelView } from "../components/workflowCatalog";
import {
  STAGE_LABELS,
  WORKFLOW_PHASES,
  getLockReason,
  getPhaseOfStage,
  type WorkflowPhaseId,
} from "../components/workflowStageViewModel";
import type { DestinationId, Route } from "./routes";

/**
 * What the sidebar and the page header show for each destination (AP-054 data-model.md:
 * Destination). Derived on every render from a fixed catalog and the current workflow; nothing is
 * stored, and the stage model is read from `workflowStageViewModel`, never copied.
 */

export interface TopDestination {
  readonly id: Exclude<DestinationId, "home" | "guided">;
  readonly label: string;
}

const VIEW_OF_WORKFLOW: Readonly<Record<EntryChoice, DestinationId>> = {
  "guided-workflow": "guided",
  "import-collection": "import",
  performance: "performance",
  "user-script": "k6",
};

/** Workflow titles come from `workflowCatalog`, so "Import & Run Collection" is named in full everywhere. */
export function titleOfDestination(id: DestinationId): string {
  if (id === "home") return "Home";
  const resultsView = RESULTS_VIEWS.find((view) => view.id === id);
  if (resultsView) return resultsView.tabLabel;
  const workflow = WORKFLOWS.find((candidate) => VIEW_OF_WORKFLOW[candidate.id] === id);
  return workflow?.title ?? id;
}

/** The sidebar's destinations below Guided Workflow, in order (Home and Guided Workflow are fixed). */
export const TOP_DESTINATIONS: readonly TopDestination[] = [
  { id: "import", label: titleOfDestination("import") },
  { id: "performance", label: titleOfDestination("performance") },
  { id: "k6", label: titleOfDestination("k6") },
  { id: "coverage", label: titleOfDestination("coverage") },
  // AP-057: directly after Coverage, the analysis destination, and beside Import & Run Collection, the execution one.
  { id: "security", label: titleOfDestination("security") },
];

export type StageState = "done" | "stale" | "available" | "locked";

export interface StageItem {
  readonly id: WorkflowStageId;
  readonly label: string;
  readonly state: StageState;
  /** True for the stage on screen. Exactly one stage is current while the Guided Workflow is shown. */
  readonly current: boolean;
  /** Set for a locked stage: why it cannot be opened yet. */
  readonly lockReason: string | null;
  readonly optional: boolean;
}

export interface StageGroup {
  readonly id: WorkflowPhaseId;
  readonly label: string;
  readonly stages: readonly StageItem[];
}

const DONE = new Set(["complete", "skipped", "partial"]);

/**
 * The eleven stages in their four groups, each as done, needs-redo, available (the stage the
 * workflow is on) or locked with its reason. With no workflow only Upload is available.
 */
export function buildStageGroups(
  workflow: TestGenerationWorkflow | null,
  currentStage: WorkflowStageId | null,
): StageGroup[] {
  return WORKFLOW_PHASES.map((phase) => ({
    id: phase.id,
    label: phase.label,
    stages: phase.stages.map((id): StageItem => {
      const status = workflow?.stages[id]?.status ?? "not-yet-reached";
      let state: StageState;
      if (status === "stale") state = "stale";
      else if (DONE.has(status)) state = "done";
      else if (status === "active" || (workflow === null && id === "upload")) state = "available";
      else state = "locked";
      let lockReason: string | null = null;
      if (state === "locked") {
        lockReason = workflow ? (getLockReason(id, workflow) ?? "Not available yet") : "Upload a specification first";
      }
      return {
        id,
        label: STAGE_LABELS[id],
        state,
        current: currentStage === id,
        lockReason,
        optional: phase.optionalStages.includes(id),
      };
    }),
  }));
}

/** The stage the Guided Workflow shows for a route: the addressed one, else where the workflow is. */
export function guidedStageOf(route: Route, workflow: TestGenerationWorkflow | null): WorkflowStageId {
  return route.stage ?? workflow?.activeStageId ?? "upload";
}

export interface HeaderTitle {
  readonly title: string;
  /** Breadcrumb parent, e.g. "Workflows" or "Guided Workflow › Design". */
  readonly parent: string;
}

/** The page header's title and breadcrumb parent for a route (FR-004, SC-008). */
export function headerTitleFor(route: Route, viewedStage: WorkflowStageId | null): HeaderTitle {
  switch (route.view) {
    case "home":
      return { title: "Home", parent: "Workspace" };
    case "coverage":
      return { title: titleOfDestination("coverage"), parent: "Results" };
    case "security":
      return { title: titleOfDestination("security"), parent: "Results" };
    case "guided": {
      const stage = route.stage ?? viewedStage;
      if (stage === null) return { title: titleOfDestination("guided"), parent: "Workflows" };
      return {
        title: STAGE_LABELS[stage],
        parent: `${titleOfDestination("guided")} › ${getPhaseOfStage(stage).label}`,
      };
    }
    default:
      return { title: titleOfDestination(route.view), parent: "Workflows" };
  }
}

/** The sidebar destination a workflow or results view from the catalog leads to. */
export function destinationOfView(view: TopLevelView): DestinationId {
  return isResultsView(view) ? view : VIEW_OF_WORKFLOW[view];
}

/** The catalog id a destination was known by before AP-054; "start" is Home. */
export function viewOfDestination(id: DestinationId): TopLevelView | "start" {
  switch (id) {
    case "home":
      return "start";
    case "guided":
      return "guided-workflow";
    case "import":
      return "import-collection";
    case "k6":
      return "user-script";
    default:
      return id;
  }
}
