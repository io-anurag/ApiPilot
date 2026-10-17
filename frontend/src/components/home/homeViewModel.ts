import type {
  ChainRunSummary,
  CoverageCategoryGroup,
  CoverageSnapshot,
  PerformanceRunStatus,
  TestGenerationWorkflow,
  UploadedCollectionExecutionRun,
  UserScriptRunSummary,
  WorkflowStageId,
} from "@apipilot/shared-domain";
import type { AiStatus } from "../../services/aiStatusClient";
import type { Route } from "../../navigation/routes";
import { entryPercentage } from "../apiCoverage/coverageViewModel";
import { STAGE_LABELS, WORKFLOW_PHASES } from "../workflowStageViewModel";

/**
 * What Home shows and why (AP-054 FR-018 to FR-021, contracts/home-data.md): pure functions over
 * data the application already holds. A figure with no data is a text reason and never a number;
 * nothing here estimates, defaults to zero or invents a value.
 */

// ---- Summary figures ---------------------------------------------------------------------

export interface CoverageSource {
  readonly snapshot: CoverageSnapshot | null;
  readonly problem: { kind: "no-workflow" | "error"; message: string } | null;
}

export type FigureView =
  | { id: string; label: string; state: "ready"; value: string; sub?: string }
  | { id: string; label: string; state: "unavailable"; reason: string };

function unavailable(source: CoverageSource): string {
  if (source.problem?.kind === "no-workflow") return "Needs a specification from the Guided Workflow.";
  if (source.problem) return `Coverage is unavailable: ${source.problem.message}`;
  return "Loading coverage…";
}

function metricOf(snapshot: CoverageSnapshot, id: string) {
  return snapshot.metrics.find((metric) => metric.id === id) ?? null;
}

/** The four summary tiles, from the same snapshot the Coverage screen shows (SC-006). */
export function summaryFigures(source: CoverageSource): FigureView[] {
  const { snapshot } = source;
  const labels = {
    spec: "Specification coverage",
    runtime: "Runtime-verified",
    gaps: "Open gaps, high priority",
    pending: "Scenarios pending review",
  } as const;
  if (snapshot === null) {
    const reason = unavailable(source);
    return [
      { id: "spec-coverage", label: labels.spec, state: "unavailable", reason },
      { id: "runtime-verified", label: labels.runtime, state: "unavailable", reason },
      { id: "open-gaps", label: labels.gaps, state: "unavailable", reason },
      { id: "pending-scenarios", label: labels.pending, state: "unavailable", reason },
    ];
  }
  const spec = metricOf(snapshot, "spec-operations");
  const runtime = metricOf(snapshot, "runtime-operations");
  const hasRun = snapshot.execution.runIds.length > 0;
  const highGaps = snapshot.gaps.filter((gap) => gap.priority === "high").length;
  const { scenarioCounts } = snapshot.context;
  return [
    spec === null
      ? { id: "spec-coverage", label: labels.spec, state: "unavailable", reason: "Not available." }
      : { id: "spec-coverage", label: labels.spec, state: "ready", value: entryPercentage(spec), sub: `${spec.numerator} of ${spec.denominator} operations` },
    runtime === null || !hasRun
      ? { id: "runtime-verified", label: labels.runtime, state: "unavailable", reason: "No run yet" }
      : { id: "runtime-verified", label: labels.runtime, state: "ready", value: entryPercentage(runtime), sub: `${runtime.numerator} of ${runtime.denominator} operations` },
    { id: "open-gaps", label: labels.gaps, state: "ready", value: String(highGaps), sub: `${snapshot.totals.gaps} open gaps in all` },
    { id: "pending-scenarios", label: labels.pending, state: "ready", value: String(scenarioCounts.pending), sub: `${scenarioCounts.total} scenarios in all` },
  ];
}

// ---- Coverage by area and operations by method -------------------------------------------

export interface CategoryRow {
  readonly group: CoverageCategoryGroup;
  readonly label: string;
  /** Null when the area cannot be measured; `reason` then says why. */
  readonly percentage: number | null;
  readonly detail: string;
  readonly reason: string | null;
}

const CATEGORY_LABELS: Readonly<Record<CoverageCategoryGroup, string>> = {
  positive: "Positive",
  negative: "Negative",
  boundary: "Boundary",
  security: "Security",
};

export function categoryRows(snapshot: CoverageSnapshot): CategoryRow[] {
  return snapshot.categoryCoverage.map((entry) => {
    const measurable = entry.available && entry.eligible > 0;
    return {
      group: entry.group,
      label: CATEGORY_LABELS[entry.group],
      percentage: measurable ? Math.round((entry.specCovered / entry.eligible) * 100) : null,
      detail: measurable ? `${entry.specCovered} of ${entry.eligible} requirements covered by a scenario` : "",
      reason: measurable ? null : (entry.reason ?? "Nothing to measure in this specification."),
    };
  });
}

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export interface MethodCount {
  readonly method: string;
  readonly count: number;
}

/** Operations in scope by HTTP method, in the usual order, with any other method after them. */
export function methodCounts(snapshot: CoverageSnapshot): MethodCount[] {
  const counts = new Map<string, number>();
  for (const operation of snapshot.operations) {
    const method = operation.method.toUpperCase();
    counts.set(method, (counts.get(method) ?? 0) + 1);
  }
  const known = METHOD_ORDER.filter((method) => counts.has(method));
  const others = [...counts.keys()].filter((method) => !(METHOD_ORDER as readonly string[]).includes(method)).sort();
  return [...known, ...others].map((method) => ({ method, count: counts.get(method) as number }));
}

// ---- Next steps ----------------------------------------------------------------------------

export interface NextStep {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly route: Route;
}

const DONE = new Set(["complete", "skipped", "partial"]);

function guidedUnfinished(workflow: TestGenerationWorkflow): boolean {
  const optional = new Set<WorkflowStageId>(WORKFLOW_PHASES.flatMap((phase) => phase.optionalStages));
  return Object.entries(workflow.stages).some(([id, stage]) => !optional.has(id as WorkflowStageId) && !DONE.has(stage.status));
}

/**
 * What is waiting on the engineer, derived from existing state only and in a fixed order; each
 * links to where it is done (FR-021). Empty when nothing is pending.
 */
export function nextSteps(input: Readonly<{
  workflow: TestGenerationWorkflow | null;
  snapshot: CoverageSnapshot | null;
  performanceDraft: boolean;
}>): NextStep[] {
  const steps: NextStep[] = [];
  const { workflow, snapshot } = input;
  if (workflow !== null && guidedUnfinished(workflow)) {
    steps.push({
      id: "continue-guided",
      title: `Continue ${STAGE_LABELS[workflow.activeStageId]}`,
      detail: "Guided Workflow",
      route: { view: "guided", stage: workflow.activeStageId },
    });
  }
  if (snapshot !== null) {
    const pending = snapshot.context.scenarioCounts.pending;
    if (pending > 0) {
      steps.push({ id: "review-pending", title: `Review ${pending} pending ${pending === 1 ? "scenario" : "scenarios"}`, detail: "Scenario Review", route: { view: "guided", stage: "scenarioReview" } });
    }
    const uncovered = snapshot.operationCounts.withNoScenarios;
    if (uncovered > 0) {
      steps.push({ id: "cover-operations", title: `Cover ${uncovered} ${uncovered === 1 ? "operation" : "operations"} with no generated tests`, detail: "Coverage", route: { view: "coverage" } });
    }
    const failing = Math.max(snapshot.assertionOutcomes.failed, snapshot.operationCounts.withFailures);
    if (failing > 0) {
      steps.push({ id: "investigate-failures", title: `Investigate ${failing} failing ${failing === 1 ? "result" : "results"}`, detail: "Coverage", route: { view: "coverage" } });
    }
  }
  if (input.performanceDraft) {
    steps.push({ id: "finish-performance-draft", title: "Finish the draft load test", detail: "Performance", route: { view: "performance" } });
  }
  return steps;
}

// ---- Recent runs ---------------------------------------------------------------------------

export type RunWorkflow = "import" | "performance" | "k6";
export type RunStatus = "in-progress" | "completed" | "cancelled" | "failed";

export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  "in-progress": "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const RUN_WORKFLOW_LABELS: Readonly<Record<RunWorkflow, string>> = {
  import: "Import & Run Collection",
  performance: "Performance",
  k6: "Run k6 Script",
};

export interface RecentRun {
  readonly key: string;
  readonly workflow: RunWorkflow;
  readonly subject: string;
  readonly startedAt: string;
  readonly status: RunStatus;
  /** What the deep link needs: the owning collection, plan or script, and the run itself. */
  readonly target: { workflow: RunWorkflow; ownerId: string; runId: string };
}

export const RECENT_RUNS_SHOWN = 8;
/** Owners (collections, plans) read per source. */
export const RECENT_RUN_OWNER_LIMIT = 10;

export function importRuns(collectionName: string, runs: readonly Omit<UploadedCollectionExecutionRun, "results">[]): RecentRun[] {
  return runs.map((run) => ({
    key: `import:${run.id}`,
    workflow: "import",
    subject: run.uploadedCollectionSnapshot?.name ?? collectionName,
    startedAt: run.startedAt,
    status: run.status,
    target: { workflow: "import", ownerId: run.uploadedCollectionSetId, runId: run.id },
  }));
}

function performanceStatus(status: PerformanceRunStatus): RunStatus {
  return status;
}

export function performanceRuns(planId: string, planName: string, runs: readonly ChainRunSummary[]): RecentRun[] {
  return runs.map((run) => ({
    key: `performance:${run.id}`,
    workflow: "performance",
    subject: planName,
    startedAt: run.startedAt,
    status: performanceStatus(run.status),
    target: { workflow: "performance", ownerId: planId, runId: run.id },
  }));
}

export function k6Runs(runs: readonly UserScriptRunSummary[]): RecentRun[] {
  return runs.map((run) => ({
    key: `k6:${run.id}`,
    workflow: "k6",
    subject: run.snapshot.scriptName,
    startedAt: run.startedAt,
    status: performanceStatus(run.status),
    target: { workflow: "k6", ownerId: run.snapshot.scriptId, runId: run.id },
  }));
}

/** Newest first by start time (ties keep source order), at most `limit`. */
export function mergeRecentRuns(rows: readonly RecentRun[], limit = RECENT_RUNS_SHOWN): RecentRun[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => Date.parse(b.row.startedAt) - Date.parse(a.row.startedAt) || a.index - b.index)
    .slice(0, limit)
    .map(({ row }) => row);
}

// ---- AI provider ---------------------------------------------------------------------------

const AI_STATE_LABELS: Readonly<Record<AiStatus["state"], string>> = {
  ready: "Ready",
  loading: "Loading the model",
  "not-loaded": "Not loaded yet",
  unavailable: "Unavailable",
};

export function aiStatusText(status: AiStatus): { state: string; provider: string; reason: string | null } {
  return {
    state: AI_STATE_LABELS[status.state],
    provider: status.provider === "local" ? "Local model" : "Mock provider",
    reason: status.state === "unavailable" ? status.reason : null,
  };
}
