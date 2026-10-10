import type { CoverageGap, CoverageRequirementResult, CoverageScenarioResult, OperationCoverage } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";
import { StateBadge } from "./CoverageBadges";
import { CAUSE_LABELS, GROUP_LABELS, VERDICT_LABELS, VERDICT_TONES } from "./coverageViewModel";

const TH = "px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted";

function tallyText(r: CoverageRequirementResult): string {
  const t = r.tally;
  const mapped = t.passed + t.failed + t.inconclusive + t.notExecuted;
  if (mapped === 0) return "no scenario";
  return `${t.passed} passed, ${t.failed} failed, ${t.inconclusive} inconclusive, ${t.notExecuted} not executed of ${mapped}`;
}

function evidenceText(r: CoverageRequirementResult): string {
  if (r.state === "stale" && r.staleReason) return `${r.staleReason}${r.reExecutionRequired ? ". Re-execution required." : ""}`;
  if (r.evidence.length === 0) return r.reason;
  const first = r.evidence[0];
  return `${r.reason} Run ${first.runId}, scenario ${first.scenarioId}${first.note ? ` (${first.note})` : ""}.`;
}

/**
 * The expanded detail of one operation row: its scenarios with verdicts and its requirements with
 * state, cause, evidence tally and reason, plus the priority rationale. An operation has no single
 * status, so this is where a passing scenario and a failing one are each shown for what they prove.
 */
export function OperationRequirements({
  row,
  requirements,
  scenarios,
  gaps,
  showVerified,
}: Readonly<{
  row: OperationCoverage;
  requirements: readonly CoverageRequirementResult[];
  scenarios: readonly CoverageScenarioResult[];
  gaps: readonly CoverageGap[];
  showVerified: boolean;
}>) {
  const shown = requirements.filter((r) => showVerified || r.state !== "verified");
  const top = [...gaps].sort((a, b) => b.score - a.score)[0];
  return (
    <div data-testid="operation-detail" className="space-y-3">
      <div className="overflow-x-auto">
        <h4 className="mb-1 text-xs font-semibold text-text-primary">Scenarios of {row.operationKey}</h4>
        <table className="w-full min-w-[40rem] border-collapse rounded border border-border bg-surface text-xs">
          <caption className="sr-only">Scenarios and their verdicts for {row.operationKey}</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Scenario</th>
              <th scope="col" className={TH}>Category</th>
              <th scope="col" className={TH}>Review</th>
              <th scope="col" className={TH}>Verdict</th>
              <th scope="col" className={TH}>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-2 text-muted">No scenarios generated for this operation.</td>
              </tr>
            ) : (
              scenarios.map((s) => (
                <tr key={s.scenarioId} data-testid="scenario-row" className="border-t border-border">
                  <td className="px-2 py-1.5 font-mono">{s.scenarioId}</td>
                  <td className="px-2 py-1.5">{GROUP_LABELS[s.group]}</td>
                  <td className="px-2 py-1.5">{s.reviewState}</td>
                  <td className="px-2 py-1.5">
                    <StatusBadge label={VERDICT_LABELS[s.verdict]} tone={VERDICT_TONES[s.verdict]} />
                    {s.cause && <span className="ml-1.5 text-muted">{CAUSE_LABELS[s.cause]}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-muted">{s.runId ? `run ${s.runId}` : "none"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <h4 className="mb-1 text-xs font-semibold text-text-primary">
          Requirements ({shown.length} of {requirements.length}
          {showVerified ? "" : ", non-verified only"})
        </h4>
        <table className="w-full min-w-[56rem] border-collapse rounded border border-border bg-surface text-xs">
          <caption className="sr-only">Requirements and their states for {row.operationKey}</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Requirement</th>
              <th scope="col" className={TH}>Category</th>
              <th scope="col" className={TH}>Specification</th>
              <th scope="col" className={TH}>Runtime state</th>
              <th scope="col" className={TH}>Mapped scenarios</th>
              <th scope="col" className={TH}>Reason and evidence</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-2 text-muted">Every requirement in this scope is verified.</td>
              </tr>
            ) : (
              shown.map((r) => (
                <tr key={r.id} data-testid="requirement-row" data-state={r.state} className="border-t border-border align-top">
                  <td className="px-2 py-1.5">
                    {r.label}
                    <div className="text-muted">{r.kind.replace("-", " ")}</div>
                  </td>
                  <td className="px-2 py-1.5">{GROUP_LABELS[r.group]}</td>
                  <td className="px-2 py-1.5">
                    {r.state === "not-covered" ? (
                      "Not covered"
                    ) : (
                      <>
                        Covered
                        <div className="text-muted">
                          {r.acceptedCount} accepted, {r.pendingCount} pending
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <StateBadge state={r.state} />
                    {r.cause && <div className="mt-0.5 text-muted">{CAUSE_LABELS[r.cause]}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-muted">{tallyText(r)}</td>
                  <td className="px-2 py-1.5 text-text-secondary">{evidenceText(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        <span className="font-semibold">Priority rationale (heuristic, not a security assessment): </span>
        {top ? `${top.factors.map((f) => `${f.factor} +${f.points}`).join(", ")} = ${top.score}` : "no gap factors; every requirement in scope is verified."}
      </p>
    </div>
  );
}
