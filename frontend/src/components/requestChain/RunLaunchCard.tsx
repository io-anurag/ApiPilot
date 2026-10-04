import type { ReactNode } from "react";
import { WRITE_EFFECT_LABELS } from "@apipilot/shared-domain";
import { WRITE_REPETITION_SENTENCE, writeCountLabel } from "../performance/WriteOperationSummary";
import { BUTTON_STYLES } from "../controlStyles";
import { formatDuration } from "../performance/performanceViewModel";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { ErrorState } from "../ErrorState";
import { StatusBadge } from "../StatusBadge";
import { DebugRunNotes, DebugRunResultView, useChainDebugRun } from "./ChainDebugPanel";
import { runBlockedReason, STATUS_TEXT, summarizeChains, type ChainRunProps } from "./ChainRunPanel";

const HERO_BUTTON = "inline-flex min-h-11 items-center rounded-lg px-5 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const HERO_PRIMARY = `${HERO_BUTTON} bg-brand-600 text-white hover:bg-brand-700`;
const HERO_SECONDARY = `${HERO_BUTTON} border border-border bg-surface hover:bg-slate-50 dark:hover:bg-white/10`;
const HERO_DANGER = `${HERO_BUTTON} bg-danger-600 text-white hover:bg-danger-700`;

function Fact({ label, children, mono = true }: Readonly<{ label: string; children: ReactNode; mono?: boolean }>) {
  return (
    <div className="bg-slate-50 px-6 py-3 dark:bg-slate-900">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm font-semibold ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

/**
 * The Run setup tab's launch card (AP-040): whether a run can start, the load run and Debug run
 * triggers, the plan's profile facts and the write warning, in one card at the top. Starting is still
 * the engineer's explicit act (constitution XVII), and the card names the target and every write it
 * sends, as one banner with the count, the methods and the list, so the warning sits with the buttons;
 * and the chains, hosts and data sets the run uses are listed under the facts, so everything a run does
 * is read in one place before it starts. The last
 * run is one line with a link to Runs & reports, where Run again, restore and the report live.
 */
export function RunLaunchCard({ plan, analysis, script, environment, runs, dirty, onViewRuns }: ChainRunProps & Readonly<{ onViewRuns: () => void }>) {
  const blocked = runBlockedReason({ script, analysis, environment, runs, dirty });
  const debug = useChainDebugRun({ plan, analysis, environment, dirty, loadRunInProgress: runs.inProgress });
  const ready = blocked === null && environment !== null;
  const profile = plan.loadProfile;
  const peak = Math.max(0, ...profile.stages.map((stage) => stage.targetVirtualUsers));
  const writes = analysis.writeSummary;
  const latest = runs.latestFinished;
  const chains = summarizeChains(plan);
  let headline = "Not ready to run yet";
  if (runs.inProgress) headline = "Run in progress";
  else if (ready) headline = `Ready to run on ${environment.name} (${environment.tier})`;
  // The Debug run has its own reasons (it needs no script), so show them only when they add something.
  const debugReason = debug.blocked && !debug.running && debug.blocked !== blocked ? debug.blocked : null;

  return (
    <section aria-labelledby="chain-run-title" data-testid="run-launch-card" className={`overflow-hidden rounded-2xl border bg-surface ${ready ? "border-success-500" : "border-border"}`}>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4 p-6">
        <div className="flex min-w-72 flex-1 items-center gap-4">
          <span
            aria-hidden="true"
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border text-xl font-bold ${ready ? "border-success-500 bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-100" : "border-border bg-slate-100 text-muted dark:bg-white/10"}`}
          >
            {ready ? "✓" : "–"}
          </span>
          <div className="min-w-0 space-y-0.5">
            <h3 id="chain-run-title" className="text-xl font-semibold">
              {headline}
            </h3>
            {blocked && !runs.inProgress && (
              <p className="text-sm font-medium" data-testid="run-blocked">
                {blocked}
              </p>
            )}
            {debugReason && (
              <p className="text-xs text-muted" data-testid="debug-blocked">
                {debugReason}
              </p>
            )}
            {latest && (
              <p className="text-sm text-muted" data-testid="run-launch-last-run">
                Last run: {new Date(latest.startedAt).toLocaleString()} · {STATUS_TEXT[latest.status]} ·{" "}
                <button type="button" className={BUTTON_STYLES.ghost} onClick={onViewRuns}>
                  View runs &amp; reports
                </button>
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-5">
          <section aria-labelledby="chain-debug-title" className="w-80 max-w-full space-y-2">
            <h4 id="chain-debug-title" className="sr-only">
              Debug run
            </h4>
            {debug.running ? (
              <button type="button" className={HERO_DANGER} onClick={debug.cancel}>
                Cancel debug run
              </button>
            ) : (
              <button type="button" className={HERO_SECONDARY} disabled={debug.blocked !== null} onClick={debug.start}>
                {`Start debug run on ${environment?.name ?? "…"}`}
              </button>
            )}
            <DebugRunNotes missing={debug.missing} compact />
          </section>
          <div className="w-64 max-w-full space-y-2">
            {runs.inProgress ? (
              <button type="button" className={HERO_DANGER} disabled={runs.cancelling} onClick={() => void runs.cancel()}>
                {runs.cancelling ? "Cancelling…" : "Cancel run"}
              </button>
            ) : (
              <button type="button" className={HERO_PRIMARY} disabled={blocked !== null || runs.starting} onClick={() => environment && void runs.start(environment.id)}>
                {runs.starting ? "Starting…" : `Start run on ${environment?.name ?? "…"}`}
              </button>
            )}
            <p className="text-left text-xs text-muted hyphens-none">Load is generated from the machine running the ApiPilot backend. Nothing is sent until you start the run.</p>
          </div>
        </div>
      </div>

      {runs.run && runs.inProgress && (
        <p className="px-6 pb-4 text-sm" role="status">
          Running · {Math.round((runs.run.progress?.elapsedMs ?? 0) / 1000)} s · {runs.run.progress?.requestsSoFar ?? 0} requests · {runs.run.progress?.failuresSoFar ?? 0} failures
        </p>
      )}
      {runs.error && (
        <div className="px-6 pb-4">
          <ErrorState message={runs.error} testId="chain-run-error" />
        </div>
      )}

      <dl className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3 lg:grid-cols-5" data-testid="run-launch-facts">
        <Fact label="Profile" mono={false}>
          {profile.kind.charAt(0).toUpperCase() + profile.kind.slice(1)}
        </Fact>
        <Fact label="Duration">{formatDuration(profile.plannedDurationMs)}</Fact>
        <Fact label="Peak VUs">{String(peak)}</Fact>
        <Fact label="Think time">{`${plan.thinkTimeMs} ms`}</Fact>
        <Fact label="Script">{script ? `${script.scriptSha256.slice(0, 8)}…` : "Not generated"}</Fact>
      </dl>

      <div className="grid gap-4 border-t border-border p-6 text-sm sm:grid-cols-[3fr_2fr]">
        <section aria-labelledby="run-chains-title" className="rounded-xl border border-border bg-slate-50 p-4 dark:bg-slate-900">
          <h4 id="run-chains-title" className="text-sm font-semibold">
            Chains <span className="font-normal text-muted">· run in order on every iteration</span>
          </h4>
          <ul className="mt-3 space-y-2" data-testid="trigger-chains">
            {chains.map((chain) => (
              <li key={chain.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2">
                <span className="min-w-0 font-medium">
                  {chain.name}
                  {chain.note && <span className="font-normal text-muted"> ({chain.note})</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {chain.steps.length} {chain.steps.length === 1 ? "step" : "steps"}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="run-hosts-title" className="space-y-3 rounded-xl border border-border bg-slate-50 p-4 dark:bg-slate-900">
          <div>
            <h4 id="run-hosts-title" className="text-sm font-semibold">
              Hosts
            </h4>
            <ul className="mt-2 space-y-0.5" data-testid="trigger-hosts">
              {analysis.hosts.map((host) => (
                <li key={host}>
                  <code className="break-all font-mono text-xs">{host === "{{baseUrl}}" && environment ? environment.baseUrl : host}</code>
                </li>
              ))}
            </ul>
          </div>
          {plan.dataSets.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">Data sets</h4>
              <ul className="mt-2 space-y-0.5" data-testid="trigger-data-sets">
                {plan.dataSets.map((dataSet) => (
                  <li key={dataSet.id}>
                    {dataSet.name} · {dataSet.rowCount} rows
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {writes.total > 0 ? (
        <div role="note" data-testid="write-summary-trigger" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-warning-500 bg-warning-50 px-6 py-3 text-warning-700 dark:bg-warning-500/10 dark:text-warning-100">
          <StatusBadge label="Writes" tone="warning" />
          <strong className="text-sm">
            {writeCountLabel(writes.total)}
            {environment ? ` to ${environment.name}` : ""}.
          </strong>
          <ul className="flex flex-wrap gap-2" aria-label="Write operations per method">
            {writes.byMethod.map((entry) => (
              <li key={entry.method} className="inline-flex items-center gap-1 text-sm">
                <HttpMethodBadge method={entry.method} />
                <span className="font-mono">× {entry.count}</span>
              </li>
            ))}
          </ul>
          <p className="basis-full text-left text-xs hyphens-none">{WRITE_REPETITION_SENTENCE}</p>
          <ul className="grid basis-full gap-x-10 gap-y-2 lg:grid-cols-2" aria-label="Write operations" data-testid="write-summary-trigger-list">
            {writes.operations.map((operation) => (
              <li key={operation.operationKey} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <HttpMethodBadge method={operation.method} />
                <span className="text-xs font-semibold">{WRITE_EFFECT_LABELS[operation.method]}</span>
                <span className="min-w-0 break-all font-mono text-xs">
                  {operation.path}
                  {operation.steps.length > 1 && (
                    <span className="font-sans text-warning-700 dark:text-warning-100"> × {operation.steps.length} steps: {operation.steps.map((step) => step.journeyLabel).join(", ")}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="border-t border-border px-6 py-3 text-sm" data-testid="write-summary-trigger">
          <StatusBadge label="Read only" tone="success" /> This plan sends only read requests.
        </p>
      )}

      {debug.state.kind !== "idle" && (
        <div className="space-y-3 border-t border-border p-6" data-testid="debug-run-block">
          {debug.state.kind === "done" && (
            <div className="flex justify-end">
              <button type="button" className={HERO_SECONDARY} onClick={debug.close}>
                Close output
              </button>
            </div>
          )}
          <DebugRunResultView debug={debug} />
        </div>
      )}
    </section>
  );
}
