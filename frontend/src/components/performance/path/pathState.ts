/**
 * The Performance path's pure logic (specs/047-unified-performance-tab data-model.md): the five steps,
 * which step a source opens on, which steps can be selected, whether Next is available and why not, and
 * the in-memory state transitions. Presentation state only: nothing here is persisted or sent to the
 * backend, and a plan is the source of truth as soon as one exists (FR-011).
 */

export type PathStep = "source" | "operations" | "plan" | "load" | "run";

export const PATH_STEPS: readonly PathStep[] = ["source", "operations", "plan", "load", "run"];

export type SourceKind = "specification" | "workflow" | "collection" | "empty";

export const SOURCE_LABELS: Record<SourceKind, string> = {
  specification: "OpenAPI specification",
  workflow: "Guided workflow",
  collection: "Postman collection",
  empty: "Empty plan",
};

/** What each step is for, shown under its label while it can be opened. */
export const STEP_HINTS: Record<PathStep, string> = {
  source: "Where the plan starts",
  operations: "What to include",
  plan: "Review and edit",
  load: "Environment and load",
  run: "Start and read results",
};

/** The Operations step is named for what the source contains (FR-008). */
export function stepLabel(step: PathStep, source: SourceKind | null): string {
  if (step === "source") return "Source";
  if (step === "plan") return "Plan";
  if (step === "load") return "Load";
  if (step === "run") return "Run";
  if (source === "workflow") return "Workflows";
  if (source === "collection") return "Requests";
  return "Operations";
}

const indexOf = (step: PathStep) => PATH_STEPS.indexOf(step);

/** Where a freshly picked source opens (FR-007). */
export function entryStep(source: SourceKind, specificationLoaded: boolean): PathStep {
  if (source === "empty") return "plan";
  if (source === "specification" && !specificationLoaded) return "source";
  return "operations";
}

/** An empty plan has nothing to select, so Operations is skipped (FR-008). */
export function isStepSkipped(step: PathStep, source: SourceKind | null): boolean {
  return step === "operations" && source === "empty";
}

/** A reached step can be selected, except a skipped one (FR-006). */
export function isStepSelectable(step: PathStep, reached: number, source: SourceKind | null): boolean {
  return indexOf(step) <= reached && !isStepSkipped(step, source);
}

export function nextStep(step: PathStep, source: SourceKind | null): PathStep | null {
  for (let i = indexOf(step) + 1; i < PATH_STEPS.length; i++) if (!isStepSkipped(PATH_STEPS[i], source)) return PATH_STEPS[i];
  return null;
}

export function previousStep(step: PathStep, source: SourceKind | null): PathStep | null {
  for (let i = indexOf(step) - 1; i >= 0; i--) if (!isStepSkipped(PATH_STEPS[i], source)) return PATH_STEPS[i];
  return null;
}

/** Everything the gating rules read; the caller supplies what it knows (FR-009). */
export interface GateContext {
  source: SourceKind | null;
  /** A specification is uploaded in this session and is not being replaced. */
  specificationReady: boolean;
  /** Items chosen on Operations (operations or requests). */
  selectionCount: number;
  /** The guided workflow is complete through Postman generation; `null` while it is being read. */
  workflowReady: boolean | null;
  planExists: boolean;
  planName: string;
  planStepCount: number;
  /** Why the load profile is not usable, or `null`. */
  loadProblem: string | null;
}

export interface NextAvailability {
  available: boolean;
  /** Shown beside the disabled Next; `null` when available or when there is no next step. */
  reason: string | null;
}

/** Whether Next is available on `step`, and the reason shown when it is not (FR-009). */
export function nextAvailability(step: PathStep, context: GateContext): NextAvailability {
  const blocked = (reason: string): NextAvailability => ({ available: false, reason });
  const ok: NextAvailability = { available: true, reason: null };
  switch (step) {
    case "source":
      if (context.source === null) return blocked("Choose a source");
      if (context.source === "specification" && !context.specificationReady) return blocked("Upload the specification to continue");
      return ok;
    case "operations":
      if (context.source === "workflow") {
        if (context.workflowReady === null) return blocked("Reading the guided workflow…");
        return context.workflowReady ? ok : blocked("Finish the guided workflow up to Postman generation first");
      }
      if (context.selectionCount === 0) return blocked(context.source === "collection" ? "Choose at least one request" : "Choose at least one operation");
      return ok;
    case "plan":
      if (context.planName.trim() === "") return blocked("Name the plan");
      if (context.planStepCount === 0) return blocked("Add at least one step");
      return ok;
    case "load":
      return context.loadProblem ? blocked(context.loadProblem) : ok;
    case "run":
      return { available: false, reason: null };
  }
}

/** The path as the page holds it, in memory only (data-model.md PathState and DraftTest). */
export interface PathState {
  source: SourceKind | null;
  /** Keys of the chosen items; operation keys for a specification, request ids for a collection. */
  selection: readonly string[];
  /** The upload panel is shown over an already uploaded specification. */
  replacingSpecification: boolean;
  collectionId: string | null;
  planId: string | null;
  /** A run to show when the plan opens: the Run step opens with its report. */
  runId: string | null;
  step: PathStep;
  /** Highest step index reached; steps up to it can be selected. */
  reached: number;
  /** The draft was left; the entry screen offers Resume and Discard (FR-019). */
  parked: boolean;
}

export const INITIAL_PATH_STATE: PathState = {
  source: null,
  selection: [],
  replacingSpecification: false,
  collectionId: null,
  planId: null,
  runId: null,
  step: "source",
  reached: 0,
  parked: false,
};

/** The path is on screen while something is open and it has not been parked. */
export const isPathVisible = (state: PathState): boolean => state.source !== null && !state.parked;

/** An unfinished test with no plan yet: what Resume brings back (FR-019). */
export const hasDraft = (state: PathState): boolean => state.source !== null && state.planId === null;

export type PathAction =
  | { type: "pick"; source: SourceKind; specificationLoaded: boolean; selection: readonly string[] }
  | { type: "open-plan"; planId: string; source: SourceKind; selection: readonly string[]; runId?: string }
  | { type: "plan-created"; planId: string }
  | { type: "go"; step: PathStep }
  | { type: "next" }
  | { type: "back" }
  | { type: "set-selection"; selection: readonly string[] }
  | { type: "set-source"; source: SourceKind; selection: readonly string[] }
  | { type: "set-replacing"; value: boolean }
  | { type: "set-collection"; collectionId: string | null }
  | { type: "leave" }
  | { type: "resume" }
  | { type: "discard" };

function moveTo(state: PathState, step: PathStep): PathState {
  return { ...state, step, reached: Math.max(state.reached, indexOf(step)) };
}

export function pathReducer(state: PathState, action: PathAction): PathState {
  switch (action.type) {
    case "pick": {
      const step = entryStep(action.source, action.specificationLoaded);
      return { ...INITIAL_PATH_STATE, source: action.source, selection: action.selection, step, reached: indexOf(step) };
    }
    case "open-plan":
      return { ...INITIAL_PATH_STATE, source: action.source, selection: action.selection, planId: action.planId, runId: action.runId ?? null, step: action.runId ? "run" : "plan", reached: indexOf("run") };
    case "plan-created":
      return moveTo({ ...state, planId: action.planId }, "plan");
    case "go":
      return isStepSelectable(action.step, state.reached, state.source) ? moveTo(state, action.step) : state;
    case "next": {
      const next = nextStep(state.step, state.source);
      return next ? moveTo(state, next) : state;
    }
    case "back": {
      const previous = previousStep(state.step, state.source);
      return previous ? { ...state, step: previous } : state;
    }
    case "set-selection":
      return { ...state, selection: action.selection };
    case "set-source":
      // The source can only change while no plan exists (FR-014).
      return state.planId === null ? { ...state, source: action.source, selection: action.selection, collectionId: null, replacingSpecification: false } : state;
    case "set-replacing":
      return { ...state, replacingSpecification: action.value };
    case "set-collection":
      return { ...state, collectionId: action.collectionId };
    case "leave":
      // A plan is already saved, so nothing is kept; a path with no plan yet becomes a draft (FR-019, FR-022).
      if (state.planId !== null) return INITIAL_PATH_STATE;
      return state.source === null ? state : { ...state, parked: true };
    case "resume":
      return { ...state, parked: false };
    case "discard":
      return INITIAL_PATH_STATE;
  }
}
