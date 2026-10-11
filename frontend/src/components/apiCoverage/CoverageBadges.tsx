import type { CoveragePriority, CoverageState } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";
import { PRIORITY_LABELS, PRIORITY_TONES, STATE_LABELS, STATE_TONES } from "./coverageViewModel";

/** A coverage state as a text badge: the label always says what the state is; the tone only reinforces it. */
export function StateBadge({ state }: Readonly<{ state: CoverageState }>) {
  return <StatusBadge label={STATE_LABELS[state]} tone={STATE_TONES[state]} />;
}

export function PriorityBadge({ priority }: Readonly<{ priority: CoveragePriority }>) {
  return (
    <StatusBadge
      label={PRIORITY_LABELS[priority]}
      tone={PRIORITY_TONES[priority]}
      title="Priority is a heuristic from declared contract facts and run outcomes, not a security assessment."
    />
  );
}
