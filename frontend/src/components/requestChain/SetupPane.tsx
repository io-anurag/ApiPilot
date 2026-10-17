import { LOAD_PROFILE_STARTING_STAGES, type PerformanceThreshold } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { StatusBadge } from "../StatusBadge";
import { EnvironmentPicker } from "../performance/EnvironmentPicker";
import { LoadProfileEditor } from "../performance/LoadProfileEditor";
import { SetupItem } from "../performance/SetupItem";
import { ThresholdEditor } from "../performance/ThresholdEditor";
import { scriptDownloadUrl } from "../../services/requestChainClient";
import { DataSetsPanel } from "./DataSetsPanel";
import type { ChainPlanSession } from "./useChainPlanSession";

/**
 * A plan's configuration: target environment, load profile, thresholds, data sets and the k6 script
 * (specs/037-request-chain-performance US1; AP-040 layout). Shown below the launch card on the editor's
 * Run setup tab and as the Performance path's Load step.
 */
export function SetupPane({ session }: Readonly<{ session: ChainPlanSession }>) {
  const { plan, analysis, environment, environments, script, generateBlocked, busy, change, save, planId } = session;
  return (
    <section aria-labelledby="chain-config-title" className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="px-5 py-4">
        <h2 id="chain-config-title" className="text-base font-semibold">
          Configuration
        </h2>
        <p className="text-xs text-muted">Review each part, edit only what needs to change.</p>
      </div>
      <SetupItem variant="row" state={environment ? "done" : "todo"} title="Target environment" titleId="chain-environment-title" summary="Holds the base URL and every value the plan uses. Literal credentials you type are moved into it as secret values.">
        <EnvironmentPicker
          compact
          environments={environments}
          selectedId={plan.targetEnvironmentId}
          suggestedNames={analysis.requiredValues.map((value) => value.name).filter((name) => name !== "baseUrl")}
          onSelect={(environmentId) => change({ ...plan, targetEnvironmentId: environmentId }, true)}
          onSaved={(saved) => {
            session.reloadEnvironments();
            change({ ...plan, targetEnvironmentId: saved.id }, true);
          }}
        />
      </SetupItem>
      <SetupItem variant="row" state="done" title="Load profile" titleId="chain-profile-title" summary="Every virtual user runs every chain, in order, on each iteration.">
        <LoadProfileEditor
          compact
          profile={plan.loadProfile}
          startingStages={(kind) => LOAD_PROFILE_STARTING_STAGES[kind].map((stage) => ({ ...stage }))}
          busy={busy}
          onSave={(profile) => change({ ...plan, loadProfile: { ...profile, plannedDurationMs: profile.stages.reduce((total, stage) => total + stage.durationMs, 0) } }, true)}
          extra={
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span>Default think time after each step (ms)</span>
              <input
                type="number"
                min={0}
                className="w-28 rounded-lg border border-border-control bg-surface px-2 py-1"
                value={plan.thinkTimeMs}
                onChange={(event) => change({ ...plan, thinkTimeMs: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
                onBlur={() => void save()}
              />
            </label>
          }
        />
      </SetupItem>
      <SetupItem
        variant="row"
        collapsible
        startOpen={false}
        state={plan.thresholds.length > 0 ? "done" : "optional"}
        title="Thresholds (optional)"
        titleId="chain-thresholds-title"
        collapsedSummary={plan.thresholds.length > 0 ? `${plan.thresholds.length} ${plan.thresholds.length === 1 ? "threshold" : "thresholds"} set.` : "None set. The report shows measurements with no pass/fail verdict."}
      >
        <ThresholdEditor
          compact
          thresholds={plan.thresholds}
          scopeOptions={[
            { key: "run", label: "Whole run", scope: { kind: "run" } as const },
            ...plan.chains.flatMap((chain) => chain.steps.filter((step) => step.runs !== "once-before-load")).map((step) => ({ key: step.id, label: `${step.method} ${step.name}`, scope: { kind: "step", stepId: step.id } as const })),
          ]}
          scopeLabel={(scope) => (scope.kind === "run" ? "Run" : (plan.chains.flatMap((chain) => chain.steps).find((step) => step.id === scope.stepId)?.name ?? scope.stepId))}
          busy={busy}
          onSave={(thresholds) => change({ ...plan, thresholds: thresholds as PerformanceThreshold[] }, true)}
        />
      </SetupItem>
      <DataSetsPanel row plan={plan} analysis={analysis} onPlanChanged={session.applyView} />
      <SetupItem
        variant="row"
        state={script && !script.outOfDate ? "done" : "todo"}
        title="k6 script"
        titleId="chain-script-title"
        status={
          script ? (
            <span className="inline-flex min-w-0 items-center gap-2 text-sm">
              <span className="shrink-0">{script.outOfDate ? <StatusBadge label="Out of date: regenerate" tone="warning" /> : <StatusBadge label="Script current" tone="success" />}</span>
              {!script.outOfDate && (
                <span className="min-w-0 truncate font-mono text-xs" title={`sha256 ${script.scriptSha256}`}>
                  sha256 {script.scriptSha256}
                </span>
              )}
            </span>
          ) : undefined
        }
        actions={
          <>
            {script && !script.outOfDate && (
              <>
                <a className={BUTTON_STYLES.ghost} href={scriptDownloadUrl(planId, "script")} download>
                  Download script
                </a>
                <a className={BUTTON_STYLES.ghost} href={scriptDownloadUrl(planId, "environment-template")} download>
                  Download environment template
                </a>
              </>
            )}
            <button type="button" className={BUTTON_STYLES.ghost} disabled={busy || generateBlocked !== null} onClick={() => void session.generate()}>
              {script ? "Regenerate script" : "Generate script"}
            </button>
          </>
        }
        summary="ApiPilot writes every byte of the script; your steps reach it only as data."
      >
        {generateBlocked && <p className="text-xs text-muted">{generateBlocked}</p>}
        {plan.dataSets.length > 0 && (
          <p className="text-xs text-muted">
            This plan reads its data sets from files ApiPilot writes for each run, so a downloaded copy of the script cannot run in Run k6 Script, which never lets a script open files.
          </p>
        )}
      </SetupItem>
    </section>
  );
}
