import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Environment, MappedValueStatus, ScriptProblem, UserScript, UserScriptRun, UserScriptRunSummary, UserScriptThresholdScope } from "@apipilot/shared-domain";
import { LOAD_PROFILE_STARTING_STAGES } from "@apipilot/shared-domain";
import { fetchEnvironments } from "../../services/environmentsClient";
import { userScriptClient, userScriptRunsClient, type UserScriptSettingsInput, type UserScriptStartInput } from "../../services/userScriptClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ConfirmDialog } from "../ConfirmDialog";
import { ErrorState } from "../ErrorState";
import { PromptDialog } from "../PromptDialog";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { Banner } from "../patterns/Banner";
import { Card, CardHeader } from "../patterns/Card";
import { EnvironmentPicker } from "../performance/EnvironmentPicker";
import { LoadProfileEditor } from "../performance/LoadProfileEditor";
import { ThresholdEditor } from "../performance/ThresholdEditor";
import { runStatusLabel } from "../performance/performanceViewModel";
import { usePerformanceRuns } from "../performance/usePerformanceRuns";
import { ScriptConfirmDialog } from "./ScriptConfirmDialog";
import { ScriptEditor } from "./ScriptEditor";
import { ScriptProblems } from "./ScriptProblems";
import { formatSize } from "./ScriptList";
import { PanelState, ScriptFact, ScriptFacts, ScriptPanel } from "./ScriptPanel";
import { SetupItem, type SetupItemState } from "../performance/SetupItem";
import { SCRIPT_TAB_ICONS, ScriptTabs, type ScriptTabItem } from "./ScriptTabs";
import { UserScriptRunActivity } from "./UserScriptRunActivity";
import { UserScriptRunTrigger } from "./UserScriptRunTrigger";
import { useUserScriptDebugRun } from "./useUserScriptDebugRun";
import { ValueMappingEditor } from "./ValueMappingEditor";

type WorkspaceTab = "script" | "setup" | "runs";

export const RUN_TIME_NOTE = "Values built while the script runs cannot be found.";

/** The hint under "Runs & reports": what is there to see, in words. */
function runsHint(inProgress: boolean, count: number): string {
  if (inProgress) return "A run is in progress";
  if (count === 0) return "No runs yet";
  return count === 1 ? "1 run and its report" : `${count} runs and their reports`;
}

/** What the check found in an accepted script: the hosts written in it and the environment values it reads. */
function CheckFindings({ hosts, envNames }: Readonly<{ hosts: readonly string[]; envNames: ReadonlyArray<{ name: string; mappable: boolean }> }>) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 rounded-xl bg-surface-subtle p-3">
        <dt className="text-xs font-semibold text-muted">Hosts written in the script</dt>
        <dd className="text-sm text-text-primary">
          {hosts.length === 0 ? (
            "None found in the script text."
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {hosts.map((host) => (
                <li key={host} className="break-all rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-text-primary">
                  {host}
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dd className="text-xs text-muted">{RUN_TIME_NOTE}</dd>
      </div>
      <div className="space-y-1.5 rounded-xl bg-surface-subtle p-3">
        <dt className="text-xs font-semibold text-muted">Environment values the script reads</dt>
        <dd className="text-sm text-text-primary">
          {envNames.length === 0 ? (
            "None found."
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {envNames.map((entry) => (
                <li key={entry.name} className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-text-primary">
                  {entry.name}
                  {!entry.mappable && <span className="ml-2 font-sans text-danger-700 dark:text-danger-100">cannot be mapped</span>}
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dd className="text-xs text-muted">{RUN_TIME_NOTE}</dd>
      </div>
    </dl>
  );
}

/** One way to choose the load: a radio button whose whole card is its label (specs/051 FR-005). */
function LoadOption({
  id,
  checked,
  disabled = false,
  label,
  description,
  onChange,
}: Readonly<{ id: string; checked: boolean; disabled?: boolean; label: string; description: string; onChange: () => void }>) {
  return (
    <div
      className={`relative flex gap-3 rounded-xl border p-3 motion-safe:transition-colors focus-within:ring-2 focus-within:ring-brand-500 ${
        checked ? "border-brand-500 bg-lime-pale ring-1 ring-brand-500" : "border-border bg-surface hover:border-brand-500"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <input id={id} type="radio" name="user-script-load" checked={checked} disabled={disabled} onChange={onChange} aria-describedby={`${id}-description`} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600 focus:outline-none" />
      <div className="min-w-0">
        <label htmlFor={id} className={`block text-sm font-semibold text-text-primary after:absolute after:inset-0 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
          {label}
        </label>
        <p id={`${id}-description`} className="mt-0.5 text-xs text-muted">
          {description}
        </p>
      </div>
    </div>
  );
}

/**
 * One stored script (AP-034 US1 to US3): its content and check results, its run setup and its
 * runs. Keyed by the script's id, so its runs hook belongs to that script alone. Reports unsaved
 * editor changes to the page, which asks before leaving them (FR-011). The look follows
 * specs/051-user-script-page-redesign.
 */
export function ScriptWorkspace({
  scriptId,
  onChanged,
  onDeleted,
  onDirtyChange,
  openRun,
}: Readonly<{
  scriptId: string;
  onChanged: () => void;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** AP-054: Home's Recent runs asks for one run's report; a new `token` opens it on the Runs & reports view. */
  openRun?: Readonly<{ runId: string; token: number }>;
}>) {
  const runsClient = useMemo(() => userScriptRunsClient(scriptId), [scriptId]);
  const runs = usePerformanceRuns<UserScriptRun, UserScriptRunSummary, UserScriptStartInput>(runsClient);
  const [script, setScript] = useState<UserScript | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("script");
  const [pendingTab, setPendingTab] = useState<WorkspaceTab | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [askConfirm, setAskConfirm] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [askRename, setAskRename] = useState(false);
  const [pendingReplacement, setPendingReplacement] = useState<File | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftProblems, setDraftProblems] = useState<ScriptProblem[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentsError, setEnvironmentsError] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<MappedValueStatus[] | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  const environment = environments.find((candidate) => candidate.id === environmentId) ?? null;
  const debug = useUserScriptDebugRun({ scriptId, script, environment, readiness: runs.readiness, runInProgress: runs.inProgress });

  const dirty = draft !== null && draft !== content;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    const [detail, text] = await Promise.all([userScriptClient.fetchScript(scriptId), userScriptClient.fetchContent(scriptId)]);
    if (!detail.ok) {
      setLoadError(detail.message);
      return;
    }
    setLoadError(null);
    setScript(detail.script);
    setContent(text.ok ? text.content : null);
  }, [scriptId]);

  const loadEnvironments = useCallback(async () => {
    const result = await fetchEnvironments();
    if (!result.ok) {
      setEnvironmentsError(result.message);
      return;
    }
    setEnvironmentsError(null);
    setEnvironments(result.environments);
    setEnvironmentId((current) => current ?? result.environments[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
    void loadEnvironments();
  }, [load, loadEnvironments]);

  useEffect(() => {
    if (!environmentId || !script) {
      setStatuses(null);
      return;
    }
    let cancelled = false;
    void userScriptClient.fetchValues(scriptId, environmentId).then((result) => {
      if (!cancelled) setStatuses(result.ok ? result.values : null);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, script, scriptId]);

  function applied(next: UserScript, note?: string) {
    setScript(next);
    setActionError(null);
    setMessage(note ?? null);
    onChanged();
  }

  async function saveSettings(change: Partial<UserScriptSettingsInput>) {
    if (!script) return;
    setBusy(true);
    const result = await userScriptClient.saveSettings(script.id, {
      mapping: change.mapping ?? script.settings.mapping.map(({ name, source }) => ({ name, source })),
      removedNames: change.removedNames ?? script.settings.removedNames,
      load: change.load ?? script.settings.load,
      thresholds: change.thresholds ?? script.settings.thresholds.map(({ scope, metric, comparator, limit }) => ({ scope, metric, comparator, limit })),
    });
    setBusy(false);
    if (result.ok) applied(result.script, "Saved. The confirmation is kept: settings never change the script.");
    else setActionError(result.message);
  }

  async function confirm() {
    if (!script) return;
    setConfirming(true);
    const result = await userScriptClient.confirmScript(script.id, script.sha256);
    setConfirming(false);
    setAskConfirm(false);
    if (result.ok) applied(result.script, "Confirmed. The script can run until its content changes.");
    else setActionError(result.message);
  }

  async function saveDraft() {
    if (!script || draft === null) return;
    setBusy(true);
    const result = await userScriptClient.saveContent(script.id, draft, script.sha256);
    setBusy(false);
    if (!result.ok) {
      // FR-011: a refused save stores nothing; the unsaved text stays in the editor.
      setDraftProblems(result.problems ?? []);
      setActionError(result.problems ? null : result.message);
      return;
    }
    setDraft(null);
    setDraftProblems([]);
    setContent(draft);
    applied(result.script, "Saved as a new version. Confirm it before the next run.");
  }

  async function replace(file: File) {
    if (!script) return;
    setBusy(true);
    const result = await userScriptClient.replaceWithUpload(script.id, file, script.sha256);
    setBusy(false);
    if (!result.ok) {
      setDraftProblems(result.problems ?? []);
      setActionError(result.problems ? "The new file was refused. The stored script is unchanged." : result.message);
      return;
    }
    setDraftProblems([]);
    applied(result.script, "Replaced with the uploaded file. Confirm it before the next run.");
    void load();
  }

  async function rename(name: string) {
    if (!script) return;
    setAskRename(false);
    const result = await userScriptClient.renameScript(script.id, name);
    if (result.ok) applied(result.script, "Renamed. The confirmation is kept.");
    else setActionError(result.message);
  }

  async function remove() {
    if (!script) return;
    setAskDelete(false);
    const result = await userScriptClient.deleteScript(script.id);
    if (result.ok) onDeleted();
    else setActionError(result.message);
  }

  async function start(onEnvironmentId: string | null = environmentId) {
    if (!script || !onEnvironmentId) return;
    const started = await runs.start({ environmentId: onEnvironmentId, scriptSha256: script.sha256 });
    if (started) {
      setTab("runs");
      onChanged();
    }
  }

  const { showReport } = runs;
  const handledOpenRun = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!openRun || !script || handledOpenRun.current === openRun.token) return;
    handledOpenRun.current = openRun.token;
    setTab("runs");
    showReport(openRun.runId);
  }, [openRun, script, showReport]);

  function changeTab(next: WorkspaceTab) {
    if (dirty && next !== "script") setPendingTab(next);
    else setTab(next);
  }

  if (loadError) return <ErrorState message="The script could not be loaded." detail={loadError} testId="user-script-load-error" />;
  if (!script) return <Skeleton className="h-64 w-full rounded bg-surface-strong" />;

  const check = script.check;
  const lastResult = runs.latestFinished?.result;
  const requestNames = lastResult ? lastResult.requestGroups.map((group) => group.displayName) : [];
  const needsConfirmation = !script.confirmed && check.accepted;
  const loadSetting = script.settings.load;
  const missingValues = statuses ? statuses.filter((status) => !status.present).length : null;

  const scriptDone = check.accepted && script.confirmed;
  const setupDone = scriptDone && environment !== null;
  const runsDone = runs.runs.some((run) => run.status === "completed");
  let scriptHint = "Needs confirmation";
  if (!check.accepted) scriptHint = "Check refused";
  else if (script.confirmed) scriptHint = "Checked and confirmed";
  let mappingState: SetupItemState = "todo";
  if (script.settings.mapping.length === 0) mappingState = "optional";
  else if (missingValues === 0) mappingState = "done";
  else if (missingValues !== null) mappingState = "attention";
  const thresholdCount = script.settings.thresholds.length;
  const thresholdsSummary = thresholdCount > 0 ? `${thresholdCount} ${thresholdCount === 1 ? "threshold" : "thresholds"} set.` : "None set. The report shows measurements with no pass/fail verdict.";
  let scriptRowSummary = "ApiPilot never changes your script; what you set here reaches it only as k6 options and environment values.";
  if (!check.accepted) scriptRowSummary = "ApiPilot's check refuses the current script, so it cannot run. Open the Script view to see why.";
  else if (!script.confirmed) scriptRowSummary = "Not confirmed yet. Use Review and confirm at the top before the next run.";

  const tabs: ReadonlyArray<ScriptTabItem<WorkspaceTab>> = [
    { id: "script", label: "Script", hint: scriptHint, icon: SCRIPT_TAB_ICONS.script, done: scriptDone },
    { id: "setup", label: "Run setup", hint: setupDone ? "Target chosen" : "Target, values, load and thresholds", icon: SCRIPT_TAB_ICONS.setup, done: setupDone },
    { id: "runs", label: "Runs & reports", hint: runsHint(runs.inProgress, runs.runs.length), icon: SCRIPT_TAB_ICONS.runs, done: runsDone },
  ];

  const fileActions = (
    <>
      <button type="button" className={BUTTON_STYLES.secondary} onClick={() => setAskRename(true)}>
        Rename
      </button>
      <button type="button" className={BUTTON_STYLES.secondary} disabled={busy} onClick={() => replaceInput.current?.click()}>
        Replace with upload
      </button>
      <input
        ref={replaceInput}
        type="file"
        accept=".js,text/javascript,application/javascript"
        aria-label="Choose a file to replace this script"
        className="sr-only"
        tabIndex={-1}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) setPendingReplacement(file);
        }}
      />
      <a className={BUTTON_STYLES.secondary} href={userScriptClient.downloadUrl(script.id)} download>
        Download
      </a>
      <button type="button" className={`${BUTTON_STYLES.danger} ml-auto`} onClick={() => setAskDelete(true)}>
        Delete
      </button>
    </>
  );

  const editActions =
    draft === null ? (
      <button type="button" className={BUTTON_STYLES.secondary} onClick={() => setDraft(content ?? "")}>
        Edit
      </button>
    ) : (
      <>
        <button type="button" className={BUTTON_STYLES.primary} disabled={busy || !dirty} onClick={() => void saveDraft()}>
          Save
        </button>
        <button
          type="button"
          className={BUTTON_STYLES.secondary}
          onClick={() => {
            setDraft(null);
            setDraftProblems([]);
          }}
        >
          Cancel
        </button>
      </>
    );

  return (
    <div className="space-y-4" data-testid="user-script-workspace">
      <ScriptPanel
        title={script.name}
        titleId="user-script-title"
        level={2}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-mono">{formatSize(script.sizeBytes)}</span>
            <span className="break-all font-mono" title="SHA-256 of the stored bytes">
              sha256 {script.sha256}
            </span>
          </span>
        }
        aside={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge label={script.confirmed ? "Confirmed" : "Needs confirmation"} tone={script.confirmed ? "success" : "warning"} />
            {needsConfirmation && (
              <button type="button" className={BUTTON_STYLES.primary} onClick={() => setAskConfirm(true)}>
                Review and confirm
              </button>
            )}
          </span>
        }
        footer={
          <ScriptFacts className="w-full grid-cols-2 lg:grid-cols-4" testId="user-script-facts">
            <ScriptFact label="ApiPilot's check">
              <StatusBadge label={check.accepted ? "Accepted" : "Refused"} tone={check.accepted ? "success" : "danger"} />
            </ScriptFact>
            <ScriptFact label="Load">{loadSetting.kind === "script" ? "Script's own" : `${loadSetting.profile.kind.charAt(0).toUpperCase()}${loadSetting.profile.kind.slice(1)} profile`}</ScriptFact>
            <ScriptFact label="Value names">{script.settings.mapping.length === 1 ? "1 mapped" : `${script.settings.mapping.length} mapped`}</ScriptFact>
            <ScriptFact label="Last run">{script.lastRun ? <StatusBadge {...runStatusLabel(script.lastRun)} /> : <span className="font-normal text-muted">None</span>}</ScriptFact>
          </ScriptFacts>
        }
      >
        <p className="text-sm text-muted">
          {script.confirmed
            ? "You confirmed this exact content, so it can run until it changes."
            : "This content has not been confirmed. Confirm exactly what it will run before the next run."}
        </p>
      </ScriptPanel>

      {message && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-success-600/30 bg-success-100 px-3.5 py-3 text-sm text-text-primary dark:bg-success-500/10">
          <span aria-hidden="true" className="mt-px font-bold text-success-700 dark:text-success-100">
            ✓
          </span>
          {message}
        </p>
      )}
      {actionError && <ErrorState message={actionError} testId="user-script-action-error" />}

      <ScriptTabs tabs={tabs} activeTab={tab} onChange={changeTab} label="Script views" />

      {tab === "script" && (
        <div className="space-y-4">
          {draft === null && draftProblems.length > 0 && <ScriptProblems problems={draftProblems} title="The uploaded file was refused" />}
          {content === null ? (
            <>
              <ErrorState message="The script's content could not be loaded." />
              <Card variant="flat" className="flex flex-wrap items-center gap-2">
                {fileActions}
              </Card>
            </>
          ) : (
            <ScriptEditor
              value={draft ?? content}
              onChange={setDraft}
              readOnly={draft === null}
              problems={draft === null ? [] : draftProblems}
              label={`Script ${script.name}`}
              fileName={script.name}
              toolbar={editActions}
              footer={fileActions}
            />
          )}

          {check.accepted ? (
            <ScriptPanel
              title="What ApiPilot found in the script"
              titleId="user-script-found-title"
              meta="Recomputed from the stored content with the current rules."
              aside={<PanelState tone="ready" label="Check accepted" />}
            >
              <CheckFindings hosts={check.hosts} envNames={check.envNames} />
            </ScriptPanel>
          ) : (
            <ScriptProblems problems={check.problems} title="ApiPilot's current check refuses this stored script" />
          )}
        </div>
      )}

      {tab === "setup" && (
        <Card as="section" aria-labelledby="user-script-config-title" data-testid="user-script-configuration" className="overflow-hidden">
          <CardHeader title="Configuration" titleId="user-script-config-title" subtitle="Review each part, edit only what needs to change." />
          {/* The rows run edge to edge inside the card, divided by hairlines (the card's padding is taken back). */}
          <div className="-mx-4 -mb-4 border-t border-border sm:-mx-5 sm:-mb-5">
          <SetupItem
            variant="row"
            state={environment ? "done" : "todo"}
            title="Target environment"
            titleId="user-script-environment-title"
            summary="Holds the base URL and every value the script is mapped to. The run's load is aimed at it."
          >
            {environmentsError ? (
              <ErrorState message="The environments could not be loaded." detail={environmentsError} testId="user-script-environments-error" />
            ) : (
              <EnvironmentPicker
                compact
                environments={environments}
                selectedId={environmentId}
                suggestedNames={script.settings.mapping.flatMap((entry) => (entry.source.kind === "environment-value" ? [entry.source.valueName] : []))}
                onSelect={setEnvironmentId}
                onSaved={(saved) => {
                  setEnvironmentId(saved.id);
                  void loadEnvironments();
                }}
              />
            )}
          </SetupItem>
          <SetupItem
            variant="row"
            state={mappingState}
            title="Environment values the script receives"
            titleId="user-script-mapping-title"
            summary="Names and sources only. A value is never shown here."
            status={missingValues === null ? undefined : <PanelState tone={missingValues === 0 ? "ready" : "attention"} label={missingValues === 0 ? "All present" : `${missingValues} missing`} />}
          >
            <ValueMappingEditor
              mapping={script.settings.mapping}
              removedNames={script.settings.removedNames}
              statuses={statuses}
              environmentValueNames={environment ? Object.keys(environment.variableValues) : []}
              busy={busy}
              onSave={(mapping, removedNames) => void saveSettings({ mapping, removedNames })}
            />
          </SetupItem>
          <SetupItem variant="row" state="done" title="Load" titleId="user-script-load-title" summary="Where the load shape comes from.">
            <fieldset className="grid gap-2 sm:grid-cols-2" disabled={busy}>
              <legend className="sr-only">Load choice</legend>
              <LoadOption
                id="user-script-load-script"
                checked={loadSetting.kind === "script"}
                label="The script's own load settings"
                description="k6 uses the scenarios and options written in the script."
                onChange={() => void saveSettings({ load: { kind: "script" } })}
              />
              <LoadOption
                id="user-script-load-profile"
                checked={loadSetting.kind === "profile"}
                disabled={check.accepted && !check.hasDefaultFunction}
                label="A load profile, passed to k6 as --stage options"
                description="The stages you set here replace the script's scenarios."
                onChange={() => void saveSettings({ load: { kind: "profile", profile: { kind: "smoke", stages: LOAD_PROFILE_STARTING_STAGES.smoke.map((stage) => ({ ...stage })), plannedDurationMs: LOAD_PROFILE_STARTING_STAGES.smoke.reduce((total, stage) => total + stage.durationMs, 0) } } })}
              />
            </fieldset>
            {check.accepted && !check.hasDefaultFunction && (
              <Banner tone="warning" title="This script has no default function, so a load profile cannot replace its scenarios. It runs with its own load settings." />
            )}
            {loadSetting.kind === "profile" && (
              <LoadProfileEditor
                compact
                profile={loadSetting.profile}
                startingStages={(kind) => LOAD_PROFILE_STARTING_STAGES[kind].map((stage) => ({ ...stage }))}
                busy={busy}
                onSave={(profile) => void saveSettings({ load: { kind: "profile", profile: { ...profile, plannedDurationMs: profile.stages.reduce((total, stage) => total + stage.durationMs, 0) } } })}
              />
            )}
          </SetupItem>
          <SetupItem
            variant="row"
            collapsible
            startOpen={false}
            state={script.settings.thresholds.length > 0 ? "done" : "optional"}
            title="Thresholds (optional)"
            titleId="user-script-thresholds-title"
            summary="Evaluated by ApiPilot from the measurements and never added to the script. Thresholds the script defines are reported separately."
            collapsedSummary={thresholdsSummary}
          >
            <ThresholdEditor<UserScriptThresholdScope>
              compact
              thresholds={script.settings.thresholds}
              scopeOptions={[{ key: "run", label: "Whole run", scope: { kind: "run" } }]}
              scopeLabel={(scope) => (scope.kind === "run" ? "Run" : scope.name)}
              customScope={{ optionLabel: "A request name…", inputLabel: "Request name", suggestions: requestNames, toScope: (name) => ({ kind: "request-name", name }) }}
              busy={busy}
              onSave={(thresholds) => void saveSettings({ thresholds })}
            />
          </SetupItem>
          <SetupItem
            variant="row"
            state={scriptDone ? "done" : "attention"}
            title="k6 script"
            titleId="user-script-script-title"
            status={
              <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                <span className="shrink-0">
                  <StatusBadge label={script.confirmed ? "Confirmed" : "Needs confirmation"} tone={script.confirmed ? "success" : "warning"} />
                </span>
                <span className="min-w-0 truncate font-mono text-xs" title={`sha256 ${script.sha256}`}>
                  sha256 {script.sha256}
                </span>
              </span>
            }
            actions={
              <a className={BUTTON_STYLES.ghost} href={userScriptClient.downloadUrl(script.id)} download>
                Download script
              </a>
            }
            summary={scriptRowSummary}
          />
          </div>
        </Card>
      )}

      {tab === "runs" && (
        <div className="space-y-5">
          <UserScriptRunTrigger
            script={script}
            environment={environment}
            readiness={runs.readiness}
            inProgress={runs.inProgress}
            starting={runs.starting}
            cancelling={runs.cancelling}
            error={runs.error}
            latest={runs.latestFinished ?? null}
            run={runs.run ?? null}
            statuses={statuses}
            onStart={() => void start()}
            onCancel={() => void runs.cancel()}
            onViewRuns={() => document.getElementById("user-script-runs-title")?.scrollIntoView?.({ block: "start" })}
            debug={debug}
          />
          <UserScriptRunActivity
            runs={runs}
            client={runsClient}
            script={script}
            environments={environments}
            readiness={runs.readiness}
            onRunAgain={(againEnvironmentId) => void start(againEnvironmentId)}
            onGoToSetup={() => changeTab("setup")}
          />
        </div>
      )}

      {askConfirm && check.accepted && (
        <ScriptConfirmDialog scriptName={script.name} sha256={script.sha256} hosts={check.hosts} confirming={confirming} onCancel={() => setAskConfirm(false)} onConfirm={() => void confirm()} />
      )}
      {askDelete && (
        <ConfirmDialog
          message={`Delete ${script.name}? Its confirmation and settings are deleted with it. Its past runs and reports are kept.`}
          affectedCount={1}
          confirmLabel="Delete script"
          onCancel={() => setAskDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
      {askRename && <PromptDialog title="Rename script" label="Name" initialValue={script.name} confirmLabel="Rename" onCancel={() => setAskRename(false)} onConfirm={(name) => void rename(name)} />}
      {pendingReplacement && (
        <ConfirmDialog
          message={`Replace ${script.name} with ${pendingReplacement.name}? The new content is checked first, and it needs a new confirmation before the next run.`}
          affectedCount={1}
          confirmLabel="Replace"
          onCancel={() => setPendingReplacement(null)}
          onConfirm={() => {
            const file = pendingReplacement;
            setPendingReplacement(null);
            void replace(file);
          }}
        />
      )}
      {pendingTab && (
        <ConfirmDialog
          message="Discard your unsaved changes to the script?"
          affectedCount={1}
          confirmLabel="Discard changes"
          onCancel={() => setPendingTab(null)}
          onConfirm={() => {
            setDraft(null);
            setDraftProblems([]);
            setTab(pendingTab);
            setPendingTab(null);
          }}
        />
      )}
    </div>
  );
}
