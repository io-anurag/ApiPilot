import type { ChainPlan, ChainPlanAnalysis, PlanBlocker, PlanNotice } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { StatusBadge } from "../StatusBadge";

function stepName(plan: ChainPlan, stepId: string): string {
  return plan.chains.flatMap((chain) => chain.steps).find((step) => step.id === stepId)?.name ?? stepId;
}

/** Each blocker in words (FR-006, FR-014, FR-029). */
export function blockerText(plan: ChainPlan, blocker: PlanBlocker): string {
  switch (blocker.kind) {
    case "missing-expected-status":
      return `${stepName(plan, blocker.stepId)} has no expected status.`;
    case "use-before-extraction":
      return `${stepName(plan, blocker.stepId)} uses {{${blocker.name}}} before any step extracts it. Move the step after its extractor.`;
    case "setup-uses-iteration-value":
      return `${stepName(plan, blocker.stepId)} runs once before load but uses {{${blocker.name}}}, which only a load step extracts.`;
    case "host-from-variable":
      return `${stepName(plan, blocker.stepId)} takes its host from {{${blocker.name}}}. Use {{baseUrl}} or a literal address, so the run trigger can name the host.`;
    case "invalid-url":
      return `${stepName(plan, blocker.stepId)}'s URL must start with {{baseUrl}} or http:// or https://, with no query or fragment.`;
    case "invalid-reference":
      return `${stepName(plan, blocker.stepId)} has ${blocker.text}, which is not a reference: use letters, digits and underscores, or a supported {{$…}} variable.`;
    case "invalid-field-path":
      return `${stepName(plan, blocker.stepId)}: ${blocker.reason}`;
    case "no-runnable-chain":
      return "No chain has a step that runs in the load. Add a step that runs every iteration or once per virtual user.";
  }
}

function noticeText(plan: ChainPlan, notice: PlanNotice): string {
  switch (notice.kind) {
    case "empty-chain":
      return `${plan.chains.find((chain) => chain.id === notice.chainId)?.name ?? notice.chainId} has no step that runs in the load, so it is not run as a chain.`;
    case "extracted-more-than-once":
      return `{{${notice.name}}} is extracted by ${notice.stepIds.map((id) => stepName(plan, id)).join(", ")}; a later extraction replaces the value for the steps after it.`;
    case "column-shadows-environment":
      return `The data set column ${notice.name} is used instead of the environment value of the same name.`;
    case "data-set-unused":
      return `${plan.dataSets.find((dataSet) => dataSet.id === notice.dataSetId)?.name ?? "A data set"} is not used by any step.`;
  }
}

/**
 * What blocks the script, what is worth knowing, the values the environment must provide and the
 * hosts the plan sends to (FR-014, FR-015, FR-029). Each blocker can take the engineer to its step.
 */
export function PlanIssues({ plan, analysis, environmentChosen, onGoToStep }: Readonly<{ plan: ChainPlan; analysis: ChainPlanAnalysis; environmentChosen: boolean; onGoToStep: (stepId: string) => void }>) {
  return (
    <section aria-labelledby="plan-issues-title" className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h3 id="plan-issues-title" className="text-sm font-semibold">
        Plan check
      </h3>
      {analysis.blockers.length === 0 ? (
        <p className="text-sm">
          <StatusBadge label="Ready to generate" tone="success" /> Nothing blocks the script.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-danger-700 dark:text-danger-200">
            {analysis.blockers.length} {analysis.blockers.length === 1 ? "problem blocks" : "problems block"} the script:
          </p>
          <ul className="space-y-1 text-sm" data-testid="plan-blockers">
            {analysis.blockers.map((blocker, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-2">
                <span>{blockerText(plan, blocker)}</span>
                {"stepId" in blocker && (
                  <button type="button" className={BUTTON_STYLES.ghost} onClick={() => onGoToStep(blocker.stepId)}>
                    Go to step
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {analysis.notices.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {analysis.notices.map((notice, index) => (
            <li key={index}>{noticeText(plan, notice)}</li>
          ))}
        </ul>
      )}
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">Values the environment provides</h4>
        {analysis.requiredValues.length === 0 ? (
          <p className="text-sm text-muted">The plan uses no environment value.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {analysis.requiredValues.map((value) => (
              <li key={value.name} className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-xs">{value.name}</code>
                {value.secret && <StatusBadge label="Secret" tone="info" />}
                {!environmentChosen ? (
                  <span className="text-xs text-muted">Choose a target environment to see whether it is set</span>
                ) : value.provided ? (
                  <StatusBadge label="Set" tone="success" />
                ) : (
                  <StatusBadge label="Missing: steps using it will not be sent" tone="warning" />
                )}
                <span className="text-xs text-muted">used by {value.stepIds.map((id) => stepName(plan, id)).join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">Hosts the plan sends to</h4>
        <ul className="flex flex-wrap gap-2">
          {analysis.hosts.map((host) => (
            <li key={host}>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">{host === "{{baseUrl}}" ? "{{baseUrl}} (the environment's base URL)" : host}</code>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
