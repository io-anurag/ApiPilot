/**
 * The four steps of Import & Run Collection (AP-042). Presentation state only: nothing here is
 * persisted or sent to the backend, and the steps are a view over the existing upload, collection
 * editor, run and results behaviour.
 */
export type ImportRunStepId = "collection" | "review" | "run" | "results";

export const IMPORT_RUN_STEP_ORDER: readonly ImportRunStepId[] = [
  "collection",
  "review",
  "run",
  "results",
];

export const IMPORT_RUN_STEP_LABELS: Record<ImportRunStepId, string> = {
  collection: "Collection",
  review: "Review requests",
  run: "Run",
  results: "Results",
};

/** What each step is for, shown under its label while the step is reachable. */
export const IMPORT_RUN_STEP_HINTS: Record<ImportRunStepId, string> = {
  collection: "Upload or pick one",
  review: "Edit before running",
  run: "Order and launch",
  results: "Per-request outcome",
};

export interface ImportRunProgress {
  /** An uploaded collection is selected. */
  readonly hasCollection: boolean;
  /** The selected collection has at least one run (in this session or in its history). */
  readonly hasRuns: boolean;
}

/** Why a step cannot be opened yet; `undefined` when it can. */
export function getStepLockReason(
  stepId: ImportRunStepId,
  progress: ImportRunProgress,
): string | undefined {
  if (stepId === "collection") return undefined;
  if (!progress.hasCollection) return "Select a collection first";
  if (stepId === "results" && !progress.hasRuns) return "Start a run first";
  return undefined;
}

/**
 * The step to show: the requested one when it is open, otherwise the furthest earlier step that is.
 * Covers a collection being removed, or its runs disappearing, while a later step is on screen.
 */
export function resolveStep(
  requested: ImportRunStepId,
  progress: ImportRunProgress,
): ImportRunStepId {
  for (let i = IMPORT_RUN_STEP_ORDER.indexOf(requested); i >= 0; i--) {
    const candidate = IMPORT_RUN_STEP_ORDER[i];
    if (getStepLockReason(candidate, progress) === undefined) return candidate;
  }
  return "collection";
}
