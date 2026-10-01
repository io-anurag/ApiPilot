import type { Environment, K6Readiness, UserScript } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { StatusBadge } from "../StatusBadge";
import { READINESS_REASON, TIER_TONE, loadProfileSummary } from "../performance/performanceViewModel";

export const LOAD_ORIGIN = "Load is generated from the machine running the ApiPilot backend.";

/** Why the trigger is unavailable, or null when a run can start (AP-034 FR-013, FR-019, FR-021, FR-027). */
export function triggerBlockedReason(script: UserScript, environment: Environment | null, readiness: K6Readiness | null, inProgress: boolean): string | null {
  if (!script.check.accepted) return "ApiPilot's check refuses the current script, so it cannot run.";
  if (!script.confirmed) return "The script has not been confirmed. Confirm its current content first.";
  if (script.settings.load.kind === "profile" && !script.check.hasDefaultFunction) return "This script has no default function, so a load profile cannot replace its scenarios.";
  if (!readiness) return "Checking whether k6 is available…";
  if (readiness.state !== "ready") return READINESS_REASON[readiness.reason];
  if (!environment) return "Choose a target environment.";
  if (inProgress) return "A run is in progress.";
  return null;
}

/**
 * The run trigger (AP-034 FR-019, FR-023): it names the target by environment name, tier label and
 * base URL, repeats the hosts found in the script, and says where load comes from. It starts a run
 * only when pressed; nothing else does.
 */
export function UserScriptRunTrigger({
  script,
  environment,
  readiness,
  inProgress,
  starting,
  error,
  onStart,
}: Readonly<{
  script: UserScript;
  environment: Environment | null;
  readiness: K6Readiness | null;
  inProgress: boolean;
  starting: boolean;
  error: string | null;
  onStart: () => void;
}>) {
  const blocked = triggerBlockedReason(script, environment, readiness, inProgress);
  const hosts = script.check.accepted ? script.check.hosts : [];
  const load = script.settings.load;

  return (
    <section aria-labelledby="user-script-trigger-title" className="space-y-3 rounded-lg border border-border bg-surface p-5" data-testid="user-script-trigger">
      <h3 id="user-script-trigger-title" className="text-base font-semibold">
        Run {script.name}
      </h3>
      {environment ? (
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="user-script-target">
          <span className="text-xs font-semibold text-muted">TARGET</span>
          <span className="font-semibold">{environment.name}</span>
          <StatusBadge label={`Tier: ${environment.tier}`} tone={TIER_TONE[environment.tier]} />
          <span className="break-all font-mono text-xs">{environment.baseUrl}</span>
        </p>
      ) : (
        <p className="text-sm text-muted">No target environment chosen.</p>
      )}
      <div className="space-y-1 text-sm">
        <p className="text-xs font-semibold text-muted">Hosts written in the script</p>
        {hosts.length === 0 ? <p>None were found in the script text.</p> : <ul className="font-mono text-xs">{hosts.map((host) => <li key={host}>{host}</li>)}</ul>}
        <p className="text-xs text-muted">Hosts built while the script runs cannot be listed. ApiPilot cannot restrict where the script sends requests.</p>
      </div>
      <p className="text-sm">
        <span className="text-xs font-semibold text-muted">LOAD </span>
        {load.kind === "script" ? "The script's own load settings" : loadProfileSummary(load.profile)}
      </p>
      <p className="text-xs text-muted">{LOAD_ORIGIN}</p>
      {blocked && (
        <p className="text-sm font-medium text-warning-800 dark:text-warning-100" data-testid="user-script-trigger-blocked">
          {blocked}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger-700 dark:text-danger-200">
          {error}
        </p>
      )}
      <button type="button" className={BUTTON_STYLES.primary} disabled={blocked !== null || starting} onClick={onStart}>
        {starting ? "Starting…" : environment ? `Run on ${environment.name}` : "Run"}
      </button>
    </section>
  );
}
