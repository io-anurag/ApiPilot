import { useMemo, useReducer } from "react";
import { hasDraft, INITIAL_PATH_STATE, isPathVisible, pathReducer, type PathState, type PathStep, type SourceKind } from "../components/performance/path/pathState";

export interface PerformancePath {
  state: PathState;
  /** The path is on screen (something is open and it is not parked). */
  visible: boolean;
  /** An unfinished test with no plan yet exists (parked or not). */
  draft: boolean;
  pick: (source: SourceKind, specificationLoaded: boolean, selection: readonly string[]) => void;
  openPlan: (planId: string, source: SourceKind, selection: readonly string[]) => void;
  planCreated: (planId: string) => void;
  go: (step: PathStep) => void;
  next: () => void;
  back: () => void;
  setSelection: (selection: readonly string[]) => void;
  setSource: (source: SourceKind, selection: readonly string[]) => void;
  setReplacing: (value: boolean) => void;
  setCollection: (collectionId: string | null) => void;
  leave: () => void;
  resume: () => void;
  discard: () => void;
}

/**
 * The Performance path's in-memory state (specs/047-unified-performance-tab R7): a reducer over the
 * pure transitions in `pathState`. Nothing is persisted, so it lasts as long as the page stays mounted,
 * which App keeps across "Back to start" and tab switches (FR-021).
 */
export function usePerformancePath(initial: PathState = INITIAL_PATH_STATE): PerformancePath {
  const [state, dispatch] = useReducer(pathReducer, initial);
  const actions = useMemo(
    () => ({
      pick: (source: SourceKind, specificationLoaded: boolean, selection: readonly string[]) => dispatch({ type: "pick", source, specificationLoaded, selection }),
      openPlan: (planId: string, source: SourceKind, selection: readonly string[]) => dispatch({ type: "open-plan", planId, source, selection }),
      planCreated: (planId: string) => dispatch({ type: "plan-created", planId }),
      go: (step: PathStep) => dispatch({ type: "go", step }),
      next: () => dispatch({ type: "next" }),
      back: () => dispatch({ type: "back" }),
      setSelection: (selection: readonly string[]) => dispatch({ type: "set-selection", selection }),
      setSource: (source: SourceKind, selection: readonly string[]) => dispatch({ type: "set-source", source, selection }),
      setReplacing: (value: boolean) => dispatch({ type: "set-replacing", value }),
      setCollection: (collectionId: string | null) => dispatch({ type: "set-collection", collectionId }),
      leave: () => dispatch({ type: "leave" }),
      resume: () => dispatch({ type: "resume" }),
      discard: () => dispatch({ type: "discard" }),
    }),
    [],
  );
  return { state, visible: isPathVisible(state), draft: hasDraft(state), ...actions };
}
