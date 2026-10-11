import { useMemo } from "react";
import { coverageEntryState, type CoverageEntryState } from "../components/apiCoverage/coverageViewModel";
import { useCoverage } from "./useCoverage";

/** The unfiltered query: the entry summary always describes the whole specification. */
const WHOLE_SPECIFICATION = {} as const;

/**
 * Coverage as the start screen and Import & Run Collection see it (AP-046). It reuses `useCoverage`,
 * so a slow earlier reply cannot overwrite a newer one, and it refetches whenever `active` turns
 * true, which picks up a specification or run produced in another view.
 */
export function useCoverageEntry(active: boolean): CoverageEntryState {
  const { snapshot, problem } = useCoverage(WHOLE_SPECIFICATION, active);
  return useMemo(() => coverageEntryState(snapshot, problem), [snapshot, problem]);
}
