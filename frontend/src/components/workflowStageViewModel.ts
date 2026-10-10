import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";

/**
 * Single source of truth for stage display labels (moved out of WorkflowStageTracker so
 * getLockReason below can share it — spec 027 FR-002/FR-004).
 */
export const STAGE_LABELS: Record<WorkflowStageId, string> = {
  upload: "Upload",
  analysis: "Analysis",
  apiReview: "API Review",
  deterministicGeneration: "Deterministic Generation",
  aiEnhancement: "AI Enhancement",
  scenarioReview: "Scenario Review",
  dependencyAnalysis: "Dependency Analysis",
  workflowReview: "Workflow Review",
  postmanGeneration: "Postman Generation",
  execution: "Execution",
  performanceTesting: "Performance Testing",
};

export type WorkflowPhaseId = "prepare" | "design" | "organize" | "execute";

export interface WorkflowPhase {
  readonly id: WorkflowPhaseId;
  readonly label: string;
  readonly stages: readonly WorkflowStageId[];
  /** Stages that do not hold the phase back from reading "Complete" (opt-in work). */
  readonly optionalStages: readonly WorkflowStageId[];
}

/**
 * Presentation grouping of the 11 sequential stages into 4 phases for the stage tracker. It is not
 * domain data: `WORKFLOW_STAGE_ORDER` and the stage state machine are unchanged, and every stage
 * belongs to exactly one phase (covered by a test, so a new stage cannot be left out silently).
 */
export const WORKFLOW_PHASES: readonly WorkflowPhase[] = [
  {
    id: "prepare",
    label: "Prepare",
    stages: ["upload", "analysis", "apiReview"],
    optionalStages: [],
  },
  {
    id: "design",
    label: "Design",
    stages: ["deterministicGeneration", "aiEnhancement", "scenarioReview"],
    optionalStages: [],
  },
  {
    id: "organize",
    label: "Organize",
    stages: ["dependencyAnalysis", "workflowReview"],
    optionalStages: [],
  },
  {
    id: "execute",
    label: "Execute",
    stages: ["postmanGeneration", "execution", "performanceTesting"],
    // AP-029: performance testing is optional and opens once Postman Generation is complete.
    optionalStages: ["performanceTesting"],
  },
];

export function getPhaseOfStage(stageId: WorkflowStageId): WorkflowPhase {
  const phase = WORKFLOW_PHASES.find((candidate) => candidate.stages.includes(stageId));
  if (!phase) {
    throw new Error(`Workflow stage "${stageId}" is not assigned to a phase`);
  }
  return phase;
}

/** A finished stage for progress purposes: nothing further is expected of it. */
const DONE_STATUSES = new Set<StageStatus>(["complete", "skipped", "partial"]);

export type PhaseStatus = "complete" | "in-progress" | "attention" | "locked";

export interface PhaseProgress {
  readonly status: PhaseStatus;
  readonly doneCount: number;
  readonly totalCount: number;
}

/**
 * Roll a phase's stage statuses up into one tile state. A stale stage wins (it needs redoing, so
 * the phase is not trustworthy as "complete"); an untouched phase is locked; otherwise the phase is
 * complete once every non-optional stage is done.
 */
export function getPhaseProgress(
  phase: WorkflowPhase,
  workflow: TestGenerationWorkflow,
): PhaseProgress {
  const statusOf = (stageId: WorkflowStageId): StageStatus =>
    workflow.stages[stageId]?.status ?? "not-yet-reached";
  const doneCount = phase.stages.filter((id) => DONE_STATUSES.has(statusOf(id))).length;
  const base = { doneCount, totalCount: phase.stages.length };

  if (phase.stages.some((id) => statusOf(id) === "stale")) {
    return { ...base, status: "attention" };
  }
  if (phase.stages.every((id) => statusOf(id) === "not-yet-reached")) {
    return { ...base, status: "locked" };
  }
  const requiredDone = phase.stages
    .filter((id) => !phase.optionalStages.includes(id))
    .every((id) => DONE_STATUSES.has(statusOf(id)));
  return { ...base, status: requiredDone ? "complete" : "in-progress" };
}

/**
 * Why a `not-yet-reached` stage is locked (FR-004). This workflow is strictly sequential
 * (WORKFLOW_STAGE_ORDER, one activeStageId at a time — data-model.md D4), so a locked stage is
 * always locked for exactly one reason: the nearest predecessor in stage order that isn't
 * `complete` yet. Returns undefined for a stage that isn't locked, or has no predecessor.
 * `performanceTesting` (AP-029 research D1) skips `execution`: it opens once Postman Generation is
 * complete, whatever the functional run's status.
 */
export function getLockReason(
  stageId: WorkflowStageId,
  workflow: TestGenerationWorkflow,
): string | undefined {
  const index = WORKFLOW_STAGE_ORDER.indexOf(stageId);
  if (index <= 0 || (workflow.stages[stageId]?.status ?? "not-yet-reached") !== "not-yet-reached") {
    return undefined;
  }

  const firstPredecessor =
    stageId === "performanceTesting" ? WORKFLOW_STAGE_ORDER.indexOf("postmanGeneration") : index - 1;
  for (let i = firstPredecessor; i >= 0; i--) {
    const predecessorId = WORKFLOW_STAGE_ORDER[i];
    if (workflow.stages[predecessorId]?.status !== "complete") {
      return `Complete ${STAGE_LABELS[predecessorId]} first`;
    }
  }
  return undefined;
}
