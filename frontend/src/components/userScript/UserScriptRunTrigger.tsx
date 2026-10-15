import type { ReactNode } from "react";
import type { Environment, K6Readiness, MappedValueStatus, UserScript, UserScriptRun } from "@apipilot/shared-domain";
import { formatDateTimeUtc } from "../../dateTime";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { StatusBadge } from "../StatusBadge";
import { READINESS_REASON, TIER_TONE, loadProfileSummary, runStatusLabel } from "../performance/performanceViewModel";
import { UserScriptDebugView } from "./UserScriptDebugOutput";
import type { UserScriptDebugRun } from "./useUserScriptDebugRun";

export const LOAD_ORIGIN = "Load is generated from the machine running the ApiPilot backend.";

/**
 * Why the trigger is unavailable, or null when a run can start (AP-034 FR-013, FR-019, FR-021, FR-027).
 * A Debug run ignores the load profile, so it passes `ignoreLoad` (specs/053 FR-001).
 */
export function triggerBlockedReason(script: UserScript, environment: Environment | null, readiness: K6Readiness | null, inProgress: boolean, options: { ignoreLoad?: boolean } = {}): string | null {
  if (!script.check.accepted) return "ApiPilot's check refuses the current script, so it cannot run.";
  if (!script.confirmed) return "The script has not been confirmed. Confirm its current content first.";
  if (!options.ignoreLoad && script.settings.load.kind === "profile" && !script.check.hasDefaultFunction) return "This script has no default function, so a load profile cannot replace its scenarios.";
  if (!readiness) return "Checking whether k6 is available…";
  if (readiness.state !== "ready") return READINESS_REASON[readiness.reason];
  if (!environment) return "Choose a target environment.";
  if (inProgress) return "A run is in progress.";
  return null;
}

/** Why Run again is not offered for the newest ended run, or `null`, as on Performance's Runs & reports. */
export function runAgainBlockedReason(run: Pick<UserScriptRun, "environment" | "snapshot">, input: { script: UserScript; environments: readonly Environment[]; readiness: K6Readiness | null; inProgress: boolean }): string | null {
  if (input.script.sha256 !== run.snapshot.scriptSha256) return "The script changed since this run.";
  const environment = input.environments.find((candidate) => candidate.id === run.environment.id) ?? null;
  if (!environment) return "This run's environment no longer exists.";
  return triggerBlockedReason(input.script, environment, input.readiness, input.inProgress);
}

const HERO_BUTTON = "inline-flex min-h-11 items-center rounded-lg px-5 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const HERO_PRIMARY = `${HERO_BUTTON} bg-brand-600 text-white hover:bg-brand-700`;
const HERO_SECONDARY = `${HERO_BUTTON} border border-border bg-surface hover:bg-surface-hover`;
const HERO_DANGER = `${HERO_BUTTON} bg-danger-600 text-white hover:bg-danger-700`;

function Fact({ label, children, mono = true }: Readonly<{ label: string; children: ReactNode; mono?: boolean }>) {
  return (
    <div className="min-w-0 bg-surface-subtle px-6 py-3">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm font-semibold ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

/**
 * The run trigger (AP-034 FR-019, FR-023), laid out as the Performance Run step's launch card (specs/051
 * FR-004; AP-040): whether a run can start and, if not, why; the debug run and the run (Cancel run while
 * one is in progress); the run's progress; the facts of the run; the values the script receives and the
 * hosts found in it; and a statement that ApiPilot cannot tell what the script writes. It names the
 * target by environment name, tier label and base URL. It starts a run only when pressed; nothing else
 * does. The last run is one line with a link to the run history.
 */
export function UserScriptRunTrigger({
  script,
  environment,
  readiness,
  inProgress,
  starting,
  cancelling,
  error,
  latest,
  run,
  statuses,
  onStart,
  onCancel,
  onViewRuns,
  debug,
}: Readonly<{
  script: UserScript;
  environment: Environment | null;
  readiness: K6Readiness | null;
  inProgress: boolean;
  starting: boolean;
  cancelling: boolean;
  error: string | null;
  /** The newest ended run, for the "Last run" line. */
  latest: UserScriptRun | null;
  /** The run in progress, for its progress line. */
  run: UserScriptRun | null;
  /** For the chosen environment; null when none is chosen. */
  statuses: readonly MappedValueStatus[] | null;
  onStart: () => void;
  onCancel: () => void;
  onViewRuns: () => void;
  /** The Debug run (specs/053-user-script-debug-run): offered beside Run when given. */
  debug?: UserScriptDebugRun;
}>) {
  const blocked = triggerBlockedReason(script, environment, readiness, inProgress);
  const ready = blocked === null && !starting;
  const hosts = script.check.accepted ? script.check.hosts : [];
  const load = script.settings.load;
  let headline = "Not ready to run yet";
  if (inProgress) headline = "Run in progress";
  else if (ready) headline = "Ready to run";
  let buttonLabel = "Run";
  if (starting) buttonLabel = "Starting…";
  else if (environment) buttonLabel = `Run on ${environment.name}`;
  // The Debug run has its own reasons (it ignores the load profile), so show them only when they add something.
  const debugReason = debug?.blocked && !debug.running && debug.blocked !== blocked ? debug.blocked : null;
  const statusOf = (name: string) => statuses?.find((status) => status.name === name);

  return (
    <section aria-labelledby="user-script-trigger-title" data-testid="user-script-trigger" className={`overflow-hidden rounded-2xl border bg-surface ${ready ? "border-success-500" : "border-border"}`}>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4 p-6">
        <div className="flex min-w-72 flex-1 items-center gap-4">
          <span
            aria-hidden="true"
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border text-xl font-bold ${ready ? "border-success-500 bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-100" : "border-border bg-surface-strong text-muted"}`}
          >
            {ready ? "✓" : "–"}
          </span>
          <div className="min-w-0 space-y-0.5">
            <h3 id="user-script-trigger-title" className="text-xl font-semibold">
              {headline}
            </h3>
            <p className="break-words text-left text-sm text-muted hyphens-none">
              Run <span className="font-semibold text-text-secondary">{script.name}</span> with your own k6.
            </p>
            {blocked && !inProgress && (
              <p className="text-left text-sm font-medium hyphens-none" data-testid="user-script-trigger-blocked">
                {blocked}
              </p>
            )}
            {debugReason && (
              <p className="text-left text-xs text-muted hyphens-none" data-testid="debug-blocked">
                {debugReason}
              </p>
            )}
            {latest && (
              <p className="text-left text-sm text-muted hyphens-none" data-testid="run-launch-last-run">
                Last run: {formatDateTimeUtc(latest.startedAt)} · {runStatusLabel(latest).label} ·{" "}
                <button type="button" className={BUTTON_STYLES.ghost} onClick={onViewRuns}>
                  View runs &amp; reports
                </button>
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-5">
          {debug && (
            <section aria-labelledby="user-script-debug-launch-title" className="w-80 max-w-full space-y-2" data-testid="user-script-debug-launch">
              <h4 id="user-script-debug-launch-title" className="sr-only">
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
              <p className="text-left text-sm text-muted hyphens-none">
                Runs the script once, with one virtual user and one iteration, and shows each request it sends and each response it gets here, so you can see why a request failed. It sends real requests, including writes, to the target.
              </p>
              <p className="text-left text-xs text-muted hyphens-none">
                Nothing is stored: the output is gone when you close it or reload the page. Authorization, cookie and API key values, values mapped from the environment and credentials are masked, and the script&apos;s own console output is never shown. The load profile and the thresholds set in ApiPilot do not apply. Nothing is sent until you start.
              </p>
            </section>
          )}
          <div className="w-64 max-w-full space-y-2">
            {inProgress ? (
              <button type="button" className={HERO_DANGER} disabled={cancelling} onClick={onCancel}>
                {cancelling ? "Cancelling…" : "Cancel run"}
              </button>
            ) : (
              <button type="button" className={HERO_PRIMARY} disabled={blocked !== null || starting} onClick={onStart}>
                {buttonLabel}
              </button>
            )}
            <p className="text-left text-xs text-muted hyphens-none">{LOAD_ORIGIN}</p>
            <p className="text-left text-xs text-muted hyphens-none">Nothing runs until you press this button.</p>
          </div>
        </div>
      </div>

      {run && inProgress && (
        <p className="px-6 pb-4 text-sm" role="status">
          Running · {Math.round((run.progress?.elapsedMs ?? 0) / 1000)} s · {run.progress?.requestsSoFar ?? 0} requests · {run.progress?.failuresSoFar ?? 0} failures
        </p>
      )}
      {error && (
        <div className="px-6 pb-4">
          <ErrorState message={error} testId="user-script-run-error" />
        </div>
      )}

      <dl className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3 lg:grid-cols-5" data-testid="user-script-facts-strip">
        <Fact label="Target" mono={false}>
          {environment ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="user-script-target">
              <span>{environment.name}</span>
              <StatusBadge label={`Tier: ${environment.tier}`} tone={TIER_TONE[environment.tier]} />
            </span>
          ) : (
            <span className="font-normal text-muted">No target environment chosen.</span>
          )}
        </Fact>
        <Fact label="Base URL">{environment ? <span className="break-all text-xs">{environment.baseUrl}</span> : "None"}</Fact>
        <Fact label="Load" mono={false}>
          {load.kind === "script" ? "The script's own load settings" : loadProfileSummary(load.profile)}
        </Fact>
        <Fact label="Script">{`${script.sha256.slice(0, 8)}…`}</Fact>
        <Fact label="Hosts found" mono={false}>
          {hosts.length === 0 ? "None" : String(hosts.length)}
        </Fact>
      </dl>

      <div className="grid gap-4 border-t border-border p-6 text-sm sm:grid-cols-[3fr_2fr]">
        <section aria-labelledby="user-script-values-title" className="rounded-xl border border-border bg-surface-subtle p-4">
          <h4 id="user-script-values-title" className="text-sm font-semibold">
            Values the script receives <span className="font-normal text-muted">· names only, a value is never shown</span>
          </h4>
          {script.settings.mapping.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No environment values are mapped.</p>
          ) : (
            <ul className="mt-3 space-y-2" data-testid="trigger-values">
              {script.settings.mapping.map((entry) => {
                const status = statusOf(entry.name);
                return (
                  <li key={entry.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2">
                    <code className="min-w-0 break-all font-mono text-xs font-medium">{entry.name}</code>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                      {entry.source.kind === "base-url" ? "Environment base URL" : "Environment value"}
                      {status ? <StatusBadge label={status.present ? "Present" : "Missing"} tone={status.present ? "success" : "warning"} /> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="user-script-hosts-title" className="space-y-2 rounded-xl border border-border bg-surface-subtle p-4">
          <h4 id="user-script-hosts-title" className="text-sm font-semibold">
            Hosts written in the script
          </h4>
          {hosts.length === 0 ? (
            <p>None were found in the script text.</p>
          ) : (
            <ul className="space-y-0.5 font-mono text-xs" data-testid="trigger-hosts">
              {hosts.map((host) => (
                <li key={host} className="break-all">
                  {host}
                </li>
              ))}
            </ul>
          )}
          <p className="text-left text-xs text-muted hyphens-none">Hosts built while the script runs cannot be listed. ApiPilot cannot restrict where the script sends requests.</p>
        </section>
      </div>

      <div role="note" data-testid="user-script-writes-note" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-warning-500 bg-warning-50 px-6 py-3 text-warning-700 dark:bg-warning-500/10 dark:text-warning-100">
        <StatusBadge label="Writes not checked" tone="warning" />
        <p className="text-left text-sm hyphens-none">ApiPilot cannot tell which requests the script sends or whether they change data. Read the script and the hosts above before you run it.</p>
      </div>

      {debug && debug.state.kind !== "idle" && (
        <div className="space-y-3 border-t border-border p-6" data-testid="debug-run-block">
          <UserScriptDebugView debug={debug} />
        </div>
      )}
    </section>
  );
}
