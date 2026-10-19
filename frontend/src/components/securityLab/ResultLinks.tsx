import type { ScenarioResult } from "@apipilot/shared-domain";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { listFindings } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { occurrenceText } from "./findingViewModel";

/** Looks the finding of a failed result up by its scenario and version, and links to it. */
function FindingLink({ result, refreshToken, onOpenFinding }: Readonly<{ result: ScenarioResult; refreshToken: number; onOpenFinding: (id: string) => void }>) {
  const found = useSecurityResource((signal) => listFindings({ scenario: result.scenarioId }, { pageSize: 100 }, { signal }), [result.scenarioId, refreshToken]);
  if (found.problem && !found.data) return <span className="text-xs text-text-secondary">The finding could not be looked up: {found.problem.message}</span>;
  if (!found.data) return <span className="text-xs text-text-secondary">Looking for the finding...</span>;
  const finding = found.data.items.find((entry) => entry.scenarioVersion === result.version);
  if (!finding) return <span className="text-xs text-text-secondary">No finding is recorded for this result.</span>;
  return (
    <button type="button" onClick={() => onOpenFinding(finding.id)} aria-label={`Open the finding for this result (${occurrenceText(finding.occurrenceCount)})`} className={BUTTON_STYLES.ghost}>
      Open the finding ({occurrenceText(finding.occurrenceCount)})
    </button>
  );
}

/**
 * Under each run result: where it leads. Every result links to its scenario (the version that ran). A failed result also
 * links to the finding it created or extended, which in turn links back to its run. A result that did not fail has no
 * finding, and this says nothing about one: only a failed result ever produces a finding.
 */
export function ResultLinks({
  result,
  refreshToken,
  onOpenScenario,
  onOpenFinding,
}: Readonly<{
  result: ScenarioResult;
  refreshToken: number;
  onOpenScenario: (scenarioId: string, version: number) => void;
  onOpenFinding: (id: string) => void;
}>) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => onOpenScenario(result.scenarioId, result.version)} aria-label={`Open the scenario for this result (version ${result.version})`} className={BUTTON_STYLES.ghost}>
        Open the scenario (version {result.version})
      </button>
      {result.outcome === "failed" && <FindingLink result={result} refreshToken={refreshToken} onOpenFinding={onOpenFinding} />}
    </span>
  );
}
